#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod oauth_loopback; // you already have this
mod tasks;          // <-- add this

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      oauth_loopback::oauth_start_loopback,
      tasks::list_google_tasks, // <-- add this
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri app");
}
