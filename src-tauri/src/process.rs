use crate::detect::ProjectInfo;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const LOG_BUFFER_LINES: usize = 2000;

/// PowerShell prelude: refresh PATH from the registry (Machine + User) so tools
/// installed after the app launched — java, node, package managers — resolve.
const PATH_REFRESH: &str = "$env:Path=($env:Path+';'+[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User'));";

/// The single place every command is run: PowerShell (same as the Terminal tab)
/// with PATH refreshed and, optionally, the working directory set. Callers add
/// stdio/env and spawn. Keeps Start, Doctor, and dependency audits in ONE
/// environment so what runs and what's detected never disagree.
pub fn shell_command(dir: Option<&str>, script: &str) -> Command {
    let mut full = String::from(PATH_REFRESH);
    if let Some(d) = dir {
        full.push_str(&format!(" Set-Location -LiteralPath '{}';", d.replace('\'', "''")));
    }
    full.push(' ');
    full.push_str(script);
    let mut cmd = Command::new("powershell.exe");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // raw_arg keeps the script's quotes intact (Command::args escapes them).
        cmd.raw_arg("-NoLogo").raw_arg("-Command").raw_arg(&full);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    cmd.arg("-NoLogo").arg("-Command").arg(&full);
    cmd
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatus {
    pub id: String,
    pub running: bool,
    pub started_at: Option<u64>,
    pub url: Option<String>,
    pub network_url: Option<String>,
    pub crash_count: u32,
    pub last_exit_code: Option<i32>,
    pub last_stopped_at: Option<u64>,
}

enum ProcHandle {
    Child { pid: u32 },
    /// In-process server (static sites); stopping pokes the port to unblock accept.
    Internal { stop: Arc<AtomicBool>, port: u16 },
}

struct RunningProc {
    handle: ProcHandle,
    started_at: u64,
    user_stopped: Arc<AtomicBool>,
    url: Arc<Mutex<Option<String>>>,
    network_url: Arc<Mutex<Option<String>>>,
    /// Extra command to run in the project dir after stopping (docker compose stop).
    on_stop_command: Option<(String, String)>,
}

struct ProjectRuntime {
    proc: Option<RunningProc>,
    logs: Arc<Mutex<VecDeque<String>>>,
    crash_count: Arc<AtomicU32>,
    last_exit_code: Option<i32>,
    last_stopped_at: Option<u64>,
    /// (epoch minute, request count) rolling buckets parsed from log output.
    requests: Arc<Mutex<VecDeque<(u64, u32)>>>,
}

impl Default for ProjectRuntime {
    fn default() -> Self {
        Self {
            proc: None,
            logs: Arc::new(Mutex::new(VecDeque::new())),
            crash_count: Arc::new(AtomicU32::new(0)),
            last_exit_code: None,
            last_stopped_at: None,
            requests: Arc::new(Mutex::new(VecDeque::new())),
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

const REQUEST_MARKERS: &[&str] = &["GET /", "POST /", "PUT /", "DELETE /", "PATCH /", "HEAD /", "OPTIONS /"];

/// Heuristic: log lines that look like an HTTP access-log entry.
pub fn is_request_line(line: &str) -> bool {
    REQUEST_MARKERS.iter().any(|m| line.contains(m))
}

fn record_request(buckets: &Mutex<VecDeque<(u64, u32)>>) {
    let minute = now_secs() / 60;
    let mut b = buckets.lock().unwrap();
    match b.back_mut() {
        Some((m, n)) if *m == minute => *n += 1,
        _ => b.push_back((minute, 1)),
    }
    while b.front().map(|(m, _)| minute - m > 120).unwrap_or(false) {
        b.pop_front();
    }
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
/// Removes ANSI CSI escape sequences (ESC [ ... letter) so URL/request
/// detection isn't broken by coloured output.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&nc) = chars.peek() {
                    chars.next();
                    if nc.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// The URL token starting at `pos`, trimmed of a trailing slash.
fn url_token_at(line: &str, pos: usize, scheme_len: usize) -> String {
    let rest = &line[pos..];
    let end = rest
        .char_indices()
        .find(|(i, c)| {
            *i >= scheme_len && !c.is_ascii_alphanumeric() && !matches!(c, ':' | '/' | '.')
        })
        .map(|(i, _)| i)
        .unwrap_or(rest.len());
    rest[..end].trim_end_matches('/').to_string()
}

fn extract_local_url(line: &str) -> Option<String> {
    for host in ["http://localhost", "https://localhost", "http://127.0.0.1"] {
        if let Some(pos) = line.find(host) {
            return Some(url_token_at(line, pos, host.len()));
        }
    }
    None
}

/// A LAN URL like http://192.168.1.5:5173 (dev servers' "Network:" line).
fn extract_network_url(line: &str) -> Option<String> {
    for scheme in ["http://", "https://"] {
        let mut from = 0;
        while let Some(rel) = line[from..].find(scheme) {
            let pos = from + rel;
            let host_start = pos + scheme.len();
            let host: String = line[host_start..]
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            let octets: Vec<&str> = host.split('.').collect();
            let is_ipv4 = octets.len() == 4 && octets.iter().all(|o| o.parse::<u8>().is_ok());
            let is_loopback = host.starts_with("127.") || host == "0.0.0.0";
            // Require a port so we don't grab bare IPs from log noise.
            let has_port = line[host_start + host.len()..].starts_with(':');
            if is_ipv4 && !is_loopback && has_port {
                return Some(url_token_at(line, pos, scheme.len()));
            }
            from = pos + scheme.len();
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
    pub fn start(
        &self,
        app: &AppHandle,
        project: &ProjectInfo,
        command: &str,
        extra_env: &[(String, String)],
    ) -> Result<(), String> {
        let command = command.to_string();
        let mut projects = self.projects.lock().unwrap();
        let runtime = projects.entry(project.id.clone()).or_default();
        if runtime.proc.is_some() {
            return Err("Project is already running.".into());
        }

        // Every command runs through the one shell helper (PowerShell + PATH
        // refresh + Set-Location) so Start, Doctor and audits share an env.
        let mut cmd = shell_command(Some(&project.path), &command);
        cmd.current_dir(&project.path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());
        for (k, v) in extra_env {
            cmd.env(k, v);
        }
        let mut child = cmd.spawn().map_err(|e| format!("Failed to start: {}", e))?;

        let pid = child.id();
        let secrets = Arc::new(collect_secrets(project));
        let url_slot: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let net_slot: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
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
            let net_slot = net_slot.clone();
            let requests = runtime.requests.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(pipe);
                for line in reader.lines().map_while(Result::ok) {
                    let line = mask_secrets(&line, &secrets);
                    // Detection runs on an ANSI-free copy (Vite etc. colour the
                    // URL/port), while the coloured line is what gets displayed.
                    let plain = strip_ansi(&line);
                    if is_request_line(&plain) {
                        record_request(&requests);
                    }
                    if url_slot.lock().unwrap().is_none() {
                        if let Some(url) = extract_local_url(&plain) {
                            *url_slot.lock().unwrap() = Some(url.clone());
                            let _ = app.emit("project-url", LogEvent { id: id.clone(), line: url });
                        }
                    }
                    if net_slot.lock().unwrap().is_none() {
                        if let Some(url) = extract_network_url(&plain) {
                            *net_slot.lock().unwrap() = Some(url.clone());
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
        // Killing `docker compose up` leaves containers running; stop them too.
        let on_stop_command = command
            .contains("docker compose up")
            .then(|| ("docker compose stop".to_string(), project.path.clone()));
        runtime.proc = Some(RunningProc {
            handle: ProcHandle::Child { pid },
            started_at: now_secs(),
            user_stopped: user_stopped.clone(),
            url: url_slot,
            network_url: net_slot,
            on_stop_command,
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
                    rt.last_stopped_at = Some(now_secs());
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

    /// Runs an in-process static file server as a "running project".
    pub fn start_static(&self, app: &AppHandle, project: &ProjectInfo) -> Result<(), String> {
        let mut projects = self.projects.lock().unwrap();
        let runtime = projects.entry(project.id.clone()).or_default();
        if runtime.proc.is_some() {
            return Err("Project is already running.".into());
        }

        let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let url = format!("http://localhost:{}", port);
        let stop = Arc::new(AtomicBool::new(false));

        {
            let mut logs = runtime.logs.lock().unwrap();
            logs.clear();
            logs.push_back(format!("Serving {} at {}", project.path, url));
        }

        let url_slot = Arc::new(Mutex::new(Some(url.clone())));
        runtime.proc = Some(RunningProc {
            handle: ProcHandle::Internal { stop: stop.clone(), port },
            started_at: now_secs(),
            user_stopped: Arc::new(AtomicBool::new(true)), // never counts as a crash
            url: url_slot,
            network_url: Arc::new(Mutex::new(None)),
            on_stop_command: None,
        });

        let root = std::path::PathBuf::from(&project.path);
        let id = project.id.clone();
        let logs = runtime.logs.clone();
        let requests = runtime.requests.clone();
        let srv_app = app.clone();
        std::thread::spawn(move || {
            let app = srv_app;
            {
                let log_app = app.clone();
                let log_id = id.clone();
                crate::static_server::run(root, listener, stop, move |line| {
                    if is_request_line(&line) {
                        record_request(&requests);
                    }
                    {
                        let mut logs = logs.lock().unwrap();
                        if logs.len() >= LOG_BUFFER_LINES {
                            logs.pop_front();
                        }
                        logs.push_back(line.clone());
                    }
                    let _ = log_app.emit("project-log", LogEvent { id: log_id.clone(), line });
                });
            }
            if let Some(state) = app.try_state::<crate::AppState>() {
                let mut projects = state.manager.projects.lock().unwrap();
                if let Some(rt) = projects.get_mut(&id) {
                    rt.proc = None;
                    rt.last_exit_code = Some(0);
                    rt.last_stopped_at = Some(now_secs());
                }
            }
            let _ = app.emit(
                "project-exit",
                serde_json::json!({ "id": id, "code": 0, "crashed": false }),
            );
        });

        let _ = app.emit("project-url", LogEvent { id: project.id.clone(), line: url });
        let _ = app.emit(
            "project-started",
            serde_json::json!({ "id": project.id, "pid": 0 }),
        );
        Ok(())
    }

    pub fn stop(&self, id: &str) -> Result<(), String> {
        let (handle_info, on_stop) = {
            let projects = self.projects.lock().unwrap();
            let rt = projects.get(id).ok_or("Project is not running.")?;
            let proc = rt.proc.as_ref().ok_or("Project is not running.")?;
            proc.user_stopped.store(true, Ordering::SeqCst);
            let info = match &proc.handle {
                ProcHandle::Child { pid } => Ok(*pid),
                ProcHandle::Internal { stop, port } => {
                    stop.store(true, Ordering::SeqCst);
                    Err(*port)
                }
            };
            (info, proc.on_stop_command.clone())
        };
        match handle_info {
            Ok(pid) => {
                // Kill the whole tree: package managers spawn node/python children.
                let mut kill = Command::new("taskkill");
                kill.args(["/PID", &pid.to_string(), "/T", "/F"]);
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    kill.creation_flags(0x08000000);
                }
                kill.output().map_err(|e| e.to_string())?;
            }
            Err(port) => {
                // Poke the listener so the blocking accept sees the stop flag.
                let _ = std::net::TcpStream::connect(("127.0.0.1", port));
            }
        }
        if let Some((cmd, dir)) = on_stop {
            let mut stop_cmd = shell_command(Some(&dir), &cmd);
            stop_cmd.stdout(Stdio::null()).stderr(Stdio::null());
            let _ = stop_cmd.spawn();
        }
        Ok(())
    }

    pub fn request_stats(&self, id: &str) -> Vec<(u64, u32)> {
        self.projects
            .lock()
            .unwrap()
            .get(id)
            .map(|rt| rt.requests.lock().unwrap().iter().copied().collect())
            .unwrap_or_default()
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
                network_url: rt.proc.as_ref().and_then(|p| p.network_url.lock().unwrap().clone()),
                crash_count: rt.crash_count.load(Ordering::SeqCst),
                last_exit_code: rt.last_exit_code,
                last_stopped_at: rt.last_stopped_at,
            },
            None => ProjectStatus {
                id: id.to_string(),
                running: false,
                started_at: None,
                url: None,
                network_url: None,
                crash_count: 0,
                last_exit_code: None,
                last_stopped_at: None,
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
    fn detects_request_lines() {
        assert!(is_request_line("GET /api/users 200 12ms"));
        assert!(is_request_line("::1 - - [01/Jul/2026] \"POST /login HTTP/1.1\" 302"));
        assert!(!is_request_line("Compiled successfully in 300ms"));
        assert!(!is_request_line("GETTING started"));
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
        assert_eq!(
            extract_network_url("  ➜  Network: http://192.168.1.5:5173/").as_deref(),
            Some("http://192.168.1.5:5173")
        );
        assert_eq!(extract_network_url("Local: http://localhost:5173/"), None);
        assert_eq!(extract_network_url("http://127.0.0.1:8000/"), None);
        // Vite colours the port with ANSI codes between the colon and digits.
        assert_eq!(
            extract_local_url(&strip_ansi("Local:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m"))
                .as_deref(),
            Some("http://localhost:5173")
        );
    }
}
