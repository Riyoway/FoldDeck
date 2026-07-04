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
    /// web-app | static-site | backend-server | desktop-app | bot | worker | game-server | docker-compose | unknown
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

    // Order matters: desktop (Tauri/Electron) must precede detect_node so a
    // package.json app isn't mislaunched as a plain frontend; php/ruby precede
    // node because Laravel/Rails ship an asset package.json.
    let detectors: [fn(&Path, &mut ProjectInfo) -> bool; 12] = [
        detect_compose,
        detect_minecraft,
        detect_desktop,
        detect_php,
        detect_ruby,
        detect_node,
        detect_deno,
        detect_jvm,
        detect_dotnet,
        detect_go,
        detect_rust,
        detect_python,
    ];
    for d in detectors {
        if d(dir, &mut info) {
            return info;
        }
    }
    if dir.join("index.html").is_file() {
        info.kind = "static-site".into();
        info.framework = Some("Static HTML".into());
    }
    info
}

/// Maps (package manager, script) to the run command. pnpm/yarn take the script
/// directly; npm/bun need the `run` verb.
fn pm_run(pm: &str, script: &str) -> String {
    match pm {
        "npm" | "bun" => format!("{} run {}", pm, script),
        _ => format!("{} {}", pm, script),
    }
}

/// Reads package.json once: returns (parsed value, dependency names).
fn read_package_json(dir: &Path) -> Option<(serde_json::Value, Vec<String>)> {
    let raw = std::fs::read_to_string(dir.join("package.json")).ok()?;
    let pkg: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let mut deps = Vec::new();
    for key in ["dependencies", "devDependencies"] {
        if let Some(map) = pkg.get(key).and_then(|d| d.as_object()) {
            deps.extend(map.keys().cloned());
        }
    }
    Some((pkg, deps))
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

fn load_node_scripts(pkg: &serde_json::Value, info: &mut ProjectInfo) {
    if let Some(scripts) = pkg.get("scripts").and_then(|s| s.as_object()) {
        for (k, v) in scripts {
            if let Some(cmd) = v.as_str() {
                info.scripts.insert(k.clone(), cmd.to_string());
            }
        }
    }
}

fn node_modules_warning(dir: &Path, info: &mut ProjectInfo) {
    let installed = dir.join("node_modules").is_dir();
    info.deps_installed = Some(installed);
    if !installed {
        info.warnings
            .push("Dependencies are not installed (node_modules missing).".into());
    }
}

/// A package.json script body that launches the Electron window (not a renderer
/// bundler or a packager).
fn is_electron_launcher(body: &str) -> bool {
    let b = body.to_lowercase();
    if b.contains("electron-builder") || b.contains("electron-packager") || b.contains("electron-rebuild") {
        return false;
    }
    b.contains("electron-vite dev")
        || b.contains("electron-forge start")
        || b.contains("electron .")
        || b.starts_with("electron ")
        || b.contains("&& electron ")
        || b.contains("npx electron")
}

/// Tauri (src-tauri) and Electron desktop apps. Runs before detect_node so the
/// app is launched properly, not as a bare frontend dev server.
fn detect_desktop(dir: &Path, info: &mut ProjectInfo) -> bool {
    let pkg = read_package_json(dir);
    let has = |d: &str| {
        pkg.as_ref()
            .map(|(_, deps)| deps.iter().any(|x| x == d))
            .unwrap_or(false)
    };
    let tauri_conf = dir.join("src-tauri").join("tauri.conf.json").is_file();
    let is_tauri = tauri_conf || has("@tauri-apps/cli") || has("@tauri-apps/api");
    let is_electron = has("electron");
    if !is_tauri && !is_electron {
        return false;
    }
    info.kind = "desktop-app".into();

    if is_tauri {
        info.subtype = Some("rust-webview".into());
        info.runtime = Some("rust".into());
        info.framework = Some("Tauri".into());
        info.default_port = Some(1420);
        if let Some((pkg, _)) = &pkg {
            load_node_scripts(pkg, info);
        }
        if has("@tauri-apps/cli") {
            detect_node_package_manager(dir, info);
            let pm = info.package_manager.as_deref().unwrap_or("npm");
            // `<pm> tauri dev`, the tauri CLI runs beforeDevCommand + the window.
            info.start_command = Some(format!("{} dev", pm_run(pm, "tauri")));
            node_modules_warning(dir, info);
        } else {
            // Pure-Rust Tauri (no JS CLI dep) uses the cargo subcommand.
            info.start_command = Some("cargo tauri dev".into());
        }
        return true;
    }

    // Electron.
    info.subtype = Some("electron".into());
    info.runtime = Some("node".into());
    let forge = has("@electron-forge/cli")
        || dir.join("forge.config.js").is_file()
        || dir.join("forge.config.ts").is_file()
        || pkg
            .as_ref()
            .and_then(|(p, _)| p.get("config").and_then(|c| c.get("forge")))
            .is_some();
    info.framework = Some(
        if has("electron-vite") {
            info.default_port = Some(5173);
            "electron-vite"
        } else if forge {
            "Electron Forge"
        } else {
            "Electron"
        }
        .into(),
    );
    if let Some((pkg, _)) = &pkg {
        load_node_scripts(pkg, info);
    }
    detect_node_package_manager(dir, info);
    node_modules_warning(dir, info);
    let pm = info.package_manager.as_deref().unwrap_or("npm").to_string();
    // Pick the script whose body actually launches Electron (never a bundler).
    info.start_command = ["dev", "start"]
        .iter()
        .find(|k| info.scripts.get(**k).map(|b| is_electron_launcher(b)).unwrap_or(false))
        .map(|k| pm_run(&pm, k))
        .or_else(|| {
            info.scripts
                .iter()
                .find(|(_, b)| is_electron_launcher(b))
                .map(|(k, _)| pm_run(&pm, k))
        })
        .or_else(|| Some("npx electron .".into()));
    true
}

fn detect_php(dir: &Path, info: &mut ProjectInfo) -> bool {
    let composer = std::fs::read_to_string(dir.join("composer.json")).unwrap_or_default();
    let has_artisan = dir.join("artisan").is_file();
    let public_index = dir.join("public").join("index.php").is_file();
    let root_index = dir.join("index.php").is_file();
    if composer.is_empty() && !has_artisan && !root_index && !public_index {
        return false;
    }
    info.runtime = Some("php".into());
    let comp = composer.to_lowercase();
    let php_serve = if public_index {
        "php -S localhost:8000 -t public"
    } else {
        "php -S localhost:8000"
    };
    if has_artisan || comp.contains("laravel/framework") {
        info.kind = "web-app".into();
        info.framework = Some("Laravel".into());
        info.subtype = Some("mvc".into());
        info.default_port = Some(8000);
        info.start_command = Some("php artisan serve".into());
        if !dir.join("vendor").is_dir() {
            info.warnings.push("PHP dependencies not installed (run composer install).".into());
        }
        if !dir.join(".env").is_file() {
            info.warnings
                .push(".env is missing (copy .env.example, then php artisan key:generate).".into());
        }
    } else if comp.contains("symfony/framework-bundle") || dir.join("bin").join("console").is_file() {
        info.kind = "web-app".into();
        info.framework = Some("Symfony".into());
        info.default_port = Some(8000);
        info.start_command = Some(php_serve.into());
    } else if root_index || public_index {
        info.kind = "web-app".into();
        info.framework = Some("PHP".into());
        info.default_port = Some(8000);
        info.start_command = Some(php_serve.into());
    } else {
        info.kind = "worker".into();
        info.framework = Some("PHP".into());
    }
    true
}

fn detect_ruby(dir: &Path, info: &mut ProjectInfo) -> bool {
    let gemfile = std::fs::read_to_string(dir.join("Gemfile")).unwrap_or_default();
    let has_configru = dir.join("config.ru").is_file();
    if gemfile.is_empty() && !has_configru {
        return false;
    }
    info.runtime = Some("ruby".into());
    let g = gemfile.to_lowercase();
    if g.contains("rails")
        || dir.join("bin").join("rails").is_file()
        || dir.join("config").join("application.rb").is_file()
    {
        info.kind = "web-app".into();
        info.framework = Some("Ruby on Rails".into());
        info.subtype = Some("mvc".into());
        info.default_port = Some(3000);
        info.start_command = Some(if dir.join("bin").join("rails").is_file() {
            "bin/rails server".into()
        } else {
            "rails server".into()
        });
        if !dir.join("Gemfile.lock").is_file() {
            info.warnings.push("Ruby gems not installed (run bundle install).".into());
        }
    } else if g.contains("sinatra") {
        info.kind = "backend-server".into();
        info.framework = Some("Sinatra".into());
        info.default_port = Some(4567);
        info.start_command = ["app.rb", "server.rb", "main.rb"]
            .iter()
            .find(|f| dir.join(f).is_file())
            .map(|f| format!("ruby {}", f))
            .or(Some("bundle exec rackup".into()));
    } else if has_configru {
        info.kind = "backend-server".into();
        info.framework = Some("Rack".into());
        info.default_port = Some(9292);
        info.start_command = Some("bundle exec rackup".into());
    } else {
        info.kind = "worker".into();
        info.framework = Some("Ruby".into());
    }
    true
}

fn detect_jvm(dir: &Path, info: &mut ProjectInfo) -> bool {
    let pom = std::fs::read_to_string(dir.join("pom.xml")).unwrap_or_default();
    let gradle = std::fs::read_to_string(dir.join("build.gradle")).unwrap_or_default();
    let gradle_kts = std::fs::read_to_string(dir.join("build.gradle.kts")).unwrap_or_default();
    let is_maven = !pom.is_empty();
    let is_gradle = !gradle.is_empty() || !gradle_kts.is_empty();
    if !is_maven && !is_gradle {
        return false;
    }
    let text = format!("{}\n{}\n{}", pom, gradle, gradle_kts).to_lowercase();
    info.runtime = Some("java".into());
    // Prefer the project's wrapper; on Windows that's the .cmd/.bat script.
    let mvn = if dir.join("mvnw.cmd").is_file() { "./mvnw.cmd" } else { "mvn" };
    let gw = if dir.join("gradlew.bat").is_file() { "./gradlew.bat" } else { "gradle" };

    if text.contains("spring-boot") {
        info.kind = "web-app".into();
        info.framework = Some("Spring Boot".into());
        info.subtype = Some("spring-boot".into());
        info.default_port = Some(8080);
        info.start_command = Some(if is_maven {
            format!("{} spring-boot:run", mvn)
        } else {
            format!("{} bootRun", gw)
        });
    } else if text.contains("quarkus") {
        info.kind = "backend-server".into();
        info.framework = Some("Quarkus".into());
        info.default_port = Some(8080);
        info.start_command = Some(if is_maven {
            format!("{} quarkus:dev", mvn)
        } else {
            format!("{} quarkusDev", gw)
        });
    } else if text.contains("io.ktor") || text.contains("ktor-server") {
        info.kind = "backend-server".into();
        info.framework = Some("Ktor".into());
        info.runtime = Some("kotlin".into());
        info.default_port = Some(8080);
        info.start_command = Some(format!("{} run", gw));
    } else if text.contains("micronaut") {
        info.kind = "backend-server".into();
        info.framework = Some("Micronaut".into());
        info.default_port = Some(8080);
        info.start_command = Some(if is_maven {
            format!("{} mn:run", mvn)
        } else {
            format!("{} run", gw)
        });
    } else {
        // Generic JVM project, no reliable run command to guess.
        info.kind = "worker".into();
        info.framework = Some(if is_maven { "Maven" } else { "Gradle" }.into());
    }
    true
}

fn dotnet_port(dir: &Path) -> Option<u16> {
    let raw = std::fs::read_to_string(dir.join("Properties").join("launchSettings.json")).ok()?;
    let pos = raw.find("http://localhost:")?;
    let rest = &raw[pos + "http://localhost:".len()..];
    rest.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().ok()
}

fn detect_dotnet(dir: &Path, info: &mut ProjectInfo) -> bool {
    let csproj = std::fs::read_dir(dir).into_iter().flatten().flatten().find_map(|e| {
        let n = e.file_name().to_string_lossy().to_lowercase();
        n.ends_with(".csproj").then(|| e.path())
    });
    let Some(csproj_path) = csproj else {
        return false;
    };
    info.runtime = Some("dotnet".into());
    let content = std::fs::read_to_string(&csproj_path).unwrap_or_default().to_lowercase();
    if content.contains("microsoft.net.sdk.web") || content.contains("microsoft.aspnetcore") {
        info.kind = "web-app".into();
        info.framework = Some("ASP.NET Core".into());
        info.subtype = Some("aspnet".into());
        info.default_port = Some(dotnet_port(dir).unwrap_or(5000));
    } else {
        info.kind = "worker".into();
        info.framework = Some(".NET".into());
    }
    info.start_command = Some("dotnet run".into());
    true
}

fn detect_go(dir: &Path, info: &mut ProjectInfo) -> bool {
    let gomod = std::fs::read_to_string(dir.join("go.mod")).unwrap_or_default();
    if gomod.is_empty() {
        return false;
    }
    info.runtime = Some("go".into());
    let g = gomod.to_lowercase();
    // Wails is a Go desktop app, not a plain `go run` server.
    if dir.join("wails.json").is_file() || g.contains("wailsapp/wails") {
        info.kind = "desktop-app".into();
        info.subtype = Some("go-webview".into());
        info.framework = Some("Wails".into());
        info.default_port = Some(34115);
        info.start_command = Some("wails dev".into());
        return true;
    }
    let fw = if g.contains("gin-gonic/gin") {
        Some(("Gin", 8080u16))
    } else if g.contains("labstack/echo") {
        Some(("Echo", 1323))
    } else if g.contains("gofiber/fiber") {
        Some(("Fiber", 3000))
    } else if g.contains("go-chi/chi") {
        Some(("Chi", 8080))
    } else {
        None
    };
    let has_main = dir.join("main.go").is_file()
        || std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().ends_with(".go"));
    match fw {
        Some((name, port)) => {
            info.kind = "backend-server".into();
            info.framework = Some(name.into());
            info.default_port = Some(port);
            info.start_command = Some("go run .".into());
        }
        None if has_main => {
            info.kind = "backend-server".into();
            info.framework = Some("Go".into());
            info.default_port = Some(8080);
            info.start_command = Some("go run .".into());
        }
        None => {
            info.kind = "worker".into();
            info.framework = Some("Go".into());
        }
    }
    true
}

fn detect_rust(dir: &Path, info: &mut ProjectInfo) -> bool {
    let cargo = std::fs::read_to_string(dir.join("Cargo.toml")).unwrap_or_default();
    if cargo.is_empty() {
        return false;
    }
    info.runtime = Some("rust".into());
    let c = cargo.to_lowercase();
    let runnable = dir.join("src").join("main.rs").is_file() || c.contains("[[bin]]");
    let fw = if c.contains("axum") {
        Some(("Axum", 3000u16))
    } else if c.contains("actix-web") {
        Some(("Actix Web", 8080))
    } else if c.contains("rocket") {
        Some(("Rocket", 8000))
    } else if c.contains("warp") {
        Some(("Warp", 3030))
    } else {
        None
    };
    match fw {
        Some((name, port)) => {
            info.kind = "backend-server".into();
            info.framework = Some(name.into());
            info.default_port = Some(port);
            info.start_command = Some("cargo run".into());
        }
        None => {
            info.kind = "worker".into();
            info.framework = Some("Rust".into());
            if runnable {
                info.start_command = Some("cargo run".into());
            }
        }
    }
    true
}

fn detect_deno(dir: &Path, info: &mut ProjectInfo) -> bool {
    let cfg = ["deno.json", "deno.jsonc"].iter().find(|f| dir.join(f).is_file());
    if cfg.is_none() && !dir.join("deno.lock").is_file() {
        return false;
    }
    info.runtime = Some("deno".into());
    let cfg_text = cfg
        .map(|f| std::fs::read_to_string(dir.join(f)).unwrap_or_default())
        .unwrap_or_default()
        .to_lowercase();
    if cfg_text.contains("$fresh") || cfg_text.contains("fresh/") || dir.join("fresh.gen.ts").is_file() {
        info.kind = "web-app".into();
        info.framework = Some("Fresh".into());
        info.default_port = Some(8000);
        info.start_command = Some("deno task start".into());
        return true;
    }
    info.kind = "backend-server".into();
    info.framework = Some("Deno".into());
    info.default_port = Some(8000);
    let has_task = |t: &str| cfg_text.contains(&format!("\"{}\"", t));
    info.start_command = if has_task("dev") {
        Some("deno task dev".into())
    } else if has_task("start") {
        Some("deno task start".into())
    } else {
        ["main.ts", "server.ts", "mod.ts", "index.ts"]
            .iter()
            .find(|f| dir.join(f).is_file())
            .map(|f| format!("deno run -A {}", f))
    };
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
            .push("Minecraft EULA is not accepted, accept it in the Minecraft tab.".into());
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

    // (kind, framework, default_port). Specific SSG/meta-frameworks are checked
    // before the generic `vite` catch since they all depend on Vite.
    let web = |info: &mut ProjectInfo, fw: &str, port: u16| {
        info.kind = "web-app".into();
        info.framework = Some(fw.into());
        info.default_port = Some(port);
    };
    let ssg = |info: &mut ProjectInfo, fw: &str, port: u16| {
        info.kind = "static-site".into();
        info.framework = Some(fw.into());
        info.default_port = Some(port);
    };
    let backend = |info: &mut ProjectInfo, fw: &str, port: u16| {
        info.kind = "backend-server".into();
        info.framework = Some(fw.into());
        info.default_port = Some(port);
    };

    if NODE_DISCORD_DEPS.iter().any(|d| has(d)) {
        info.kind = "bot".into();
        info.subtype = Some("discord".into());
        info.framework = NODE_DISCORD_DEPS.iter().find(|d| has(d)).map(|d| d.to_string());
    } else if has("next") {
        web(info, "Next.js", 3000);
    } else if has("nuxt") {
        web(info, "Nuxt", 3000);
    } else if has("@angular/core") || dir.join("angular.json").is_file() {
        web(info, "Angular", 4200);
    } else if has("@vue/cli-service") {
        web(info, "Vue CLI", 8080);
    } else if has("gatsby") {
        ssg(info, "Gatsby", 8000);
    } else if has("@docusaurus/core") {
        ssg(info, "Docusaurus", 3000);
    } else if has("vitepress") {
        ssg(info, "VitePress", 5173);
    } else if has("@11ty/eleventy") {
        ssg(info, "Eleventy", 8080);
    } else if has("@builder.io/qwik-city") || has("@builder.io/qwik") {
        web(info, "Qwik", 5173);
    } else if has("@solidjs/start") {
        web(info, "SolidStart", 3000);
    } else if has("@react-router/dev") || has("@remix-run/dev") {
        web(info, "Remix", 5173);
    } else if has("astro") {
        web(info, "Astro", 4321);
    } else if has("@sveltejs/kit") {
        web(info, "SvelteKit", 5173);
    } else if has("@nestjs/core") {
        backend(info, "NestJS", 3000);
    } else if has("@adonisjs/core") {
        backend(info, "AdonisJS", 3333);
    } else if has("sails") {
        backend(info, "Sails.js", 1337);
    } else if has("@strapi/strapi") {
        backend(info, "Strapi", 1337);
    } else if has("@medusajs/medusa") || has("@medusajs/framework") {
        backend(info, "Medusa", 9000);
    } else if has("vite") {
        web(info, "Vite", 5173);
    } else if has("react-scripts") {
        web(info, "Create React App", 3000);
    } else if has("elysia") {
        backend(info, "Elysia", 3000);
    } else if has("express") || has("fastify") || has("koa") || has("hono") {
        info.kind = "backend-server".into();
        info.framework = ["express", "fastify", "koa", "hono"]
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
    // Bots prefer `start` (production run); apps prefer a dev server. The broad
    // order covers framework-specific dev scripts (Nest start:dev, Gatsby/Strapi
    // develop, Vue CLI/Angular serve, VitePress docs:dev).
    let order: &[&str] = if info.kind == "bot" {
        &["start", "dev"]
    } else {
        &["dev", "develop", "serve", "start:dev", "docs:dev", "start"]
    };
    for s in order {
        if info.scripts.contains_key(*s) {
            return Some(pm_run(pm, s));
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
    let entry = |cands: &[&str]| cands.iter().find(|f| dir.join(f).is_file()).map(|f| f.to_string());
    // `module:app` guess for ASGI/WSGI servers (from the entry file's stem).
    let module = ["main", "app", "server", "asgi", "wsgi"]
        .iter()
        .find(|f| dir.join(format!("{}.py", f)).is_file())
        .copied()
        .unwrap_or("main");
    let has_ipynb = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .any(|e| e.file_name().to_string_lossy().to_lowercase().ends_with(".ipynb"));

    if PY_DISCORD_MARKERS.iter().any(|m| deps.contains(m)) {
        info.kind = "bot".into();
        info.subtype = Some("discord".into());
        info.framework = Some("discord.py".into());
    } else if dir.join("manage.py").is_file() || deps.contains("django") {
        info.kind = "backend-server".into();
        info.framework = Some("Django".into());
        info.default_port = Some(8000);
        info.start_command = Some("python manage.py runserver".into());
    } else if deps.contains("streamlit") {
        info.kind = "web-app".into();
        info.framework = Some("Streamlit".into());
        info.default_port = Some(8501);
        let e = entry(&["streamlit_app.py", "app.py", "main.py"]).unwrap_or_else(|| "app.py".into());
        info.start_command = Some(format!("streamlit run {}", e));
    } else if deps.contains("gradio") {
        info.kind = "web-app".into();
        info.framework = Some("Gradio".into());
        info.default_port = Some(7860);
        info.start_command = entry(&["app.py", "main.py"]).map(|e| format!("python {}", e));
    } else if deps.contains("jupyter") || deps.contains("notebook") || has_ipynb {
        info.kind = "web-app".into();
        info.framework = Some("Jupyter".into());
        info.default_port = Some(8888);
        info.start_command = Some("jupyter lab".into());
    } else if deps.contains("fastapi") || deps.contains("starlette") || deps.contains("uvicorn") {
        info.kind = "backend-server".into();
        info.framework = Some(if deps.contains("fastapi") { "FastAPI" } else { "Uvicorn" }.into());
        info.default_port = Some(8000);
        info.start_command = Some(format!("uvicorn {}:app --reload", module));
    } else if deps.contains("sanic") {
        info.kind = "backend-server".into();
        info.framework = Some("Sanic".into());
        info.default_port = Some(8000);
        info.start_command = Some(format!("sanic {}:app --dev", module));
    } else if deps.contains("gunicorn") {
        info.kind = "backend-server".into();
        info.framework = Some("Gunicorn".into());
        info.default_port = Some(8000);
        info.start_command = Some(format!("gunicorn {}:app --reload --bind 127.0.0.1:8000", module));
    } else if deps.contains("flask") {
        info.kind = "backend-server".into();
        info.framework = Some("Flask".into());
        info.default_port = Some(5000);
    } else if deps.contains("tornado") {
        info.kind = "backend-server".into();
        info.framework = Some("Tornado".into());
        info.default_port = Some(8888);
    } else if deps.contains("aiohttp") {
        info.kind = "backend-server".into();
        info.framework = Some("aiohttp".into());
        info.default_port = Some(8080);
    } else {
        info.kind = "worker".into();
    }

    info.package_manager = Some(if dir.join("uv.lock").is_file() { "uv" } else { "pip" }.to_string());

    // Frameworks above that didn't set a command (Flask/Tornado/aiohttp/worker/
    // bot) fall back to running a conventional entry file.
    if info.start_command.is_none() {
        let order: &[&str] = if info.kind == "bot" {
            &["bot.py", "main.py", "app.py"]
        } else {
            &["main.py", "app.py", "server.py", "bot.py"]
        };
        info.start_command = order
            .iter()
            .find(|f| dir.join(f).is_file())
            .map(|f| format!("python {}", f));
    }

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
    fn detects_tauri_desktop_app_not_frontend() {
        let dir = tmp(
            "tauri",
            &[
                (
                    "package.json",
                    r#"{"devDependencies":{"@tauri-apps/cli":"^2","vite":"^5"},"scripts":{"dev":"vite","tauri":"tauri"}}"#,
                ),
                ("src-tauri/tauri.conf.json", r#"{"identifier":"com.x.app"}"#),
                ("pnpm-lock.yaml", ""),
            ],
        );
        let info = detect(dir.to_str().unwrap());
        assert_eq!(info.kind, "desktop-app");
        assert_eq!(info.framework.as_deref(), Some("Tauri"));
        // NOT "pnpm dev" (that would only start Vite in a browser).
        assert_eq!(info.start_command.as_deref(), Some("pnpm tauri dev"));
    }

    #[test]
    fn detects_electron_by_script_body() {
        let dir = tmp(
            "electron",
            &[(
                "package.json",
                r#"{"devDependencies":{"electron":"^30"},"scripts":{"dev":"vite","start":"electron ."}}"#,
            )],
        );
        let info = detect(dir.to_str().unwrap());
        assert_eq!(info.kind, "desktop-app");
        assert_eq!(info.subtype.as_deref(), Some("electron"));
        // "dev" is the renderer bundler; the launcher is "start".
        assert_eq!(info.start_command.as_deref(), Some("npm run start"));
    }

    #[test]
    fn detects_go_rust_dotnet_backends() {
        let go = tmp(
            "go",
            &[("go.mod", "module x\nrequire github.com/gin-gonic/gin v1.9.0\n"), ("main.go", "")],
        );
        let gi = detect(go.to_str().unwrap());
        assert_eq!(gi.kind, "backend-server");
        assert_eq!(gi.framework.as_deref(), Some("Gin"));
        assert_eq!(gi.start_command.as_deref(), Some("go run ."));

        let rs = tmp(
            "rust-axum",
            &[("Cargo.toml", "[dependencies]\naxum = \"0.7\"\ntokio = \"1\"\n"), ("src/main.rs", "")],
        );
        let ri = detect(rs.to_str().unwrap());
        assert_eq!(ri.framework.as_deref(), Some("Axum"));
        assert_eq!(ri.start_command.as_deref(), Some("cargo run"));

        let net = tmp(
            "aspnet",
            &[("App.csproj", r#"<Project Sdk="Microsoft.NET.Sdk.Web"></Project>"#)],
        );
        let ni = detect(net.to_str().unwrap());
        assert_eq!(ni.framework.as_deref(), Some("ASP.NET Core"));
        assert_eq!(ni.start_command.as_deref(), Some("dotnet run"));
    }

    #[test]
    fn detects_php_ruby_jvm_web() {
        let laravel = tmp(
            "laravel",
            &[("artisan", ""), ("composer.json", r#"{"require":{"laravel/framework":"^11"}}"#)],
        );
        let li = detect(laravel.to_str().unwrap());
        assert_eq!(li.framework.as_deref(), Some("Laravel"));
        assert_eq!(li.start_command.as_deref(), Some("php artisan serve"));

        let rails = tmp("rails", &[("Gemfile", "gem 'rails'\n"), ("bin/rails", "")]);
        let ri = detect(rails.to_str().unwrap());
        assert_eq!(ri.framework.as_deref(), Some("Ruby on Rails"));
        assert_eq!(ri.start_command.as_deref(), Some("bin/rails server"));

        let spring = tmp("spring", &[("pom.xml", "<project>spring-boot-starter-web</project>")]);
        let si = detect(spring.to_str().unwrap());
        assert_eq!(si.framework.as_deref(), Some("Spring Boot"));
        assert_eq!(si.start_command.as_deref(), Some("mvn spring-boot:run"));
    }

    #[test]
    fn detects_streamlit_and_deno() {
        let st = tmp("streamlit", &[("requirements.txt", "streamlit\n"), ("app.py", "")]);
        let si = detect(st.to_str().unwrap());
        assert_eq!(si.kind, "web-app");
        assert_eq!(si.framework.as_deref(), Some("Streamlit"));
        assert_eq!(si.start_command.as_deref(), Some("streamlit run app.py"));

        let dn = tmp("deno", &[("deno.json", r#"{"tasks":{"dev":"deno run -A main.ts"}}"#)]);
        let di = detect(dn.to_str().unwrap());
        assert_eq!(di.runtime.as_deref(), Some("deno"));
        assert_eq!(di.start_command.as_deref(), Some("deno task dev"));
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
