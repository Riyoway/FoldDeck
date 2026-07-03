mod audit;
mod detect;
mod env_file;
mod process;
mod recipes;
mod static_server;
mod terminal;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    start_command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    file_server: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pinned: bool,
}

pub struct AppState {
    pub manager: ProcessManager,
    pub terminals: terminal::TerminalManager,
    projects: Mutex<Vec<StoredProject>>,
    store_path: PathBuf,
    recipes_dir: PathBuf,
    recipes: Mutex<Vec<recipes::Recipe>>,
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
                .map(|path| StoredProject {
                    path,
                    start_command: None,
                    name: None,
                    port: None,
                    file_server: None,
                    pinned: false,
                })
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
    if let Some(name) = &stored.name {
        info.name = name.clone();
    }
    if stored.port.is_some() {
        info.default_port = stored.port;
    }
    info.file_server = stored.file_server.clone();
    info.pinned = stored.pinned;
    if info.kind == "unknown" && info.file_server.is_some() && info.framework.is_none() {
        info.framework = Some("File Server".into());
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
    project_info_with(stored, &state.recipes.lock().unwrap())
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
        projects.push(StoredProject {
            path: path.clone(),
            start_command: None,
            name: None,
            port: None,
            file_server: None,
            pinned: false,
        });
        save_store(&state.store_path, &projects);
    }
    Ok(detect(&path))
}

#[tauri::command]
fn remove_project(id: String, state: tauri::State<AppState>) {
    let _ = state.manager.stop(&id);
    state.terminals.close(&id);
    let mut projects = state.projects.lock().unwrap();
    projects.retain(|p| project_id(&p.path) != id);
    save_store(&state.store_path, &projects);
}

#[tauri::command]
fn reorder_projects(ids: Vec<String>, state: tauri::State<AppState>) {
    let mut projects = state.projects.lock().unwrap();
    // Sort stored projects to match the given id order; anything not listed
    // keeps its relative position at the end.
    projects.sort_by_key(|p| {
        ids.iter()
            .position(|id| *id == project_id(&p.path))
            .unwrap_or(usize::MAX)
    });
    save_store(&state.store_path, &projects);
}

fn update_stored(
    state: &tauri::State<AppState>,
    id: &str,
    f: impl FnOnce(&mut StoredProject),
) -> Result<(), String> {
    let mut projects = state.projects.lock().unwrap();
    let stored = projects
        .iter_mut()
        .find(|p| project_id(&p.path) == id)
        .ok_or("Unknown project.")?;
    f(stored);
    save_store(&state.store_path, &projects);
    Ok(())
}

#[tauri::command]
fn set_start_command(
    id: String,
    command: Option<String>,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    update_stored(&state, &id, |p| {
        p.start_command = command.filter(|c| !c.trim().is_empty());
    })
}

#[tauri::command]
fn set_project_name(
    id: String,
    name: Option<String>,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    update_stored(&state, &id, |p| {
        p.name = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    })
}

#[tauri::command]
fn set_project_port(
    id: String,
    port: Option<u16>,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    update_stored(&state, &id, |p| p.port = port)
}

#[tauri::command]
fn set_pinned(id: String, pinned: bool, state: tauri::State<AppState>) -> Result<(), String> {
    update_stored(&state, &id, |p| p.pinned = pinned)
}

#[tauri::command]
fn set_file_server(
    id: String,
    mode: Option<String>,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    if let Some(m) = &mode {
        if m != "builtin" && m != "python" {
            return Err(format!("Unknown file server mode: {}", m));
        }
    }
    update_stored(&state, &id, |p| p.file_server = mode)
}

/// Serves an unrecognized folder as a file server (built-in listing server or
/// python -m http.server), remembering the chosen mode.
#[tauri::command]
fn start_file_server(
    id: String,
    mode: String,
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    update_stored(&state, &id, |p| p.file_server = Some(mode.clone()))?;
    let stored = find_stored(&state, &id)?;
    let info = project_info(&state, &stored);
    match mode.as_str() {
        "builtin" => state.manager.start_static(&app, &info),
        "python" => {
            let port = stored.port.unwrap_or(8000);
            let cmd = format!("python -m http.server {} --bind 127.0.0.1", port);
            state.manager.start(&app, &info, &cmd, &[])
        }
        other => Err(format!("Unknown file server mode: {}", other)),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestBucket {
    minute: u64,
    count: u32,
}

#[tauri::command]
fn get_request_stats(id: String, state: tauri::State<AppState>) -> Vec<RequestBucket> {
    state
        .manager
        .request_stats(&id)
        .into_iter()
        .map(|(minute, count)| RequestBucket { minute, count })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortInfo {
    port: u16,
    project_id: String,
    project_name: String,
    running: bool,
    busy: bool,
    overridden: bool,
}

#[tauri::command]
fn get_ports_overview(state: tauri::State<AppState>) -> Vec<PortInfo> {
    let stored: Vec<StoredProject> = state.projects.lock().unwrap().clone();
    stored
        .iter()
        .filter_map(|sp| {
            let info = project_info(&state, sp);
            let status = state.manager.status(&info.id);
            // Prefer the live port parsed from the detected URL while running.
            let live_port = status.url.as_deref().and_then(|u| {
                u.rsplit(':').next().and_then(|p| p.parse::<u16>().ok())
            });
            let port = live_port.or(info.default_port)?;
            let busy = status.running
                || std::net::TcpListener::bind(("127.0.0.1", port)).is_err();
            Some(PortInfo {
                port,
                project_id: info.id,
                project_name: info.name,
                running: status.running,
                busy,
                overridden: sp.port.is_some(),
            })
        })
        .collect()
}

#[tauri::command]
fn start_project(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let stored = find_stored(&state, &id)?;
    let info = project_info(&state, &stored);
    if info.kind == "static-site" && info.start_command.is_none() {
        return state.manager.start_static(&app, &info);
    }
    let cmd = info
        .start_command
        .clone()
        .ok_or("No start command detected for this project.")?;
    // ponytail: PORT env covers Next/Express/most Node servers; Vite needs --port.
    let envs: Vec<(String, String)> = stored
        .port
        .map(|p| vec![("PORT".to_string(), p.to_string())])
        .unwrap_or_default();
    state.manager.start(&app, &info, &cmd, &envs)
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
    state.manager.start(&app, &info, &command, &[])
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
    state.manager.start(&app, &info, &cmd, &[])
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
        // Lockfiles are kept; only node_modules is removed. PowerShell syntax
        // since commands run through PowerShell.
        cmd = format!(
            "Remove-Item -Recurse -Force -ErrorAction SilentlyContinue node_modules; {}",
            cmd
        );
    }
    state.manager.start(&app, &info, &cmd, &[])
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
fn get_app_paths(state: tauri::State<AppState>) -> serde_json::Value {
    serde_json::json!({
        "appData": state.store_path.parent().map(|p| p.to_string_lossy()).unwrap_or_default(),
        "recipes": state.recipes_dir.to_string_lossy(),
    })
}

#[tauri::command]
fn reload_recipes(state: tauri::State<AppState>) -> usize {
    let loaded = recipes::load_recipes(&state.recipes_dir);
    let count = loaded.len();
    *state.recipes.lock().unwrap() = loaded;
    count
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

#[tauri::command]
fn get_default_clone_dir(app: tauri::AppHandle) -> Result<String, String> {
    let docs = app.path().document_dir().map_err(|e| e.to_string())?;
    Ok(docs.join("GitHub").to_string_lossy().to_string())
}

/// A "-..." URL would be parsed by git as a flag (e.g. --upload-pack=<cmd>
/// executes commands). Allowlist schemes and reject flag-like values.
fn validate_repo_url(url: &str) -> Result<(), String> {
    let allowed = ["https://", "http://", "ssh://", "git://"];
    let scp_like = url.starts_with("git@");
    if url.starts_with('-') || (!scp_like && !allowed.iter().any(|s| url.starts_with(s))) {
        return Err("Unsupported repository URL. Use https://, ssh://, git:// or git@host:path.".into());
    }
    Ok(())
}

fn repo_name_from_url(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches('/');
    let last = trimmed.rsplit(['/', ':']).next()?;
    let name = last.trim_end_matches(".git").trim();
    (!name.is_empty() && !name.contains(['\\', '?', '*', '<', '>', '|', '"'])).then(|| name.to_string())
}

/// Clones a repository into the configured directory and returns the new
/// project path. Progress lines stream via "git-import-log" events.
#[tauri::command]
fn git_import(
    url: String,
    dest_dir: Option<String>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use tauri::Emitter;

    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Repository URL is empty.".into());
    }
    validate_repo_url(&url)?;
    let name = repo_name_from_url(&url).ok_or("Could not determine a repository name from that URL.")?;
    let base = match dest_dir.filter(|d| !d.trim().is_empty()) {
        Some(d) => PathBuf::from(d),
        None => app
            .path()
            .document_dir()
            .map_err(|e| e.to_string())?
            .join("GitHub"),
    };
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let target = base.join(&name);
    if target.exists() {
        return Err(format!("{} already exists.", target.display()));
    }

    let mut cmd = Command::new("git");
    cmd.args(["clone", "--progress", "--", &url])
        .arg(&target)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to run git (is it installed?): {}", e))?;

    // git writes progress to stderr using \r updates; split on \r and \n.
    let mut readers: Vec<Box<dyn Read + Send>> = Vec::new();
    if let Some(out) = child.stdout.take() {
        readers.push(Box::new(out));
    }
    if let Some(err) = child.stderr.take() {
        readers.push(Box::new(err));
    }
    let mut threads = Vec::new();
    for mut reader in readers {
        let app = app.clone();
        threads.push(std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut line = String::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        for &b in &buf[..n] {
                            if b == b'\n' || b == b'\r' {
                                if !line.trim().is_empty() {
                                    let _ = app.emit(
                                        "git-import-log",
                                        serde_json::json!({ "line": line.clone() }),
                                    );
                                }
                                line.clear();
                            } else {
                                line.push(b as char);
                            }
                        }
                    }
                }
            }
        }));
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    for t in threads {
        let _ = t.join();
    }
    if !status.success() {
        let _ = std::fs::remove_dir_all(&target);
        return Err("git clone failed — check the URL and the log.".into());
    }
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn terminal_open(
    id: String,
    shell: String,
    cols: u16,
    rows: u16,
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    // cwd is the stored project dir, not arbitrary input.
    let dir = find_stored(&state, &id)?.path;
    state.terminals.open(&app, &id, &dir, &shell, cols, rows)
}

#[tauri::command]
fn terminal_input(id: String, data: Vec<u8>, state: tauri::State<AppState>) -> Result<(), String> {
    state.terminals.input(&id, &data)
}

#[tauri::command]
fn terminal_resize(id: String, cols: u16, rows: u16, state: tauri::State<AppState>) {
    state.terminals.resize(&id, cols, rows);
}

#[tauri::command]
fn terminal_close(id: String, state: tauri::State<AppState>) {
    state.terminals.close(&id);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MinecraftInfo {
    jar: Option<String>,
    port: u16,
    lan_ip: Option<String>,
    eula_exists: bool,
    eula_accepted: bool,
    properties_exists: bool,
    needs_first_run: bool,
}

/// LAN IPv4 of the interface that routes to the internet (no packets sent).
fn local_ip() -> Option<String> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    sock.local_addr().ok().map(|a| a.ip().to_string())
}

#[tauri::command]
fn get_minecraft_info(id: String, state: tauri::State<AppState>) -> Result<MinecraftInfo, String> {
    let dir_str = find_stored(&state, &id)?.path;
    let dir = Path::new(&dir_str);
    let jar = detect::minecraft_jar(dir);
    let eula_exists = dir.join("eula.txt").is_file();
    let properties_exists = dir.join("server.properties").is_file();
    Ok(MinecraftInfo {
        port: detect::minecraft_port(dir),
        lan_ip: local_ip(),
        eula_accepted: detect::eula_accepted(dir),
        // First run (java -jar) generates eula.txt + server.properties.
        needs_first_run: jar.is_some() && !eula_exists && !properties_exists,
        jar,
        eula_exists,
        properties_exists,
    })
}

/// Writes eula=true to eula.txt (the user's explicit agreement), creating it if
/// the server hasn't generated it yet.
#[tauri::command]
fn accept_minecraft_eula(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let dir_str = find_stored(&state, &id)?.path;
    let path = Path::new(&dir_str).join("eula.txt");
    let content = match std::fs::read_to_string(&path) {
        Ok(existing) => {
            let mut replaced = false;
            let mut out: Vec<String> = existing
                .lines()
                .map(|l| {
                    if l.trim().to_lowercase().starts_with("eula=") {
                        replaced = true;
                        "eula=true".to_string()
                    } else {
                        l.to_string()
                    }
                })
                .collect();
            if !replaced {
                out.push("eula=true".to_string());
            }
            out.join("\n") + "\n"
        }
        Err(_) => "# Accepted via FoldDeck. https://aka.ms/MinecraftEULA\neula=true\n".to_string(),
    };
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct PropEntry {
    key: String,
    value: String,
}

#[tauri::command]
fn read_minecraft_properties(
    id: String,
    state: tauri::State<AppState>,
) -> Result<Vec<PropEntry>, String> {
    let dir_str = find_stored(&state, &id)?.path;
    let raw = std::fs::read_to_string(Path::new(&dir_str).join("server.properties"))
        .map_err(|_| "server.properties not generated yet — start the server once.".to_string())?;
    Ok(raw
        .lines()
        .filter(|l| !l.trim_start().starts_with('#') && l.contains('='))
        .filter_map(|l| {
            let (k, v) = l.split_once('=')?;
            Some(PropEntry {
                key: k.trim().to_string(),
                value: v.trim().to_string(),
            })
        })
        .collect())
}

/// Updates one server.properties key, preserving other lines and comments.
#[tauri::command]
fn set_minecraft_property(
    id: String,
    key: String,
    value: String,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let dir_str = find_stored(&state, &id)?.path;
    let path = Path::new(&dir_str).join("server.properties");
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    // No newlines in a properties value.
    let value = value.replace(['\n', '\r'], "");
    let mut found = false;
    let mut out: Vec<String> = raw
        .lines()
        .map(|l| {
            if l.split_once('=').map(|(k, _)| k.trim() == key).unwrap_or(false)
                && !l.trim_start().starts_with('#')
            {
                found = true;
                format!("{}={}", key, value)
            } else {
                l.to_string()
            }
        })
        .collect();
    if !found {
        out.push(format!("{}={}", key, value));
    }
    std::fs::write(&path, out.join("\n") + "\n").map_err(|e| e.to_string())
}

#[tauri::command]
fn read_markdown(
    id: String,
    path: String,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    let dir = find_stored(&state, &id)?.path;
    let root = Path::new(&dir)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let full = root
        .join(&path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    // Stay inside the project and only read markdown.
    if !full.starts_with(&root) {
        return Err("Path is outside the project.".into());
    }
    let ext = full
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext != "md" && ext != "markdown" {
        return Err("Not a markdown file.".into());
    }
    let meta = full.metadata().map_err(|e| e.to_string())?;
    if meta.len() > 4 * 1024 * 1024 {
        return Err("File is too large to display.".into());
    }
    std::fs::read_to_string(&full).map_err(|e| e.to_string())
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
                terminals: terminal::TerminalManager::default(),
                projects: Mutex::new(projects),
                store_path,
                recipes: Mutex::new(recipes::load_recipes(&recipes_dir)),
                recipes_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            add_project,
            remove_project,
            reorder_projects,
            set_start_command,
            set_project_name,
            set_project_port,
            set_pinned,
            set_file_server,
            start_file_server,
            get_request_stats,
            get_ports_overview,
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
            get_app_paths,
            reload_recipes,
            read_env_file,
            save_env_file,
            create_env_from_example,
            get_minecraft_info,
            accept_minecraft_eula,
            read_minecraft_properties,
            set_minecraft_property,
            read_markdown,
            get_default_clone_dir,
            git_import,
            terminal_open,
            terminal_input,
            terminal_resize,
            terminal_close
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<AppState>() {
                    state.manager.stop_all();
                    state.terminals.close_all();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_repo_names_from_urls() {
        assert_eq!(repo_name_from_url("https://github.com/user/repo.git").as_deref(), Some("repo"));
        assert_eq!(repo_name_from_url("https://github.com/user/repo/").as_deref(), Some("repo"));
        assert_eq!(repo_name_from_url("git@github.com:user/my-app.git").as_deref(), Some("my-app"));
        assert_eq!(repo_name_from_url(""), None);
        assert_eq!(repo_name_from_url("https://github.com/user/bad|name"), None);
    }

    #[test]
    fn rejects_flag_like_and_unknown_scheme_urls() {
        assert!(validate_repo_url("--upload-pack=calc.exe").is_err());
        assert!(validate_repo_url("-oProxyCommand=calc").is_err());
        assert!(validate_repo_url("file:///C:/x").is_err());
        assert!(validate_repo_url("C:/local/repo").is_err());
        assert!(validate_repo_url("https://github.com/user/repo.git").is_ok());
        assert!(validate_repo_url("git@github.com:user/repo.git").is_ok());
        assert!(validate_repo_url("ssh://git@host/repo.git").is_ok());
    }
}
