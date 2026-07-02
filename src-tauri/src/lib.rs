mod detect;
mod env_file;
mod process;

use detect::{detect, project_id, ProjectInfo};
use env_file::EnvEntry;
use process::{ProcessManager, ProjectStatus};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub manager: ProcessManager,
    pub paths: Mutex<Vec<String>>,
    pub store_path: PathBuf,
}

fn load_paths(store: &Path) -> Vec<String> {
    std::fs::read_to_string(store)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_paths(store: &Path, paths: &[String]) {
    if let Ok(json) = serde_json::to_string_pretty(paths) {
        let _ = std::fs::write(store, json);
    }
}

#[tauri::command]
fn list_projects(state: tauri::State<AppState>) -> Vec<ProjectInfo> {
    state.paths.lock().unwrap().iter().map(|p| detect(p)).collect()
}

#[tauri::command]
fn add_project(path: String, state: tauri::State<AppState>) -> Result<ProjectInfo, String> {
    if !Path::new(&path).is_dir() {
        return Err(format!("Not a folder: {}", path));
    }
    let info = detect(&path);
    let mut paths = state.paths.lock().unwrap();
    if !paths.iter().any(|p| project_id(p) == info.id) {
        paths.push(path);
        save_paths(&state.store_path, &paths);
    }
    Ok(info)
}

#[tauri::command]
fn remove_project(id: String, state: tauri::State<AppState>) {
    let _ = state.manager.stop(&id);
    let mut paths = state.paths.lock().unwrap();
    paths.retain(|p| project_id(p) != id);
    save_paths(&state.store_path, &paths);
}

fn find_path(state: &tauri::State<AppState>, id: &str) -> Result<String, String> {
    state
        .paths
        .lock()
        .unwrap()
        .iter()
        .find(|p| project_id(p) == id)
        .cloned()
        .ok_or_else(|| "Unknown project.".into())
}

#[tauri::command]
fn start_project(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let info = detect(&find_path(&state, &id)?);
    state.manager.start(&app, &info)
}

#[tauri::command]
fn read_env_file(
    id: String,
    file_name: String,
    state: tauri::State<AppState>,
) -> Result<Vec<EnvEntry>, String> {
    let dir = find_path(&state, &id)?;
    env_file::read_entries(&env_file::env_path(&dir, &file_name)?)
}

#[tauri::command]
fn save_env_file(
    id: String,
    file_name: String,
    entries: Vec<EnvEntry>,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let dir = find_path(&state, &id)?;
    env_file::save_entries(&env_file::env_path(&dir, &file_name)?, &entries)
}

#[tauri::command]
fn create_env_from_example(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    env_file::create_from_example(&find_path(&state, &id)?)
}

#[tauri::command]
fn stop_project(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    state.manager.stop(&id)
}

#[tauri::command]
fn get_logs(id: String, state: tauri::State<AppState>) -> Vec<String> {
    state.manager.logs(&id)
}

#[tauri::command]
fn get_statuses(state: tauri::State<AppState>) -> Vec<ProjectStatus> {
    state
        .paths
        .lock()
        .unwrap()
        .iter()
        .map(|p| state.manager.status(&project_id(p)))
        .collect()
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let store_path = dir.join("projects.json");
            let paths = load_paths(&store_path);
            app.manage(AppState {
                manager: ProcessManager::default(),
                paths: Mutex::new(paths),
                store_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            add_project,
            remove_project,
            start_project,
            stop_project,
            get_logs,
            get_statuses,
            open_folder,
            read_env_file,
            save_env_file,
            create_env_from_example
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<AppState>() {
                    state.manager.stop_all();
                }
            }
        });
}
