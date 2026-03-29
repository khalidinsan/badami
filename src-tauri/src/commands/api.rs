use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Deserialize)]
pub struct KV {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct RequestBody {
    pub body_type: String,
    pub content: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AuthPayload {
    pub auth_type: String,
    pub config: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct RequestPayload {
    pub method: String,
    pub url: String,
    pub headers: Vec<KV>,
    pub params: Vec<KV>,
    pub body: Option<RequestBody>,
    pub auth: AuthPayload,
    pub disable_ssl_verify: bool,
    pub timeout_seconds: u64,
}

#[derive(Debug, Serialize)]
pub struct CookieEntry {
    pub name: String,
    pub value: String,
    pub domain: String,
}

#[derive(Debug, Serialize)]
pub struct RequestResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<KV>,
    pub body: String,
    pub body_size: usize,
    pub elapsed_ms: u64,
    pub cookies: Vec<CookieEntry>,
}

impl Serialize for KV {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("KV", 2)?;
        state.serialize_field("key", &self.key)?;
        state.serialize_field("value", &self.value)?;
        state.end()
    }
}

fn build_auth_headers(auth: &AuthPayload) -> Result<Vec<(String, String)>, String> {
    let mut headers = Vec::new();
    match auth.auth_type.as_str() {
        "bearer" => {
            if let Some(cfg) = &auth.config {
                let token = cfg
                    .get("token")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !token.is_empty() {
                    headers.push(("Authorization".to_string(), format!("Bearer {}", token)));
                }
            }
        }
        "basic" => {
            if let Some(cfg) = &auth.config {
                let username = cfg.get("username").and_then(|v| v.as_str()).unwrap_or("");
                let password = cfg.get("password").and_then(|v| v.as_str()).unwrap_or("");
                use base64::Engine;
                let encoded =
                    base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", username, password));
                headers.push(("Authorization".to_string(), format!("Basic {}", encoded)));
            }
        }
        "api_key" => {
            if let Some(cfg) = &auth.config {
                let key = cfg.get("key").and_then(|v| v.as_str()).unwrap_or("");
                let value = cfg.get("value").and_then(|v| v.as_str()).unwrap_or("");
                let add_to = cfg.get("add_to").and_then(|v| v.as_str()).unwrap_or("header");
                if add_to == "header" && !key.is_empty() {
                    headers.push((key.to_string(), value.to_string()));
                }
                // query params are handled on the frontend side
            }
        }
        "oauth2" => {
            // OAuth2: the frontend should have already fetched the token
            // and placed it in config.cached_token
            if let Some(cfg) = &auth.config {
                let token = cfg
                    .get("cached_token")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !token.is_empty() {
                    headers.push(("Authorization".to_string(), format!("Bearer {}", token)));
                }
            }
        }
        _ => {} // "none" or unknown
    }
    Ok(headers)
}

#[tauri::command]
pub async fn api_send_request(payload: RequestPayload) -> Result<RequestResponse, String> {
    // Build client
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(payload.disable_ssl_verify)
        .timeout(Duration::from_secs(if payload.timeout_seconds > 0 {
            payload.timeout_seconds
        } else {
            30
        }))
        .cookie_store(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    // Parse method
    let method: reqwest::Method = payload
        .method
        .parse()
        .map_err(|_| format!("Invalid HTTP method: {}", payload.method))?;

    // Build URL with query params
    let mut url =
        reqwest::Url::parse(&payload.url).map_err(|e| format!("Invalid URL: {}", e))?;
    for p in &payload.params {
        if !p.key.is_empty() {
            url.query_pairs_mut().append_pair(&p.key, &p.value);
        }
    }

    // Build request
    let mut req = client.request(method, url);

    // Headers
    let mut header_map = HeaderMap::new();
    for h in &payload.headers {
        if h.key.is_empty() {
            continue;
        }
        if let (Ok(name), Ok(val)) = (
            HeaderName::from_bytes(h.key.as_bytes()),
            HeaderValue::from_str(&h.value),
        ) {
            header_map.insert(name, val);
        }
    }

    // Auth headers
    let auth_headers = build_auth_headers(&payload.auth)?;
    for (k, v) in &auth_headers {
        if let (Ok(name), Ok(val)) =
            (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v))
        {
            header_map.insert(name, val);
        }
    }

    req = req.headers(header_map);

    // Body
    if let Some(body) = &payload.body {
        match body.body_type.as_str() {
            "json" => {
                if let Some(content) = &body.content {
                    req = req
                        .header("Content-Type", "application/json")
                        .body(content.clone());
                }
            }
            "raw" => {
                if let Some(content) = &body.content {
                    req = req.body(content.clone());
                }
            }
            "urlencoded" => {
                if let Some(content) = &body.content {
                    // content is JSON array of {key, value}
                    if let Ok(pairs) = serde_json::from_str::<Vec<KV>>(content) {
                        let form: Vec<(String, String)> =
                            pairs.into_iter().map(|p| (p.key, p.value)).collect();
                        req = req.form(&form);
                    }
                }
            }
            "form_data" => {
                if let Some(content) = &body.content {
                    // content is JSON array of {key, value}
                    if let Ok(pairs) = serde_json::from_str::<Vec<KV>>(content) {
                        let mut form = reqwest::multipart::Form::new();
                        for p in pairs {
                            form = form.text(p.key, p.value);
                        }
                        req = req.multipart(form);
                    }
                }
            }
            _ => {} // "none" or "binary"
        }
    }

    // Send & time
    let start = std::time::Instant::now();
    let response = req.send().await.map_err(|e| format!("Request failed: {}", e))?;
    let elapsed_ms = start.elapsed().as_millis() as u64;

    // Parse response
    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("Unknown")
        .to_string();

    let resp_headers: Vec<KV> = response
        .headers()
        .iter()
        .map(|(k, v)| KV {
            key: k.to_string(),
            value: v.to_str().unwrap_or("").to_string(),
        })
        .collect();

    let body = response.text().await.unwrap_or_default();
    let body_size = body.len();

    Ok(RequestResponse {
        status,
        status_text,
        headers: resp_headers,
        body,
        body_size,
        elapsed_ms,
        cookies: vec![],
    })
}

/// Fetch an OAuth2 token using client_credentials grant
#[tauri::command]
pub async fn api_fetch_oauth2_token(
    token_url: String,
    client_id: String,
    client_secret: String,
    scope: String,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let mut params = vec![
        ("grant_type", "client_credentials".to_string()),
        ("client_id", client_id),
        ("client_secret", client_secret),
    ];
    if !scope.is_empty() {
        params.push(("scope", scope));
    }

    let resp = client
        .post(&token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("OAuth2 token request failed: {}", e))?;

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read OAuth2 response: {}", e))?;

    serde_json::from_str(&body).map_err(|e| format!("Invalid OAuth2 response JSON: {}", e))
}
