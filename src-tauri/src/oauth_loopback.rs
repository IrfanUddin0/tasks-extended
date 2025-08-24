use keyring::Entry;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    time::Duration,
};
use urlencoding::encode;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u32,
    pub token_type: String,
    pub scope: Option<String>,
}

fn pick_free_port() -> std::io::Result<(TcpListener, u16)> {
    // Bind to port 0 to let the OS pick a free port, keep the listener OPEN.
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    Ok((listener, port))
}

fn respond_ok(mut stream: TcpStream, body: &str) {
    let body_bytes = body.as_bytes();
    let response = format!(
    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
    body_bytes.len(),
    body
  );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
    // Try to close cleanly
    let _ = stream.shutdown(std::net::Shutdown::Both);
}

fn parse_code_from_request(stream: &TcpStream) -> Option<String> {
    // Read only headers (don’t wait for EOF)
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    // First line: e.g. "GET /callback?code=... HTTP/1.1"
    if reader.read_line(&mut request_line).ok()? == 0 {
        return None;
    }

    // Read and discard until end of headers
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).ok()? == 0 {
            break; // unexpected end
        }
        if line == "\r\n" {
            break; // end of headers
        }
    }

    // Extract path
    let path = request_line.split_whitespace().nth(1)?; // "/callback?code=..."
    let query = path.split('?').nth(1)?;
    // find "code=" param
    for kv in query.split('&') {
        if let Some(val) = kv.strip_prefix("code=") {
            if let Ok(decoded) = urlencoding::decode(val) {
                return Some(decoded.into_owned());
            }
        }
        if let Some(err) = kv.strip_prefix("error=") {
            // If Google sent an error, surface it (optional)
            eprintln!("OAuth error returned: {}", err);
        }
    }
    None
}

const SERVICE: &str = "com.irfanuddin.tasks"; // pick a stable id for your app
const ACCOUNT: &str = "google_tasks_refresh"; // key name for the stored token

fn save_refresh_token(refresh: &str) -> Result<(), String> {
    Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| format!("keyring: {e}"))?
        .set_password(refresh)
        .map_err(|e| format!("keyring set: {e}"))
}

fn load_refresh_token() -> Result<String, String> {
    Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| format!("keyring: {e}"))?
        .get_password()
        .map_err(|e| format!("keyring get: {e}"))
}

fn delete_refresh_token() -> Result<(), String> {
    Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| format!("keyring: {e}"))?
        .delete_password()
        .map_err(|e| format!("keyring del: {e}"))
}

#[tauri::command]
pub async fn oauth_start_loopback(
    client_id: String,
    client_secret: String,
    scopes: Option<String>,
) -> Result<TokenResponse, String> {
    let scope = scopes.unwrap_or_else(|| "https://www.googleapis.com/auth/tasks".to_string());

    // 1) Start listener FIRST and keep it open
    let (listener, port) = pick_free_port().map_err(|e| format!("bind: {e}"))?;
    // Optional: small accept timeout so we don’t hang forever if user closes window
    listener
        .set_nonblocking(false)
        .map_err(|e| format!("listener config: {e}"))?;

    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);

    // 2) Build auth URL
    let auth_url = format!(
    "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id={}&redirect_uri={}&scope={}&access_type=offline&prompt=consent",
    encode(&client_id),
    encode(&redirect_uri),
    encode(&scope),
  );

    // 3) Open system browser
    webbrowser::open(&auth_url).map_err(|e| format!("open browser: {e}"))?;

    // 4) Accept a single connection (the Google redirect)
    // You can add your own timeout logic if desired:
    listener
        .set_nonblocking(false)
        .map_err(|e| format!("listener config: {e}"))?;

    // This will block until the browser hits the redirect
    let (stream, _addr) = listener.accept().map_err(|e| format!("accept: {e}"))?;

    // 5) Parse the code from the incoming request without waiting for EOF
    let code =
        parse_code_from_request(&stream).ok_or_else(|| "no ?code in callback".to_string())?;

    // Send a friendly page to the user
    respond_ok(stream, "<html><body><h3>Signed in successfully</h3><p>You can close this window and return to the app.</p></body></html>");

    // 6) Exchange code for tokens
    let client = Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("code", code.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("token req: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("token exchange {}: {}", status, txt));
    }

    let token = resp
        .json::<TokenResponse>()
        .await
        .map_err(|e| format!("decode token: {e}"))?;

    // Persist refresh_token for next launches
    if let Some(ref rt) = token.refresh_token {
        let _ = save_refresh_token(rt); // ignore errors silently or return Err if you prefer
    }

    Ok(token)
}

#[tauri::command]
pub async fn restore_session(
    client_id: String,
    client_secret: String,
) -> Result<TokenResponse, String> {
    // Try to read refresh_token from keychain
    let refresh = load_refresh_token()?;

    // Exchange refresh_token for a new access_token
    let resp = Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("refresh req: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("refresh {}: {}", status, txt));
    }

    // Google often doesn't return refresh_token on refresh; include the one we used
    let mut token = resp
        .json::<TokenResponse>()
        .await
        .map_err(|e| format!("decode refresh: {e}"))?;
    if token.refresh_token.is_none() {
        token.refresh_token = Some(refresh);
    }

    Ok(token)
}

#[tauri::command]
pub async fn sign_out() -> Result<(), String> {
    delete_refresh_token()
}
