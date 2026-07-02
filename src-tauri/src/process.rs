use crate::detect::ProjectInfo;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const LOG_BUFFER_LINES: usize = 2000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatus {
    pub id: String,
    pub running: bool,
    pub started_at: Option<u64>,
    pub url: Option<String>,
    pub crash_count: u32,
    pub last_exit_code: Option<i32>,
}

struct RunningProc {
    child: Arc<Mutex<Child>>,
    pid: u32,
    started_at: u64,
    user_stopped: Arc<AtomicBool>,
    url: Arc<Mutex<Option<String>>>,
}

struct ProjectRuntime {
    proc: Option<RunningProc>,
    logs: Arc<Mutex<VecDeque<String>>>,
    crash_count: Arc<AtomicU32>,
    last_exit_code: Option<i32>,
}

impl Default for ProjectRuntime {
    fn default() -> Self {
        Self {
            proc: None,
            logs: Arc::new(Mutex::new(VecDeque::new())),
            crash_count: Arc::new(AtomicU32::new(0)),
            last_exit_code: None,
        }
    }
}

#[derive(Default)]
pub struct ProcessManager {
    projects: Mutex<HashMap<String, ProjectRuntime>>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Values of secret-looking keys from every env file in the project.
/// ponytail: masks known env values only; generic token-pattern scan can come later.
fn collect_secrets(project: &ProjectInfo) -> Vec<String> {
    let mut secrets = Vec::new();
    for f in &project.env_files {
        let path = Path::new(&project.path).join(f);
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            let key = key.trim();
            let value = value.trim().trim_matches('"').trim_matches('\'');
            if value.len() >= 6 && crate::env_file::is_secret_key(key) {
                secrets.push(value.to_string());
            }
        }
    }
    secrets
}

fn mask_secrets(line: &str, secrets: &[String]) -> String {
    let mut out = line.to_string();
    for s in secrets {
        if out.contains(s.as_str()) {
            out = out.replace(s.as_str(), "••••••••");
        }
    }
    out
}

/// First http(s)://localhost|127.0.0.1[:port] substring in a log line.
fn extract_local_url(line: &str) -> Option<String> {
    for host in ["http://localhost", "https://localhost", "http://127.0.0.1"] {
        if let Some(pos) = line.find(host) {
            let rest = &line[pos..];
            let end = rest
                .char_indices()
                .find(|(i, c)| {
                    *i >= host.len() && !c.is_ascii_alphanumeric() && !matches!(c, ':' | '/' | '.')
                })
                .map(|(i, _)| i)
                .unwrap_or(rest.len());
            let url = rest[..end].trim_end_matches('/');
            return Some(url.to_string());
        }
    }
    None
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEvent {
    id: String,
    line: String,
}

impl ProcessManager {
    pub fn start(&self, app: &AppHandle, project: &ProjectInfo) -> Result<(), String> {
        let command = project
            .start_command
            .clone()
            .ok_or("No start command detected for this project.")?;

        let mut projects = self.projects.lock().unwrap();
        let runtime = projects.entry(project.id.clone()).or_default();
        if runtime.proc.is_some() {
            return Err("Project is already running.".into());
        }

        let mut cmd = Command::new("cmd");
        cmd.args(["/C", &command])
            .current_dir(&project.path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("Failed to start: {}", e))?;

        let pid = child.id();
        let secrets = Arc::new(collect_secrets(project));
        let url_slot: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        {
            let mut logs = runtime.logs.lock().unwrap();
            logs.clear();
            logs.push_back(format!("$ {}", command));
        }

        for pipe in [stdout.map(|p| Box::new(p) as Box<dyn std::io::Read + Send>), stderr.map(|p| Box::new(p) as Box<dyn std::io::Read + Send>)]
            .into_iter()
            .flatten()
        {
            let app = app.clone();
            let id = project.id.clone();
            let logs = runtime.logs.clone();
            let secrets = secrets.clone();
            let url_slot = url_slot.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(pipe);
                for line in reader.lines().map_while(Result::ok) {
                    let line = mask_secrets(&line, &secrets);
                    if url_slot.lock().unwrap().is_none() {
                        if let Some(url) = extract_local_url(&line) {
                            *url_slot.lock().unwrap() = Some(url.clone());
                            let _ = app.emit("project-url", LogEvent { id: id.clone(), line: url });
                        }
                    }
                    {
                        let mut logs = logs.lock().unwrap();
                        if logs.len() >= LOG_BUFFER_LINES {
                            logs.pop_front();
                        }
                        logs.push_back(line.clone());
                    }
                    let _ = app.emit("project-log", LogEvent { id: id.clone(), line });
                }
            });
        }

        let child = Arc::new(Mutex::new(child));
        let user_stopped = Arc::new(AtomicBool::new(false));
        runtime.proc = Some(RunningProc {
            child: child.clone(),
            pid,
            started_at: now_secs(),
            user_stopped: user_stopped.clone(),
            url: url_slot,
        });

        // Waiter: detect exit, update state, emit status event.
        let wait_app = app.clone();
        let id = project.id.clone();
        let crash_count = runtime.crash_count.clone();
        std::thread::spawn(move || {
            let app = wait_app;
            let code = loop {
                match child.lock().unwrap().try_wait() {
                    Ok(Some(status)) => break status.code(),
                    Ok(None) => {}
                    Err(_) => break None,
                }
                std::thread::sleep(std::time::Duration::from_millis(300));
            };
            let crashed = !user_stopped.load(Ordering::SeqCst) && code.unwrap_or(1) != 0;
            if crashed {
                crash_count.fetch_add(1, Ordering::SeqCst);
            }
            if let Some(state) = app.try_state::<crate::AppState>() {
                let mut projects = state.manager.projects.lock().unwrap();
                if let Some(rt) = projects.get_mut(&id) {
                    rt.proc = None;
                    rt.last_exit_code = code;
                }
            }
            let _ = app.emit(
                "project-exit",
                serde_json::json!({ "id": id, "code": code, "crashed": crashed }),
            );
        });

        let _ = app.emit(
            "project-started",
            serde_json::json!({ "id": project.id, "pid": pid }),
        );
        Ok(())
    }

    pub fn stop(&self, id: &str) -> Result<(), String> {
        let pid = {
            let projects = self.projects.lock().unwrap();
            let rt = projects.get(id).ok_or("Project is not running.")?;
            let proc = rt.proc.as_ref().ok_or("Project is not running.")?;
            proc.user_stopped.store(true, Ordering::SeqCst);
            proc.pid
        };
        // Kill the whole tree: package managers spawn node/python children.
        let mut kill = Command::new("taskkill");
        kill.args(["/PID", &pid.to_string(), "/T", "/F"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            kill.creation_flags(0x08000000);
        }
        kill.output().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn logs(&self, id: &str) -> Vec<String> {
        self.projects
            .lock()
            .unwrap()
            .get(id)
            .map(|rt| rt.logs.lock().unwrap().iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn status(&self, id: &str) -> ProjectStatus {
        let projects = self.projects.lock().unwrap();
        match projects.get(id) {
            Some(rt) => ProjectStatus {
                id: id.to_string(),
                running: rt.proc.is_some(),
                started_at: rt.proc.as_ref().map(|p| p.started_at),
                url: rt.proc.as_ref().and_then(|p| p.url.lock().unwrap().clone()),
                crash_count: rt.crash_count.load(Ordering::SeqCst),
                last_exit_code: rt.last_exit_code,
            },
            None => ProjectStatus {
                id: id.to_string(),
                running: false,
                started_at: None,
                url: None,
                crash_count: 0,
                last_exit_code: None,
            },
        }
    }

    pub fn stop_all(&self) {
        let ids: Vec<String> = {
            let projects = self.projects.lock().unwrap();
            projects
                .iter()
                .filter(|(_, rt)| rt.proc.is_some())
                .map(|(id, _)| id.clone())
                .collect()
        };
        for id in ids {
            let _ = self.stop(&id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_secret_values() {
        let secrets = vec!["abc.def.ghi".to_string()];
        assert_eq!(
            mask_secrets("Logged in with token abc.def.ghi ok", &secrets),
            "Logged in with token •••••••• ok"
        );
    }

    #[test]
    fn extracts_local_url() {
        assert_eq!(
            extract_local_url("  - Local:   http://localhost:3000/  ").as_deref(),
            Some("http://localhost:3000")
        );
        assert_eq!(
            extract_local_url("ready on http://127.0.0.1:8000, press ctrl+c").as_deref(),
            Some("http://127.0.0.1:8000")
        );
        assert_eq!(extract_local_url("no url here"), None);
    }
}
