mod audit;
mod detect;
mod env_file;
mod process;
mod recipes;
mod static_server;

use detect::{detect, project_id, ProjectInfo};
use env_file::EnvEntry;
use process::{ProcessManager, ProjectStatus};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredProject {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    start_command: Option<String>,
}

pub struct AppState {
    pub manager: ProcessManager,
    projects: Mutex<Vec<StoredProject>>,
    store_path: PathBuf,
    recipes: Vec<recipes::Recipe>,
}

fn load_store(store: &Path) -> Vec<StoredProject> {
    let Ok(raw) = std::fs::read_to_string(store) else {
        return Vec::new();
    };
    if let Ok(v) = serde_json::from_str::<Vec<StoredProject>>(&raw) {
        return v;
    }
    // Legacy format: plain array of path strings.
    serde_json::from_str::<Vec<String>>(&raw)
        .map(|paths| {
            paths
                .into_iter()
                .map(|path| StoredProject { path, start_command: None })
                .collect()
        })
        .unwrap_or_default()
}

fn save_store(store: &Path, projects: &[StoredProject]) {
    if let Ok(json) = serde_json::to_string_pretty(projects) {
        let _ = std::fs::write(store, json);
    }
}

fn find_stored(state: &tauri::State<AppState>, id: &str) -> Result<StoredProject, String> {
    state
        .projects
        .lock()
        .unwrap()
        .iter()
        .find(|p| project_id(&p.path) == id)
        .cloned()
        .ok_or_else(|| "Unknown project.".into())
}

fn project_info_with(stored: &StoredProject, recipes: &[recipes::Recipe]) -> ProjectInfo {
    let mut info = detect(&stored.path);
    if let Some(recipe) = recipes::matching_recipe(Path::new(&stored.path), recipes) {
        recipes::apply_recipe(&mut info, recipe);
    }
    if let Some(cmd) = &stored.start_command {
        info.start_command = Some(cmd.clone());
    }
    if let (Some(cmd), Some(pm)) = (&info.start_command, &info.package_manager) {
        let first = cmd.split_whitespace().next().unwrap_or("");
        if ["npm", "pnpm", "yarn", "bun"].contains(&first) && first != pm {
            info.warnings.push(format!(
                "Start command uses {} but the lockfile suggests {}.",
                first, pm
            ));
        }
    }
    info
}

fn project_info(state: &tauri::State<AppState>, stored: &StoredProject) -> ProjectInfo {
    project_info_with(stored, &state.recipes)
}

#[tauri::command]
fn list_projects(state: tauri::State<AppState>) -> Vec<ProjectInfo> {
    let stored: Vec<StoredProject> = state.projects.lock().unwrap().clone();
    stored.iter().map(|p| project_info(&state, p)).collect()
}

#[tauri::command]
fn add_project(path: String, state: tauri::State<AppState>) -> Result<ProjectInfo, String> {
    if !Path::new(&path).is_dir() {
        return Err(format!("Not a folder: {}", path));
    }
    let id = project_id(&path);
    let mut projects = state.projects.lock().unwrap();
    if !projects.iter().any(|p| project_id(&p.path) == id) {
        projects.push(StoredProject { path: path.clone(), start_command: None });
        save_store(&state.store_path, &projects);
    }
    Ok(detect(&path))
}

#[tauri::command]
fn remove_project(id: String, state: tauri::State<AppState>) {
    let _ = state.manager.stop(&id);
    let mut projects = state.projects.lock().unwrap();
    projects.retain(|p| project_id(&p.path) != id);
    save_store(&state.store_path, &projects);
}

#[tauri::command]
fn set_start_command(
    id: String,
    command: Option<String>,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let mut projects = state.projects.lock().unwrap();
    let stored = projects
        .iter_mut()
        .find(|p| project_id(&p.path) == id)
        .ok_or("Unknown project.")?;
    stored.start_command = command.filter(|c| !c.trim().is_empty());
    save_store(&state.store_path, &projects);
    Ok(())
}

#[tauri::command]
fn start_project(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let info = project_info(&state, &find_stored(&state, &id)?);
    if info.kind == "static-site" && info.start_command.is_none() {
        return state.manager.start_static(&app, &info);
    }
    let cmd = info
        .start_command
        .clone()
        .ok_or("No start command detected for this project.")?;
    state.manager.start(&app, &info, &cmd)
}

#[tauri::command]
fn run_command_audit(command: String) -> Vec<String> {
    audit::audit_command(&command)
}

#[tauri::command]
fn run_doctor(id: String, state: tauri::State<AppState>) -> Result<audit::DoctorReport, String> {
    let info = project_info(&state, &find_stored(&state, &id)?);
    let running = state.manager.status(&id).running;
    let logs = state.manager.logs(&id);
    Ok(audit::doctor(&info, running, &logs))
}

#[tauri::command]
fn run_dependency_audit(
    id: String,
    state: tauri::State<AppState>,
) -> Result<audit::DependencyAuditResult, String> {
    let info = project_info(&state, &find_stored(&state, &id)?);
    let pm = info.package_manager.as_deref().unwrap_or("npm");
    audit::dependency_audit(&info.path, pm)
}

#[tauri::command]
fn stop_project(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    state.manager.stop(&id)
}

#[tauri::command]
fn restart_project(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    if state.manager.status(&id).running {
        state.manager.stop(&id)?;
        for _ in 0..50 {
            if !state.manager.status(&id).running {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
    start_project(id, app, state)
}

/// Runs a one-off command (package script, install) in the project folder,
/// through the same log/masking pipeline as Start.
#[tauri::command]
fn run_project_command(
    id: String,
    command: String,
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let info = project_info(&state, &find_stored(&state, &id)?);
    state.manager.start(&app, &info, &command)
}

#[tauri::command]
fn install_dependencies(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let info = project_info(&state, &find_stored(&state, &id)?);
    let cmd = match info.package_manager.as_deref() {
        Some("npm") | Some("pnpm") | Some("yarn") | Some("bun") => {
            format!("{} install", info.package_manager.as_deref().unwrap())
        }
        Some("pip") => "pip install -r requirements.txt".into(),
        Some("uv") => "uv sync".into(),
        _ => return Err("No package manager detected.".into()),
    };
    state.manager.start(&app, &info, &cmd)
}

#[tauri::command]
fn reinstall_dependencies(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let info = project_info(&state, &find_stored(&state, &id)?);
    let pm = match info.package_manager.as_deref() {
        Some(pm @ ("npm" | "pnpm" | "yarn" | "bun")) => pm,
        _ => return Err("Reinstall is only supported for Node.js projects.".into()),
    };
    let mut cmd = format!("{} install", pm);
    if Path::new(&info.path).join("node_modules").exists() {
        // Lockfiles are kept; only node_modules is removed.
        cmd = format!("rmdir /s /q node_modules && {}", cmd);
    }
    state.manager.start(&app, &info, &cmd)
}

#[tauri::command]
fn get_logs(id: String, state: tauri::State<AppState>) -> Vec<String> {
    state.manager.logs(&id)
}

#[tauri::command]
fn get_statuses(state: tauri::State<AppState>) -> Vec<ProjectStatus> {
    state
        .projects
        .lock()
        .unwrap()
        .iter()
        .map(|p| state.manager.status(&project_id(&p.path)))
        .collect()
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_env_file(
    id: String,
    file_name: String,
    state: tauri::State<AppState>,
) -> Result<Vec<EnvEntry>, String> {
    let stored = find_stored(&state, &id)?;
    env_file::read_entries(&env_file::env_path(&stored.path, &file_name)?)
}

#[tauri::command]
fn save_env_file(
    id: String,
    file_name: String,
    entries: Vec<EnvEntry>,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let stored = find_stored(&state, &id)?;
    env_file::save_entries(&env_file::env_path(&stored.path, &file_name)?, &entries)
}

#[tauri::command]
fn create_env_from_example(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    env_file::create_from_example(&find_stored(&state, &id)?.path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let recipes_dir = dir.join("recipes");
            let _ = std::fs::create_dir_all(&recipes_dir);
            let store_path = dir.join("projects.json");
            let projects = load_store(&store_path);
            app.manage(AppState {
                manager: ProcessManager::default(),
                projects: Mutex::new(projects),
                store_path,
                recipes: recipes::load_recipes(&recipes_dir),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            add_project,
            remove_project,
            set_start_command,
            start_project,
            stop_project,
            restart_project,
            run_command_audit,
            run_doctor,
            run_dependency_audit,
            run_project_command,
            install_dependencies,
            reinstall_dependencies,
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
