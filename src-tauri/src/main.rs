// Ophiuchus Tauri shell: window + plugins, nothing else. The view talks to
// the bun sidecar directly through plugin-shell; there is no custom Rust
// bridge on purpose (single ordered stdio stream — see the migration plan).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running ophiuchus shell");
}
