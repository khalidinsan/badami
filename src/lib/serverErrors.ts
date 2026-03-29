/**
 * Maps raw Rust/SSH/FTP error messages to user-friendly descriptions.
 */
export function classifyConnectionError(error: unknown): { title: string; detail: string } {
  const msg = String(error).toLowerCase();

  // Connection refused / unreachable
  if (msg.includes("connection refused")) {
    return {
      title: "Connection Refused",
      detail: "The server refused the connection. Check that the host and port are correct and the SSH/FTP service is running.",
    };
  }

  if (msg.includes("no such host") || msg.includes("name or service not known") || msg.includes("nodename nor servname")) {
    return {
      title: "Host Not Found",
      detail: "Could not resolve the hostname. Check the server address for typos.",
    };
  }

  if (msg.includes("timed out") || msg.includes("timeout")) {
    return {
      title: "Connection Timeout",
      detail: "The connection timed out. The server may be unreachable, or a firewall may be blocking the port.",
    };
  }

  if (msg.includes("network is unreachable") || msg.includes("host unreachable") || msg.includes("no route to host")) {
    return {
      title: "Host Unreachable",
      detail: "Cannot reach the server. Check your internet connection and the server address.",
    };
  }

  // Authentication errors
  if (msg.includes("auth") && (msg.includes("fail") || msg.includes("denied"))) {
    return {
      title: "Authentication Failed",
      detail: "The server rejected the credentials. Check the username, password, or PEM key.",
    };
  }

  if (msg.includes("password required")) {
    return {
      title: "Password Required",
      detail: "No password found in keychain. Edit the server and save a password.",
    };
  }

  if (msg.includes("pem") && (msg.includes("required") || msg.includes("invalid") || msg.includes("decode"))) {
    return {
      title: "PEM Key Error",
      detail: "The PEM key is missing or invalid. Check the key file path and format.",
    };
  }

  // Permission errors
  if (msg.includes("permission denied") || msg.includes("access denied")) {
    return {
      title: "Permission Denied",
      detail: "You don't have permission to perform this action on the server.",
    };
  }

  // SSH handshake
  if (msg.includes("handshake")) {
    return {
      title: "SSH Handshake Failed",
      detail: "Could not negotiate with the server. The server may use an unsupported protocol version.",
    };
  }

  // SFTP subsystem
  if (msg.includes("sftp subsystem")) {
    return {
      title: "SFTP Not Available",
      detail: "The server does not support the SFTP subsystem. Check the server configuration.",
    };
  }

  // Disconnected
  if (msg.includes("disconnect") || msg.includes("broken pipe") || msg.includes("connection reset")) {
    return {
      title: "Disconnected",
      detail: "The connection was lost. The server may have dropped the connection.",
    };
  }

  // No such file
  if (msg.includes("no such file") || msg.includes("not found")) {
    return {
      title: "Not Found",
      detail: "The requested file or directory does not exist on the server.",
    };
  }

  // Generic fallback
  return {
    title: "Error",
    detail: String(error),
  };
}
