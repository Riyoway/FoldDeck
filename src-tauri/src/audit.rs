use serde::Serialize;
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// Static pattern scan of a command line before it runs.
/// ponytail: substring heuristics, not a shell parser — good enough for a
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
    let mut cmd = Command::new("where");
    cmd.arg(bin).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

fn port_busy(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_err()
}

pub fn doctor(info: &crate::detect::ProjectInfo, running: bool) -> DoctorReport {
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

    DoctorReport { errors, warnings }
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
}
