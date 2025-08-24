#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod oauth_loopback;
mod tasks;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            oauth_loopback::oauth_start_loopback,
            oauth_loopback::restore_session, // ← add
            oauth_loopback::sign_out,        // ← add
            tasks::list_google_tasks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri app");
}
