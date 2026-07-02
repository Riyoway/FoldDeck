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

fn detect_minecraft(dir: &Path, info: &mut ProjectInfo) -> bool {
    let has_marker = dir.join("server.properties").is_file() || dir.join("eula.txt").is_file();
    if !has_marker {
        return false;
    }
    info.kind = "game-server".into();
    info.subtype = Some("minecraft".into());
    info.runtime = Some("java".into());
    info.framework = Some("Minecraft".into());
    info.default_port = Some(25565);

    let jars: Vec<String> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let n = e.file_name().to_string_lossy().to_string();
            n.to_lowercase().ends_with(".jar").then_some(n)
        })
        .collect();
    let preferred = ["server", "paper", "purpur", "spigot", "fabric", "forge"];
    let jar = jars
        .iter()
        .find(|j| preferred.iter().any(|p| j.to_lowercase().contains(p)))
        .or_else(|| jars.first());
    match jar {
        Some(j) => info.start_command = Some(format!("java -Xmx2G -jar \"{}\" nogui", j)),
        None => info.warnings.push("No server .jar found.".into()),
    }

    let eula_ok = std::fs::read_to_string(dir.join("eula.txt"))
        .map(|s| s.to_lowercase().contains("eula=true"))
        .unwrap_or(false);
    if !eula_ok {
        info.warnings
            .push("Minecraft EULA is not accepted (eula.txt).".into());
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

    if !dir.join("node_modules").is_dir() {
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
