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

/// The directory itself, if the request path is a dir under `root` (no index.html check).
fn resolve_dir(root: &Path, raw: &str) -> Option<PathBuf> {
    let path = raw.split(['?', '#']).next().unwrap_or("/");
    let decoded = percent_decode(path);
    let rel = decoded.trim_start_matches('/');
    let canon = root.join(rel).canonicalize().ok()?;
    let root_canon = root.canonicalize().ok()?;
    (canon.starts_with(&root_canon) && canon.is_dir()).then_some(canon)
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn href_encode(s: &str) -> String {
    s.replace('%', "%25").replace('#', "%23").replace('?', "%3F").replace(' ', "%20")
}

fn human_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 {
        format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    } else if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.0} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}

/// File-browser page for folders with no index.html (FoldDeck's file-server mode).
fn listing_html(dir: &Path, url_path: &str) -> String {
    let mut dirs: Vec<(String, u64)> = Vec::new();
    let mut files: Vec<(String, u64)> = Vec::new();
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = entry.metadata().ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        if meta.map(|m| m.is_dir()).unwrap_or(false) {
            dirs.push((name, 0));
        } else {
            files.push((name, size));
        }
    }
    dirs.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    files.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));

    let base = if url_path.ends_with('/') { url_path.to_string() } else { format!("{}/", url_path) };
    let mut rows = String::new();
    if url_path != "/" {
        rows.push_str("<tr><td colspan=\"2\"><a class=\"d\" href=\"../\">../</a></td></tr>");
    }
    for (name, _) in &dirs {
        rows.push_str(&format!(
            "<tr><td><a class=\"d\" href=\"{}{}/\">{}/</a></td><td></td></tr>",
            href_encode(&base),
            href_encode(name),
            html_escape(name)
        ));
    }
    for (name, size) in &files {
        rows.push_str(&format!(
            "<tr><td><a href=\"{}{}\">{}</a></td><td>{}</td></tr>",
            href_encode(&base),
            href_encode(name),
            html_escape(name),
            human_size(*size)
        ));
    }
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title><style>\
body{{background:#0d1117;color:#e6edf3;font:14px/1.6 'Segoe UI',sans-serif;max-width:860px;margin:0 auto;padding:24px}}\
h1{{font-size:16px;font-family:Consolas,monospace;border-bottom:1px solid #21262d;padding-bottom:10px}}\
table{{border-collapse:collapse;width:100%;font-family:Consolas,monospace;font-size:13px}}\
td{{padding:6px 8px;border-bottom:1px solid #21262d}}td:last-child{{color:#8b949e;text-align:right;white-space:nowrap}}\
a{{color:#58a6ff;text-decoration:none}}a:hover{{text-decoration:underline}}a.d{{color:#e6edf3;font-weight:600}}\
footer{{color:#8b949e;font-size:11px;margin-top:16px}}</style></head><body>\
<h1>{title}</h1><table>{rows}</table><footer>FoldDeck file server</footer></body></html>",
        title = html_escape(url_path),
        rows = rows
    )
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
        // Directory without index.html → serve a file-browser listing.
        None if resolve_dir(root, raw_path).is_some() => {
            let dir = resolve_dir(root, raw_path).unwrap();
            let url_path = percent_decode(raw_path.split(['?', '#']).next().unwrap_or("/"));
            let body = listing_html(&dir, &url_path);
            let head = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\ncache-control: no-cache\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            if method == "GET" {
                let _ = stream.write_all(body.as_bytes());
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

        // Directory listing: /sub has no index.html → dir resolves, traversal blocked.
        assert!(resolve_path(&dir, "/sub").is_none());
        assert!(resolve_dir(&dir, "/sub").is_some());
        assert!(resolve_dir(&dir, "/../../").is_none());
        let html = listing_html(&dir.join("sub"), "/sub");
        assert!(html.contains("a b.txt"));
        assert!(html.contains("href=\"/sub/a%20b.txt\""));
        assert!(html.contains("../"));
    }
}
