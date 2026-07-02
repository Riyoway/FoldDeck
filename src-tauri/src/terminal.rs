use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const SCROLLBACK_BYTES: usize = 256 * 1024;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Recent raw output, replayed when a fresh terminal view re-attaches.
    buffer: Arc<Mutex<VecDeque<u8>>>,
}

#[derive(Default)]
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, Session>>,
}

fn shell() -> &'static str {
    if cfg!(windows) {
        "powershell.exe"
    } else {
        "/bin/bash"
    }
}

fn emit_output(app: &AppHandle, id: &str, bytes: &[u8]) {
    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    let _ = app.emit("terminal-output", serde_json::json!({ "id": id, "data": data }));
}

impl TerminalManager {
    pub fn open(
        &self,
        app: &AppHandle,
        id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        // Already open → replay scrollback so the re-mounted view shows history.
        if let Some(s) = sessions.get(id) {
            let buf = s.buffer.lock().unwrap();
            let snapshot: Vec<u8> = buf.iter().copied().collect();
            drop(buf);
            let _ = s.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
            if !snapshot.is_empty() {
                emit_output(app, id, &snapshot);
            }
            return Ok(());
        }

        let pty = native_pty_system();
        let pair = pty
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
        let mut cmd = CommandBuilder::new(shell());
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to start shell: {}", e))?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let buffer = Arc::new(Mutex::new(VecDeque::new()));
        let read_buffer = buffer.clone();
        let read_app = app.clone();
        let read_id = id.to_string();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        {
                            let mut b = read_buffer.lock().unwrap();
                            b.extend(&buf[..n]);
                            while b.len() > SCROLLBACK_BYTES {
                                b.pop_front();
                            }
                        }
                        emit_output(&read_app, &read_id, &buf[..n]);
                    }
                }
            }
            let _ = read_app.emit("terminal-exit", serde_json::json!({ "id": read_id }));
        });

        sessions.insert(id.to_string(), Session { master: pair.master, writer, child, buffer });
        Ok(())
    }

    pub fn input(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(s) = sessions.get_mut(id) {
            s.writer.write_all(data).map_err(|e| e.to_string())?;
            s.writer.flush().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) {
        let sessions = self.sessions.lock().unwrap();
        if let Some(s) = sessions.get(id) {
            let _ = s.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
        }
    }

    pub fn close(&self, id: &str) {
        if let Some(mut s) = self.sessions.lock().unwrap().remove(id) {
            let _ = s.child.kill();
        }
    }

    pub fn close_all(&self) {
        for (_, mut s) in self.sessions.lock().unwrap().drain() {
            let _ = s.child.kill();
        }
    }
}
