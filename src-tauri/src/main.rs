// Ophiuchus Tauri shell: window + plugins, nothing else. The view talks to
// the bun sidecar directly through plugin-shell; there is no custom Rust
// bridge on purpose (single ordered stdio stream — see the migration plan).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Spike-only: the gate page reports through here so results land on stdout,
// readable without the webview console. Dies with the spike.
#[tauri::command]
fn gate_report(line: String) {
    println!("[gate] {line}");
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![gate_report])
        .run(tauri::generate_context!())
        .expect("error while running ophiuchus shell");
}
