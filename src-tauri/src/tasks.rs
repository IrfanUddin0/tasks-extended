use std::collections::HashMap;

use reqwest::Client;
use serde_json::Value;

#[tauri::command]
pub async fn list_google_tasks(access_token: String) -> Result<Value, String> {
    let url = "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?maxResults=100";

    let res = Client::new()
        .get(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("request error: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let txt = res.text().await.unwrap_or_default();
        return Err(format!("google returned {}: {}", status, txt));
    }

    res.json::<Value>()
        .await
        .map_err(|e| format!("decode error: {e}"))
}
