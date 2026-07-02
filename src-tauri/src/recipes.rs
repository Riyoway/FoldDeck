use crate::detect::ProjectInfo;
use serde::Deserialize;
use std::path::Path;

/// User-defined detection recipe, loaded from <app-data>/recipes/*.yaml.
/// A matching recipe overrides classification; package manager, scripts and
/// env detection from the built-in pass are kept.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub subtype: Option<String>,
    #[serde(default)]
    pub runtime: Option<String>,
    #[serde(default)]
    pub priority: i32,
    pub detect: DetectSpec,
    #[serde(default)]
    pub run: RunSpec,
    #[serde(default)]
    pub default_port: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DetectSpec {
    #[serde(default)]
    pub any: Vec<Rule>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub package_dependency: Option<String>,
    #[serde(default)]
    pub python_dependency: Option<String>,
    #[serde(default)]
    pub env_key: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RunSpec {
    #[serde(default)]
    pub fallback: Vec<String>,
}

pub fn load_recipes(dir: &Path) -> Vec<Recipe> {
    let mut recipes: Vec<Recipe> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().to_lowercase();
            n.ends_with(".yaml") || n.ends_with(".yml")
        })
        .filter_map(|e| {
            let raw = std::fs::read_to_string(e.path()).ok()?;
            match serde_yaml::from_str::<Recipe>(&raw) {
                Ok(r) => Some(r),
                Err(err) => {
                    eprintln!("folddeck: skipping recipe {:?}: {}", e.path(), err);
                    None
                }
            }
        })
        .collect();
    recipes.sort_by_key(|r| -r.priority);
    // Two files with the same id → the higher-priority one wins.
    let mut seen = std::collections::HashSet::new();
    recipes.retain(|r| seen.insert(r.id.clone()));
    recipes
}

fn rule_matches(dir: &Path, rule: &Rule, pkg_deps: &str, py_deps: &str, env_keys: &[String]) -> bool {
    if let Some(f) = &rule.file {
        return dir.join(f).exists();
    }
    if let Some(d) = &rule.package_dependency {
        return pkg_deps.contains(&format!("\"{}\"", d));
    }
    if let Some(d) = &rule.python_dependency {
        return py_deps.contains(&d.to_lowercase());
    }
    if let Some(k) = &rule.env_key {
        return env_keys.iter().any(|e| e == k);
    }
    false
}

pub fn matching_recipe<'a>(dir: &Path, recipes: &'a [Recipe]) -> Option<&'a Recipe> {
    if recipes.is_empty() {
        return None;
    }
    // Read shared inputs once, not per rule.
    let pkg_deps = std::fs::read_to_string(dir.join("package.json")).unwrap_or_default();
    let py_deps = format!(
        "{}\n{}",
        std::fs::read_to_string(dir.join("requirements.txt")).unwrap_or_default(),
        std::fs::read_to_string(dir.join("pyproject.toml")).unwrap_or_default()
    )
    .to_lowercase();
    let env_keys = crate::detect::env_keys(&dir.join(".env"));

    recipes.iter().find(|r| {
        r.detect
            .any
            .iter()
            .any(|rule| rule_matches(dir, rule, &pkg_deps, &py_deps, &env_keys))
    })
}

/// Applies a matched recipe on top of built-in detection results.
pub fn apply_recipe(info: &mut ProjectInfo, recipe: &Recipe) {
    info.kind = recipe.kind.clone();
    info.subtype = recipe.subtype.clone();
    info.framework = Some(recipe.name.clone());
    if recipe.runtime.is_some() {
        info.runtime = recipe.runtime.clone();
    }
    if recipe.default_port.is_some() {
        info.default_port = recipe.default_port;
    }
    if info.start_command.is_none() {
        info.start_command = recipe.run.fallback.first().cloned();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RECIPE_YAML: &str = r#"
id: my-bot
name: My Bot Framework
kind: bot
subtype: discord
runtime: node
priority: 90
detect:
  any:
    - packageDependency: my-bot-lib
    - file: mybot.config.js
run:
  fallback:
    - node mybot.js
defaultPort: 9000
"#;

    #[test]
    fn parses_and_matches_recipe() {
        let recipe: Recipe = serde_yaml::from_str(RECIPE_YAML).unwrap();
        assert_eq!(recipe.kind, "bot");
        assert_eq!(recipe.priority, 90);

        let dir = std::env::temp_dir().join("folddeck-test-recipe");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("package.json"),
            r#"{"dependencies":{"my-bot-lib":"1.0.0"}}"#,
        )
        .unwrap();

        let recipes = vec![recipe];
        let matched = matching_recipe(&dir, &recipes).expect("recipe should match");
        let mut info = crate::detect::detect(dir.to_str().unwrap());
        assert_eq!(info.kind, "worker"); // built-in sees a generic node project
        apply_recipe(&mut info, matched);
        assert_eq!(info.kind, "bot");
        assert_eq!(info.subtype.as_deref(), Some("discord"));
        assert_eq!(info.framework.as_deref(), Some("My Bot Framework"));
        assert_eq!(info.default_port, Some(9000));
        // No scripts in package.json → recipe fallback command wins.
        assert_eq!(info.start_command.as_deref(), Some("node mybot.js"));
    }

    #[test]
    fn no_match_without_markers() {
        let recipe: Recipe = serde_yaml::from_str(RECIPE_YAML).unwrap();
        let dir = std::env::temp_dir().join("folddeck-test-recipe-nomatch");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(matching_recipe(&dir, &[recipe]).is_none());
    }
}
