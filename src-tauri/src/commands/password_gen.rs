use rand::Rng;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct PasswordOptions {
    pub length: Option<usize>,
    pub uppercase: Option<bool>,
    pub lowercase: Option<bool>,
    pub numbers: Option<bool>,
    pub symbols: Option<bool>,
    pub exclude_ambiguous: Option<bool>,
}

#[derive(Serialize)]
pub struct GeneratedPassword {
    pub password: String,
    pub strength: String,
}

const LOWERCASE: &str = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NUMBERS: &str = "0123456789";
const SYMBOLS: &str = "!@#$%^&*()-_=+[]{}|;:,.<>?";

const AMBIGUOUS: &[char] = &['0', 'O', 'o', 'l', '1', 'I'];

fn calculate_strength(length: usize, charset_size: usize) -> String {
    let entropy = (length as f64) * (charset_size as f64).log2();
    if entropy >= 80.0 {
        "Very Strong".to_string()
    } else if entropy >= 60.0 {
        "Strong".to_string()
    } else if entropy >= 40.0 {
        "Medium".to_string()
    } else {
        "Weak".to_string()
    }
}

/// Generate a random password with configurable options.
#[tauri::command]
pub fn generate_password(options: PasswordOptions) -> Result<GeneratedPassword, String> {
    let length = options.length.unwrap_or(20).clamp(4, 128);
    let use_upper = options.uppercase.unwrap_or(true);
    let use_lower = options.lowercase.unwrap_or(true);
    let use_numbers = options.numbers.unwrap_or(true);
    let use_symbols = options.symbols.unwrap_or(true);
    let exclude_ambiguous = options.exclude_ambiguous.unwrap_or(false);

    let mut charset = String::new();
    if use_lower {
        charset.push_str(LOWERCASE);
    }
    if use_upper {
        charset.push_str(UPPERCASE);
    }
    if use_numbers {
        charset.push_str(NUMBERS);
    }
    if use_symbols {
        charset.push_str(SYMBOLS);
    }

    if charset.is_empty() {
        return Err("At least one character type must be enabled".to_string());
    }

    if exclude_ambiguous {
        charset = charset.chars().filter(|c| !AMBIGUOUS.contains(c)).collect();
    }

    let chars: Vec<char> = charset.chars().collect();
    let charset_size = chars.len();

    if charset_size == 0 {
        return Err("Character set is empty after filtering".to_string());
    }

    let mut rng = rand::thread_rng();

    // Generate password ensuring at least one char from each enabled category
    let mut password: Vec<char> = Vec::with_capacity(length);

    // First, add one required char from each enabled category
    let mut required: Vec<String> = Vec::new();
    if use_lower {
        let s: String = LOWERCASE.chars().filter(|c| !exclude_ambiguous || !AMBIGUOUS.contains(c)).collect();
        if !s.is_empty() { required.push(s); }
    }
    if use_upper {
        let s: String = UPPERCASE.chars().filter(|c| !exclude_ambiguous || !AMBIGUOUS.contains(c)).collect();
        if !s.is_empty() { required.push(s); }
    }
    if use_numbers {
        let s: String = NUMBERS.chars().filter(|c| !exclude_ambiguous || !AMBIGUOUS.contains(c)).collect();
        if !s.is_empty() { required.push(s); }
    }
    if use_symbols {
        required.push(SYMBOLS.to_string());
    }

    for req_chars in &required {
        let req: Vec<char> = req_chars.chars().collect();
        let idx = rng.gen_range(0..req.len());
        password.push(req[idx]);
    }

    // Fill remaining with random chars from full charset
    while password.len() < length {
        let idx = rng.gen_range(0..charset_size);
        password.push(chars[idx]);
    }

    // Shuffle to avoid predictable positions of required chars
    for i in (1..password.len()).rev() {
        let j = rng.gen_range(0..=i);
        password.swap(i, j);
    }

    let strength = calculate_strength(length, charset_size);

    Ok(GeneratedPassword {
        password: password.into_iter().collect(),
        strength,
    })
}
