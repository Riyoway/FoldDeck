use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    /// web-app | static-site | backend-server | bot | worker | game-server | docker-compose | unknown
    pub kind: String,
    pub subtype: Option<String>,
    pub framework: Option<String>,
    pub runtime: Option<String>,
    pub package_manager: Option<String>,
    pub start_command: Option<String>,
    pub default_port: Option<u16>,
    pub scripts: BTreeMap<String, String>,
    pub env_files: Vec<String>,
    pub lockfiles: Vec<String>,
    pub deps_installed: Option<bool>,
    /// Site favicon as a data URI (web-app / static-site only).
    pub icon_data_uri: Option<String>,
    /// File-server mode chosen for unrecognized folders ("builtin" | "python").
    pub file_server: Option<String>,
    pub pinned: bool,
    /// Folder creation time (epoch seconds), for sorting.
    pub created: Option<u64>,
    /// Relative paths of markdown docs (README first).
    pub docs: Vec<String>,
    pub warnings: Vec<String>,
}

pub fn project_id(path: &str) -> String {
    let mut h = DefaultHasher::new();
    path.to_lowercase().hash(&mut h);
    format!("{:016x}", h.finish())
}

use crate::env_file::ENV_FILES;

const NODE_DISCORD_DEPS: &[&str] = &[
    "discord.js",
    "eris",
    "discordeno",
    "oceanic.js",
    "detritus-client",
];

const PY_DISCORD_MARKERS: &[&str] = &[
    "discord",
    "py-cord",
    "pycord",
    "nextcord",
    "disnake",
    "hikari",
    "interactions.py",
];

pub fn detect(path: &str) -> ProjectInfo {
    let mut info = classify(path);
    if matches!(info.kind.as_str(), "web-app" | "static-site") {
        info.icon_data_uri = find_favicon(Path::new(path));
    }
    info.docs = find_docs(Path::new(path));
    info.created = std::fs::metadata(path)
        .ok()
        .and_then(|m| m.created().or_else(|_| m.modified()).ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    info
}

fn is_markdown(name: &str) -> bool {
    let l = name.to_lowercase();
    l.ends_with(".md") || l.ends_with(".markdown")
}

/// Top-level and docs/ markdown files, README first.
fn find_docs(dir: &Path) -> Vec<String> {
    let mut docs: Vec<String> = Vec::new();
    let mut collect = |base: Option<&str>| {
        let target = base.map(|b| dir.join(b)).unwrap_or_else(|| dir.to_path_buf());
        for e in std::fs::read_dir(&target).into_iter().flatten().flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if e.path().is_file() && is_markdown(&name) {
                docs.push(base.map(|b| format!("{}/{}", b, name)).unwrap_or(name));
            }
        }
    };
    collect(None);
    if dir.join("docs").is_dir() {
        collect(Some("docs"));
    }
    docs.sort_by(|a, b| {
        let ar = a.to_lowercase().contains("readme");
        let br = b.to_lowercase().contains("readme");
        br.cmp(&ar).then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
    });
    docs.truncate(40);
    docs
}

const FAVICON_PATHS: &[&str] = &[
    "favicon.ico",
    "favicon.svg",
    "favicon.png",
    "icon.svg",
    "icon.png",
    "public/favicon.ico",
    "public/favicon.svg",
    "public/favicon.png",
    "public/favicon.jpg",
    "public/icon.svg",
    "public/icon.png",
    "public/logo.svg",
    "public/logo.png",
    // Next.js app-router icon conventions.
    "app/favicon.ico",
    "app/icon.ico",
    "app/icon.svg",
    "app/icon.png",
    "src/app/favicon.ico",
    "src/app/icon.ico",
    "src/app/icon.svg",
    "src/app/icon.png",
    "static/favicon.ico",
    "static/favicon.svg",
    "static/favicon.png",
    "assets/favicon.ico",
    "assets/favicon.svg",
    "assets/favicon.png",
];

const ENTRY_HTML: &[&str] = &["index.html", "public/index.html", "src/index.html"];

fn icon_data_uri(path: &Path) -> Option<String> {
    use base64::Engine;
    let meta = path.metadata().ok()?;
    if !meta.is_file() || meta.len() > 512 * 1024 {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let mime = match path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() {
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "image/x-icon",
    };
    Some(format!("data:{};base64,{}", mime, base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

/// Extracts the href of the first `<link rel="...icon...">` in the HTML.
fn parse_icon_href(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let mut from = 0;
    while let Some(rel) = lower[from..].find("<link") {
        let start = from + rel;
        let end = lower[start..].find('>').map(|e| start + e + 1).unwrap_or(html.len());
        let tag = &html[start..end];
        let tag_lower = &lower[start..end];
        from = end;
        if !(tag_lower.contains("rel=") && tag_lower.contains("icon")) {
            continue;
        }
        // Pull the quoted value of href=.
        if let Some(hpos) = tag_lower.find("href=") {
            let rest = &tag[hpos + 5..];
            let bytes = rest.as_bytes();
            let (quote, body) = match bytes.first() {
                Some(b'"') | Some(b'\'') => (bytes[0] as char, &rest[1..]),
                _ => continue,
            };
            if let Some(qend) = body.find(quote) {
                let href = body[..qend].trim().to_string();
                if !href.is_empty() && !href.starts_with("data:") && !href.starts_with("http") && !href.starts_with("//") {
                    return Some(href);
                }
            }
        }
    }
    None
}

fn find_favicon(dir: &Path) -> Option<String> {
    // 1. Honour the icon referenced by the entry HTML (arbitrary paths).
    for html in ENTRY_HTML {
        let html_path = dir.join(html);
        let Ok(content) = std::fs::read_to_string(&html_path) else { continue };
        let Some(href) = parse_icon_href(&content) else { continue };
        let rel = href.trim_start_matches('/');
        let base = html_path.parent().unwrap_or(dir);
        // Root-relative resolves from the project root; also try the doc's own dir.
        for cand in [dir.join(rel), base.join(&href), dir.join("public").join(rel)] {
            if let Some(uri) = icon_data_uri(&cand) {
                return Some(uri);
            }
        }
    }
    // 2. Common conventional locations.
    FAVICON_PATHS.iter().find_map(|rel| icon_data_uri(&dir.join(rel)))
}

fn classify(path: &str) -> ProjectInfo {
    let dir = Path::new(path);
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    let mut info = ProjectInfo {
        id: project_id(path),
        path: path.to_string(),
        name,
        kind: "unknown".into(),
        subtype: None,
        framework: None,
        runtime: None,
        package_manager: None,
        start_command: None,
        default_port: None,
        scripts: BTreeMap::new(),
        env_files: ENV_FILES
            .iter()
            .filter(|f| dir.join(f).is_file())
            .map(|f| f.to_string())
            .collect(),
        lockfiles: Vec::new(),
        deps_installed: None,
        icon_data_uri: None,
        file_server: None,
        pinned: false,
        created: None,
        docs: Vec::new(),
        warnings: Vec::new(),
    };

    if detect_compose(dir, &mut info) {
        return info;
    }
    if detect_minecraft(dir, &mut info) {
        return info;
    }
    if detect_node(dir, &mut info) {
        return info;
    }
    if detect_python(dir, &mut info) {
        return info;
    }
    if dir.join("index.html").is_file() {
        info.kind = "static-site".into();
        info.framework = Some("Static HTML".into());
        return info;
    }
    info
}

fn detect_compose(dir: &Path, info: &mut ProjectInfo) -> bool {
    let candidates = [
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
    ];
    if !candidates.iter().any(|f| dir.join(f).is_file()) {
        return false;
    }
    info.kind = "docker-compose".into();
    info.runtime = Some("docker".into());
    info.framework = Some("Docker Compose".into());
    info.start_command = Some("docker compose up".into());
    true
}

const MC_JAR_HINTS: &[&str] = &[
    "server", "paper", "purpur", "spigot", "fabric", "forge", "minecraft", "bukkit", "vanilla",
    "quilt", "neoforge",
];

pub fn minecraft_jar(dir: &Path) -> Option<String> {
    let jars: Vec<String> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let n = e.file_name().to_string_lossy().to_string();
            n.to_lowercase().ends_with(".jar").then_some(n)
        })
        .collect();
    jars.iter()
        .find(|j| MC_JAR_HINTS.iter().any(|p| j.to_lowercase().contains(p)))
        .or_else(|| jars.first())
        .cloned()
}

/// Reads server-port from server.properties (default 25565).
pub fn minecraft_port(dir: &Path) -> u16 {
    std::fs::read_to_string(dir.join("server.properties"))
        .ok()
        .and_then(|s| {
            s.lines()
                .find_map(|l| l.trim().strip_prefix("server-port="))
                .and_then(|v| v.trim().parse::<u16>().ok())
        })
        .unwrap_or(25565)
}

pub fn eula_accepted(dir: &Path) -> bool {
    std::fs::read_to_string(dir.join("eula.txt"))
        .map(|s| {
            s.lines()
                .any(|l| l.trim().to_lowercase().replace(' ', "") == "eula=true")
        })
        .unwrap_or(false)
}

fn detect_minecraft(dir: &Path, info: &mut ProjectInfo) -> bool {
    let jar = minecraft_jar(dir);
    let has_config = dir.join("server.properties").is_file() || dir.join("eula.txt").is_file();
    // A minecraft-hinted jar counts even before the first run generates config.
    let jar_is_mc = jar
        .as_deref()
        .map(|j| MC_JAR_HINTS.iter().any(|p| j.to_lowercase().contains(p)))
        .unwrap_or(false);
    if !has_config && !jar_is_mc {
        return false;
    }
    info.kind = "game-server".into();
    info.subtype = Some("minecraft".into());
    info.runtime = Some("java".into());
    info.framework = Some("Minecraft".into());
    info.default_port = Some(minecraft_port(dir));

    match &jar {
        Some(j) => info.start_command = Some(format!("java -Xmx2G -jar \"{}\" nogui", j)),
        None => info.warnings.push("No server .jar found.".into()),
    }

    if jar.is_some() && !eula_accepted(dir) {
        info.warnings
            .push("Minecraft EULA is not accepted — accept it in the Minecraft tab.".into());
    }
    true
}

fn detect_node(dir: &Path, info: &mut ProjectInfo) -> bool {
    let pkg_path = dir.join("package.json");
    let Ok(raw) = std::fs::read_to_string(&pkg_path) else {
        return false;
    };
    let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    info.runtime = Some("node".into());

    if let Some(scripts) = pkg.get("scripts").and_then(|s| s.as_object()) {
        for (k, v) in scripts {
            if let Some(cmd) = v.as_str() {
                info.scripts.insert(k.clone(), cmd.to_string());
            }
        }
    }

    let mut deps: Vec<String> = Vec::new();
    for key in ["dependencies", "devDependencies"] {
        if let Some(map) = pkg.get(key).and_then(|d| d.as_object()) {
            deps.extend(map.keys().cloned());
        }
    }
    let has = |d: &str| deps.iter().any(|x| x == d);

    if NODE_DISCORD_DEPS.iter().any(|d| has(d)) {
        info.kind = "bot".into();
        info.subtype = Some("discord".into());
        info.framework = NODE_DISCORD_DEPS
            .iter()
            .find(|d| has(d))
            .map(|d| d.to_string());
    } else if has("next") {
        info.kind = "web-app".into();
        info.framework = Some("Next.js".into());
        info.default_port = Some(3000);
    } else if has("nuxt") {
        info.kind = "web-app".into();
        info.framework = Some("Nuxt".into());
        info.default_port = Some(3000);
    } else if has("astro") {
        info.kind = "web-app".into();
        info.framework = Some("Astro".into());
        info.default_port = Some(4321);
    } else if has("@sveltejs/kit") {
        info.kind = "web-app".into();
        info.framework = Some("SvelteKit".into());
        info.default_port = Some(5173);
    } else if has("vite") {
        info.kind = "web-app".into();
        info.framework = Some("Vite".into());
        info.default_port = Some(5173);
    } else if has("react-scripts") {
        info.kind = "web-app".into();
        info.framework = Some("Create React App".into());
        info.default_port = Some(3000);
    } else if has("express") || has("fastify") || has("koa") || has("hono") || has("@nestjs/core") {
        info.kind = "backend-server".into();
        info.framework = ["express", "fastify", "koa", "hono", "@nestjs/core"]
            .iter()
            .find(|d| has(d))
            .map(|d| d.to_string());
    } else {
        info.kind = "worker".into();
    }

    detect_node_package_manager(dir, info);
    info.start_command = node_start_command(dir, info, &pkg);

    let installed = dir.join("node_modules").is_dir();
    info.deps_installed = Some(installed);
    if !installed {
        info.warnings
            .push("Dependencies are not installed (node_modules missing).".into());
    }
    if info.kind == "bot" {
        bot_env_warnings(dir, info);
    }
    true
}

fn detect_node_package_manager(dir: &Path, info: &mut ProjectInfo) {
    // Priority per requirements: pnpm > bun > yarn > npm.
    let map = [
        ("pnpm-lock.yaml", "pnpm"),
        ("bun.lock", "bun"),
        ("bun.lockb", "bun"),
        ("yarn.lock", "yarn"),
        ("package-lock.json", "npm"),
    ];
    let mut managers: Vec<&str> = Vec::new();
    for (file, pm) in map {
        if dir.join(file).is_file() {
            info.lockfiles.push(file.to_string());
            if !managers.contains(&pm) {
                managers.push(pm);
            }
        }
    }
    info.package_manager = Some(managers.first().copied().unwrap_or("npm").to_string());
    if managers.len() > 1 {
        info.warnings.push(format!(
            "Multiple lockfiles detected ({}). Recommended package manager: {}",
            info.lockfiles.join(", "),
            managers[0]
        ));
    }
}

fn node_start_command(
    dir: &Path,
    info: &ProjectInfo,
    pkg: &serde_json::Value,
) -> Option<String> {
    let pm = info.package_manager.as_deref().unwrap_or("npm");
    let run = |script: &str| match pm {
        "npm" => format!("npm run {}", script),
        "bun" => format!("bun run {}", script),
        _ => format!("{} {}", pm, script),
    };
    // Bots prefer `start` (production run); apps prefer `dev` (local dev server).
    let order: [&str; 2] = if info.kind == "bot" {
        ["start", "dev"]
    } else {
        ["dev", "start"]
    };
    for s in order {
        if info.scripts.contains_key(s) {
            return Some(run(s));
        }
    }
    for f in ["index.js", "bot.js", "src/index.js"] {
        if dir.join(f).is_file() {
            return Some(format!("node {}", f));
        }
    }
    if let Some(main) = pkg.get("main").and_then(|m| m.as_str()) {
        if dir.join(main).is_file() {
            return Some(format!("node {}", main));
        }
    }
    None
}

fn detect_python(dir: &Path, info: &mut ProjectInfo) -> bool {
    let req = std::fs::read_to_string(dir.join("requirements.txt")).unwrap_or_default();
    let pyproject = std::fs::read_to_string(dir.join("pyproject.toml")).unwrap_or_default();
    let py_entry = ["bot.py", "main.py", "app.py", "server.py", "manage.py"]
        .iter()
        .find(|f| dir.join(f).is_file())
        .map(|f| f.to_string());
    if req.is_empty() && pyproject.is_empty() && py_entry.is_none() {
        return false;
    }
    info.runtime = Some("python".into());
    let deps = format!("{}\n{}", req, pyproject).to_lowercase();

    if PY_DISCORD_MARKERS.iter().any(|m| deps.contains(m)) {
        info.kind = "bot".into();
        info.subtype = Some("discord".into());
        info.framework = Some("discord.py".into());
    } else if dir.join("manage.py").is_file() || deps.contains("django") {
        info.kind = "backend-server".into();
        info.framework = Some("Django".into());
        info.default_port = Some(8000);
    } else if deps.contains("fastapi") || deps.contains("starlette") {
        info.kind = "backend-server".into();
        info.framework = Some("FastAPI".into());
        info.default_port = Some(8000);
    } else if deps.contains("flask") {
        info.kind = "backend-server".into();
        info.framework = Some("Flask".into());
        info.default_port = Some(5000);
    } else {
        info.kind = "worker".into();
    }

    info.package_manager = Some(if dir.join("uv.lock").is_file() { "uv" } else { "pip" }.to_string());

    info.start_command = if dir.join("manage.py").is_file() {
        Some("python manage.py runserver".into())
    } else {
        // Bots prefer bot.py; everything else takes the first conventional entry point.
        let order: &[&str] = if info.kind == "bot" {
            &["bot.py", "main.py", "app.py"]
        } else {
            &["main.py", "app.py", "server.py", "bot.py"]
        };
        order
            .iter()
            .find(|f| dir.join(f).is_file())
            .map(|f| format!("python {}", f))
    };

    if !dir.join(".venv").is_dir() && !dir.join("venv").is_dir() {
        info.warnings
            .push("Python virtual environment not found (.venv).".into());
    }
    if info.kind == "bot" {
        bot_env_warnings(dir, info);
    }
    true
}

fn bot_env_warnings(dir: &Path, info: &mut ProjectInfo) {
    let has_env = dir.join(".env").is_file();
    let has_example = dir.join(".env.example").is_file();
    if !has_env {
        if has_example {
            info.warnings
                .push(".env is missing, but .env.example was found.".into());
        } else {
            info.warnings
                .push("No .env found. A bot token is usually required.".into());
        }
        return;
    }
    let keys = env_keys(&dir.join(".env"));
    if !keys.iter().any(|k| k.contains("TOKEN")) {
        info.warnings
            .push("No *TOKEN key found in .env (DISCORD_TOKEN is usually required).".into());
    }
}

pub fn env_keys(path: &Path) -> Vec<String> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.is_empty() || l.starts_with('#') {
                return None;
            }
            l.split_once('=').map(|(k, _)| k.trim().to_string())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str, files: &[(&str, &str)]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("folddeck-test-{}", name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for (f, content) in files {
            let p = dir.join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, content).unwrap();
        }
        dir
    }

    #[test]
    fn favicon_from_html_link_and_conventions() {
        assert_eq!(
            parse_icon_href(r#"<link rel="icon" type="image/svg+xml" href="/vite.svg" />"#).as_deref(),
            Some("/vite.svg")
        );
        assert_eq!(
            parse_icon_href(r#"<link href="favicon.png" rel="shortcut icon">"#).as_deref(),
            Some("favicon.png")
        );
        assert_eq!(parse_icon_href(r#"<link rel="stylesheet" href="a.css">"#), None);

        // Vite-style: index.html references public/vite.svg.
        let dir = tmp(
            "favicon-vite",
            &[
                ("index.html", r#"<link rel="icon" href="/vite.svg">"#),
                ("public/vite.svg", "<svg></svg>"),
            ],
        );
        assert!(find_favicon(&dir).unwrap().starts_with("data:image/svg+xml;base64,"));

        // Next.js app-router convention with no HTML link.
        let dir = tmp("favicon-next", &[("app/icon.png", "PNGDATA")]);
        assert!(find_favicon(&dir).unwrap().starts_with("data:image/png;base64,"));
    }

    #[test]
    fn detects_next_app_with_pnpm() {
        let dir = tmp(
            "next",
            &[
                (
                    "package.json",
                    r#"{"dependencies":{"next":"15.0.0"},"scripts":{"dev":"next dev","start":"next start"}}"#,
                ),
                ("pnpm-lock.yaml", ""),
            ],
        );
        let info = detect(dir.to_str().unwrap());
        assert_eq!(info.kind, "web-app");
        assert_eq!(info.framework.as_deref(), Some("Next.js"));
        assert_eq!(info.package_manager.as_deref(), Some("pnpm"));
        assert_eq!(info.start_command.as_deref(), Some("pnpm dev"));
        assert_eq!(info.default_port, Some(3000));
    }

    #[test]
    fn detects_node_discord_bot() {
        let dir = tmp(
            "bot",
            &[
                (
                    "package.json",
                    r#"{"dependencies":{"discord.js":"14.0.0"},"scripts":{"start":"node index.js"}}"#,
                ),
                ("index.js", ""),
            ],
        );
        let info = detect(dir.to_str().unwrap());
        assert_eq!(info.kind, "bot");
        assert_eq!(info.subtype.as_deref(), Some("discord"));
        assert_eq!(info.start_command.as_deref(), Some("npm run start"));
        assert!(info.warnings.iter().any(|w| w.contains(".env")));
    }

    #[test]
    fn detects_python_discord_bot() {
        let dir = tmp(
            "pybot",
            &[("requirements.txt", "discord.py\n"), ("bot.py", "")],
        );
        let info = detect(dir.to_str().unwrap());
        assert_eq!(info.kind, "bot");
        assert_eq!(info.runtime.as_deref(), Some("python"));
        assert_eq!(info.start_command.as_deref(), Some("python bot.py"));
    }

    #[test]
    fn detects_compose_and_multiple_lockfiles_warning() {
        let dir = tmp("compose", &[("docker-compose.yml", "services: {}")]);
        assert_eq!(detect(dir.to_str().unwrap()).kind, "docker-compose");

        let dir = tmp(
            "multilock",
            &[
                ("package.json", r#"{"scripts":{"dev":"vite"}}"#),
                ("pnpm-lock.yaml", ""),
                ("package-lock.json", ""),
            ],
        );
        let info = detect(dir.to_str().unwrap());
        assert!(info.warnings.iter().any(|w| w.contains("Multiple lockfiles")));
        assert_eq!(info.package_manager.as_deref(), Some("pnpm"));
    }
}
