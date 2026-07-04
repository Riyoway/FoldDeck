use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Stdio;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// Static pattern scan of a command line before it runs.
/// ponytail: substring heuristics, not a shell parser, good enough for a
/// "look before you run someone else's start script" warning.
pub fn audit_command(command: &str) -> Vec<String> {
    let c = command.to_lowercase();
    let mut findings = Vec::new();
    let mut hit = |cond: bool, msg: &str| {
        if cond {
            findings.push(msg.to_string());
        }
    };

    hit(c.contains("rm -rf") || c.contains("rm -fr"), "Recursive force delete (rm -rf).");
    hit(c.contains("del /s") || c.contains("del /f"), "Recursive/forced delete (del).");
    hit(c.contains("rmdir /s") && !c.contains("node_modules"), "Recursive directory removal (rmdir /s).");
    hit(c.contains("format "), "Disk format command.");
    hit(c.contains("mkfs"), "Filesystem creation command.");
    hit(c.contains("-encodedcommand") || c.contains(" -enc "), "Encoded PowerShell payload.");
    hit(c.contains("invoke-expression") || c.contains("iex ("), "PowerShell dynamic code execution (iex).");
    hit(
        (c.contains("curl") || c.contains("wget") || c.contains("irm ") || c.contains("invoke-webrequest"))
            && (c.contains("| sh") || c.contains("| bash") || c.contains("| iex") || c.contains("|sh") || c.contains("|bash")),
        "Remote script piped into a shell.",
    );
    hit(c.contains("sudo "), "Privilege escalation (sudo).");
    hit(c.contains("chmod 777"), "World-writable permissions (chmod 777).");
    hit(c.contains(":(){"), "Fork bomb pattern.");
    hit(c.contains("reg add") || c.contains("reg delete"), "Windows registry modification.");

    for prefix in ["ghp_", "gho_", "github_pat_", "xoxb-", "xoxp-", "akia", "sk-ant-", "sk_live_"] {
        if c.contains(prefix) {
            findings.push("Command contains what looks like a credential/token.".into());
            break;
        }
    }
    findings
}

fn on_path(bin: &str) -> bool {
    // Resolve exactly as the runner launches commands (PowerShell + refreshed
    // PATH), so Doctor never reports "not installed" for a tool Start can run.
    let script = format!(
        "if (Get-Command '{}' -ErrorAction SilentlyContinue) {{ exit 0 }} else {{ exit 1 }}",
        bin.replace('\'', "''")
    );
    crate::process::shell_command(None, &script)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn port_busy(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_err()
}

/// Three dot-separated base64url segments with Discord-token-like lengths.
fn is_discord_tokenish(word: &str) -> bool {
    let parts: Vec<&str> = word.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    let seg_ok = |s: &str, min: usize, max: usize| {
        s.len() >= min
            && s.len() <= max
            && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    };
    seg_ok(parts[0], 17, 40) && seg_ok(parts[1], 5, 8) && seg_ok(parts[2], 25, 50)
}

const SOURCE_EXTS: &[&str] = &["js", "ts", "jsx", "tsx", "mjs", "cjs", "py"];
const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", ".venv", "venv", "target", "dist", "build", "__pycache__", ".next",
];
const TOKEN_PREFIXES: &[&str] = &["ghp_", "gho_", "github_pat_", "xoxb-", "xoxp-", "sk-ant-", "sk_live_"];

fn scan_file_for_secrets(path: &Path, rel: &str, findings: &mut Vec<String>) {
    let Ok(content) = std::fs::read_to_string(path) else {
        return;
    };
    for (n, line) in content.lines().enumerate() {
        let hardcoded = line
            .split(|c: char| c == '"' || c == '\'' || c == '`' || c.is_whitespace())
            .any(|w| is_discord_tokenish(w) || TOKEN_PREFIXES.iter().any(|p| w.starts_with(p) && w.len() > 20));
        if hardcoded {
            findings.push(format!("Possible hardcoded token in {}:{}", rel, n + 1));
            if findings.len() >= 10 {
                return;
            }
        }
    }
}

/// Scans project source files (depth ≤ 3) for hardcoded token-looking strings.
pub fn scan_source_secrets(root: &Path) -> Vec<String> {
    let mut findings = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    let mut scanned = 0;
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if depth < 3 && !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push((path, depth + 1));
                }
                continue;
            }
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !SOURCE_EXTS.contains(&ext) {
                continue;
            }
            if entry.metadata().map(|m| m.len() > 512 * 1024).unwrap_or(true) {
                continue;
            }
            scanned += 1;
            if scanned > 500 || findings.len() >= 10 {
                return findings;
            }
            let rel = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| name.clone());
            scan_file_for_secrets(&path, &rel, &mut findings);
        }
    }
    findings
}

/// Known runtime error patterns in recent log output (Discord bots).
fn scan_bot_logs(logs: &[String], errors: &mut Vec<String>, warnings: &mut Vec<String>) {
    let tail: Vec<String> = logs.iter().rev().take(300).map(|l| l.to_lowercase()).collect();
    let any = |pats: &[&str]| tail.iter().any(|l| pats.iter().any(|p| l.contains(p)));

    if any(&["disallowed intents", "privileged intent"]) {
        errors.push(
            "Privileged intents error in logs, enable the required intents in the Discord Developer Portal.".into(),
        );
    }
    if any(&["invalid token", "incorrect login", "401: unauthorized", "tokeninvalid"]) {
        errors.push("Invalid token error in logs, check DISCORD_TOKEN in .env.".into());
    }
    if any(&["missing access", "missing permissions"]) {
        warnings.push("Missing permissions error in logs, check the bot's role/permissions in your server.".into());
    }
    if any(&["rate limit", "ratelimit"]) {
        warnings.push("Rate limit warnings in logs.".into());
    }
}

pub fn doctor(info: &crate::detect::ProjectInfo, running: bool, logs: &[String]) -> DoctorReport {
    let mut errors = Vec::new();
    let mut warnings = info.warnings.clone();

    if let Some(runtime) = info.runtime.as_deref() {
        let bin = match runtime {
            "node" => Some("node"),
            "python" => Some("python"),
            "java" => Some("java"),
            "docker" => Some("docker"),
            _ => None,
        };
        if let Some(bin) = bin {
            if !on_path(bin) {
                errors.push(format!("{} is not installed or not on PATH.", bin));
            }
        }
    }
    if let Some(pm @ ("pnpm" | "yarn" | "bun")) = info.package_manager.as_deref() {
        if !on_path(pm) {
            errors.push(format!("{} is not installed or not on PATH.", pm));
        }
    }
    if info.start_command.is_none() && info.kind != "static-site" {
        errors.push("No start command detected.".into());
    }

    if !running {
        if let Some(port) = info.default_port {
            if port_busy(port) {
                warnings.push(format!("Port {} is already in use.", port));
            }
        }
    }
    if let Some(cmd) = &info.start_command {
        for f in audit_command(cmd) {
            warnings.push(format!("Command audit: {}", f));
        }
    }
    if info.kind == "bot" {
        scan_bot_logs(logs, &mut errors, &mut warnings);
    }
    warnings.extend(scan_source_secrets(Path::new(&info.path)));

    DoctorReport { errors, warnings }
}

// ---- dependency audit ----

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Advisory {
    pub severity: String,
    pub package: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyAuditResult {
    /// false → caller should fall back to running the audit command raw.
    pub supported: bool,
    pub summary: BTreeMap<String, u64>,
    pub advisories: Vec<Advisory>,
}

fn unsupported() -> DependencyAuditResult {
    DependencyAuditResult { supported: false, summary: BTreeMap::new(), advisories: Vec::new() }
}

/// Runs `<pm> audit --json` and parses npm v6 (pnpm) / v7+ (npm) formats.
pub fn dependency_audit(dir: &str, pm: &str) -> Result<DependencyAuditResult, String> {
    if pm != "npm" && pm != "pnpm" {
        return Ok(unsupported());
    }
    let mut cmd = crate::process::shell_command(Some(dir), &format!("{} audit --json", pm));
    cmd.stdin(Stdio::null());
    // Audit commands exit non-zero when vulnerabilities exist; parse stdout regardless.
    let output = cmd.output().map_err(|e| format!("Failed to run {} audit: {}", pm, e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|_| format!("{} audit did not return JSON. Is {} installed?", pm, pm))?;

    let mut summary = BTreeMap::new();
    if let Some(counts) = json
        .pointer("/metadata/vulnerabilities")
        .and_then(|v| v.as_object())
    {
        for (sev, n) in counts {
            if let Some(n) = n.as_u64() {
                summary.insert(sev.clone(), n);
            }
        }
    }

    let mut advisories = Vec::new();
    if let Some(map) = json.get("advisories").and_then(|a| a.as_object()) {
        // npm v6 / pnpm format
        for adv in map.values().take(50) {
            advisories.push(Advisory {
                severity: adv.get("severity").and_then(|s| s.as_str()).unwrap_or("?").into(),
                package: adv.get("module_name").and_then(|s| s.as_str()).unwrap_or("?").into(),
                title: adv.get("title").and_then(|s| s.as_str()).unwrap_or("").into(),
            });
        }
    } else if let Some(map) = json.get("vulnerabilities").and_then(|a| a.as_object()) {
        // npm v7+ format
        for (name, v) in map.iter().take(50) {
            let title = v
                .get("via")
                .and_then(|via| via.as_array())
                .and_then(|arr| {
                    arr.iter().find_map(|x| {
                        x.get("title").and_then(|t| t.as_str()).map(|t| t.to_string())
                    })
                })
                .unwrap_or_default();
            advisories.push(Advisory {
                severity: v.get("severity").and_then(|s| s.as_str()).unwrap_or("?").into(),
                package: name.clone(),
                title,
            });
        }
    }

    Ok(DependencyAuditResult { supported: true, summary, advisories })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_dangerous_commands() {
        assert!(!audit_command("curl https://example.com/install.sh | sh").is_empty());
        assert!(!audit_command("rm -rf /").is_empty());
        assert!(!audit_command("powershell -EncodedCommand SQBFAFgA").is_empty());
        assert!(!audit_command("node index.js --token ghp_abcdef").is_empty());
        assert!(audit_command("pnpm dev").is_empty());
        assert!(audit_command("python bot.py").is_empty());
        // Our own reinstall command must not warn.
        assert!(audit_command("rmdir /s /q node_modules && pnpm install").is_empty());
    }

    #[test]
    fn finds_hardcoded_tokens() {
        // Structurally token-like but obviously fake (keeps GitHub push protection calm).
        assert!(is_discord_tokenish(
            "xxxxxxxxxxxxxxxxxxxxxxxx.xxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxx"
        ));
        assert!(!is_discord_tokenish("index.spec.ts"));
        assert!(!is_discord_tokenish("1.2.3"));

        let dir = std::env::temp_dir().join("folddeck-test-secrets");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("bot.js"),
            "client.login(\"xxxxxxxxxxxxxxxxxxxxxxxx.xxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxx\");\n",
        )
        .unwrap();
        std::fs::write(dir.join("clean.js"), "console.log('hi');\n").unwrap();
        let findings = scan_source_secrets(&dir);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].contains("bot.js:1"));
    }

    #[test]
    fn bot_log_scan_detects_known_errors() {
        let logs = vec![
            "[ERROR] Error: Used disallowed intents".to_string(),
            "something about rate limit".to_string(),
        ];
        let mut errors = Vec::new();
        let mut warnings = Vec::new();
        scan_bot_logs(&logs, &mut errors, &mut warnings);
        assert_eq!(errors.len(), 1);
        assert_eq!(warnings.len(), 1);
    }
}
