use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

fn mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "webp" => "image/webp",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "txt" | "md" => "text/plain; charset=utf-8",
        "wasm" => "application/wasm",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Maps a raw request path to a file under `root`, or None (traversal / missing).
pub fn resolve_path(root: &Path, raw: &str) -> Option<PathBuf> {
    let path = raw.split(['?', '#']).next().unwrap_or("/");
    let decoded = percent_decode(path);
    let rel = decoded.trim_start_matches('/');
    let mut full = root.join(rel);
    if full.is_dir() {
        full = full.join("index.html");
    }
    let canon = full.canonicalize().ok()?;
    let root_canon = root.canonicalize().ok()?;
    if !canon.starts_with(&root_canon) {
        return None;
    }
    canon.is_file().then_some(canon)
}

fn handle(stream: &mut TcpStream, root: &Path) -> (String, u16) {
    let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return (String::new(), 0);
    }
    // Drain headers so the client is happy with our response.
    let mut line = String::new();
    while reader.read_line(&mut line).is_ok() && line != "\r\n" && !line.is_empty() {
        line.clear();
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let raw_path = parts.next().unwrap_or("/");
    if method != "GET" && method != "HEAD" {
        let _ = stream.write_all(b"HTTP/1.1 405 Method Not Allowed\r\ncontent-length: 0\r\n\r\n");
        return (format!("{} {}", method, raw_path), 405);
    }

    match resolve_path(root, raw_path) {
        Some(file) => {
            let body = std::fs::read(&file).unwrap_or_default();
            let head = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: {}\r\ncontent-length: {}\r\ncache-control: no-cache\r\n\r\n",
                mime(&file),
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            if method == "GET" {
                let _ = stream.write_all(&body);
            }
            (format!("{} {}", method, raw_path), 200)
        }
        None => {
            let body = b"404 Not Found";
            let head = format!(
                "HTTP/1.1 404 Not Found\r\ncontent-type: text/plain\r\ncontent-length: {}\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(body);
            (format!("{} {}", method, raw_path), 404)
        }
    }
}

/// Blocking accept loop. Returns when `stop` is set (stop() pokes the port to
/// unblock accept). ponytail: serves one request at a time — fine for local
/// static sites, switch to a thread-per-conn if someone hosts a video gallery.
pub fn run(root: PathBuf, listener: TcpListener, stop: Arc<AtomicBool>, mut log: impl FnMut(String)) {
    for stream in listener.incoming() {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let Ok(mut stream) = stream else { continue };
        let (req, status) = handle(&mut stream, &root);
        if status != 0 {
            log(format!("{} {}", req, status));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_and_blocks_traversal() {
        let dir = std::env::temp_dir().join("folddeck-test-static");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("index.html"), "<html></html>").unwrap();
        std::fs::write(dir.join("sub").join("a b.txt"), "x").unwrap();

        assert!(resolve_path(&dir, "/").is_some());
        assert!(resolve_path(&dir, "/index.html?v=1").is_some());
        assert!(resolve_path(&dir, "/sub/a%20b.txt").is_some());
        assert!(resolve_path(&dir, "/missing.html").is_none());
        assert!(resolve_path(&dir, "/../../windows/system32/cmd.exe").is_none());
    }
}
