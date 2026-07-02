use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const ENV_FILES: &[&str] = &[
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".env.example",
    ".env.template",
    ".env.sample",
];

pub const SECRET_KEY_MARKERS: &[&str] = &[
    "TOKEN", "SECRET", "PASSWORD", "PASS", "API_KEY", "PRIVATE_KEY", "ACCESS_KEY", "AUTH",
    "SESSION", "COOKIE", "WEBHOOK", "DATABASE_URL",
];

pub fn is_secret_key(key: &str) -> bool {
    let upper = key.to_uppercase();
    SECRET_KEY_MARKERS.iter().any(|m| upper.contains(m))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvEntry {
    pub key: String,
    pub value: String,
    pub is_secret: bool,
}

/// Whitelist check: env editing is restricted to known env file names.
pub fn env_path(project_dir: &str, file_name: &str) -> Result<PathBuf, String> {
    if !ENV_FILES.contains(&file_name) {
        return Err(format!("Not an env file: {}", file_name));
    }
    Ok(Path::new(project_dir).join(file_name))
}

pub fn read_entries(path: &Path) -> Result<Vec<EnvEntry>, String> {
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return None;
            }
            let (key, value) = trimmed.split_once('=')?;
            let key = key.trim().to_string();
            Some(EnvEntry {
                is_secret: is_secret_key(&key),
                key,
                value: value.trim().to_string(),
            })
        })
        .collect())
}

/// Rewrites KEY=VALUE lines in place, keeps comments and blank lines,
/// drops keys absent from `entries`, appends new keys at the end.
pub fn save_entries(path: &Path, entries: &[EnvEntry]) -> Result<(), String> {
    let existing = std::fs::read_to_string(path).unwrap_or_default();
    let mut used = vec![false; entries.len()];
    let mut out: Vec<String> = Vec::new();

    for line in existing.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            out.push(line.to_string());
            continue;
        }
        let Some((key, _)) = trimmed.split_once('=') else {
            out.push(line.to_string());
            continue;
        };
        let key = key.trim();
        match entries.iter().position(|e| e.key == key) {
            Some(i) if !used[i] => {
                used[i] = true;
                out.push(format!("{}={}", entries[i].key, entries[i].value));
            }
            // Deleted in the editor, or a duplicate line of an already-written key.
            _ => {}
        }
    }
    for (i, e) in entries.iter().enumerate() {
        if !used[i] && !e.key.trim().is_empty() {
            out.push(format!("{}={}", e.key, e.value));
        }
    }
    let mut content = out.join("\n");
    content.push('\n');
    std::fs::write(path, content).map_err(|e| e.to_string())
}

pub fn create_from_example(project_dir: &str) -> Result<(), String> {
    let dir = Path::new(project_dir);
    let env = dir.join(".env");
    if env.exists() {
        return Err(".env already exists.".into());
    }
    let example = [".env.example", ".env.template", ".env.sample"]
        .iter()
        .map(|f| dir.join(f))
        .find(|p| p.is_file())
        .ok_or("No .env.example found.")?;
    std::fs::copy(&example, &env).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_preserves_comments_and_appends_new_keys() {
        let dir = std::env::temp_dir().join("folddeck-test-env");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(".env");
        std::fs::write(&path, "# comment\nDISCORD_TOKEN=old\n\nPORT=3000\nDROPPED=x\n").unwrap();

        let entries = vec![
            EnvEntry { key: "DISCORD_TOKEN".into(), value: "new".into(), is_secret: true },
            EnvEntry { key: "PORT".into(), value: "3000".into(), is_secret: false },
            EnvEntry { key: "ADDED".into(), value: "1".into(), is_secret: false },
        ];
        save_entries(&path, &entries).unwrap();

        let content = std::fs::read_to_string(&path).unwrap();
        assert_eq!(content, "# comment\nDISCORD_TOKEN=new\n\nPORT=3000\nADDED=1\n");

        let read = read_entries(&path).unwrap();
        assert_eq!(read.len(), 3);
        assert!(read[0].is_secret);
        assert!(!read[1].is_secret);
    }
}
