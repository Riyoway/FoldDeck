import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FolderOpen, RotateCcw } from "lucide-react";
import { applyUiZoom, getSetting, setSetting } from "./settings";

type Section = "appearance" | "safety" | "logs" | "recipes" | "storage" | "about";

const SECTIONS: [Section, string][] = [
  ["appearance", "Appearance"],
  ["safety", "Safety"],
  ["logs", "Logs"],
  ["recipes", "Recipes"],
  ["storage", "Storage"],
  ["about", "About"],
];

const ZOOM_LEVELS: [number, string][] = [
  [0.9, "90%"],
  [1, "100%"],
  [1.1, "110%"],
  [1.25, "125%"],
];

function Toggle({
  label,
  description,
  settingKey,
}: {
  label: string;
  description: string;
  settingKey: "commandAuditConfirm" | "logAutoScroll";
}) {
  const [on, setOn] = useState(getSetting(settingKey));
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-label">{label}</div>
        <div className="settings-desc">{description}</div>
      </div>
      <button
        className={`switch ${on ? "switch-on" : ""}`}
        role="switch"
        aria-checked={on}
        onClick={() => {
          setSetting(settingKey, !on);
          setOn(!on);
        }}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const [section, setSection] = useState<Section>("appearance");
  const [paths, setPaths] = useState<{ appData: string; recipes: string } | null>(null);
  const [version, setVersion] = useState("");
  const [recipeMsg, setRecipeMsg] = useState<string | null>(null);
  const [zoom, setZoom] = useState(getSetting("uiZoom"));

  useEffect(() => {
    invoke<{ appData: string; recipes: string }>("get_app_paths").then(setPaths);
    getVersion().then(setVersion);
  }, []);

  const changeZoom = (z: number) => {
    setSetting("uiZoom", z);
    setZoom(z);
    applyUiZoom();
  };

  const reloadRecipes = async () => {
    const count = await invoke<number>("reload_recipes");
    setRecipeMsg(`${count} recipe${count === 1 ? "" : "s"} loaded.`);
  };

  return (
    <div className="settings">
      <nav className="settings-nav">
        {SECTIONS.map(([key, label]) => (
          <button
            key={key}
            className={`settings-nav-item ${section === key ? "settings-nav-active" : ""}`}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="settings-content">
        {section === "appearance" && (
          <>
            <h2>Appearance</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-label">Text size</div>
                <div className="settings-desc">Scales the entire interface.</div>
              </div>
              <div className="segmented">
                {ZOOM_LEVELS.map(([z, label]) => (
                  <button
                    key={z}
                    className={`segmented-item ${zoom === z ? "segmented-active" : ""}`}
                    onClick={() => changeZoom(z)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {section === "safety" && (
          <>
            <h2>Safety</h2>
            <Toggle
              settingKey="commandAuditConfirm"
              label="Confirm flagged commands"
              description="Ask before running commands that look dangerous (remote script piping, recursive deletes, tokens in arguments)."
            />
          </>
        )}

        {section === "logs" && (
          <>
            <h2>Logs</h2>
            <Toggle
              settingKey="logAutoScroll"
              label="Auto-scroll logs"
              description="Keep the log view pinned to the newest line while a project is running."
            />
          </>
        )}

        {section === "recipes" && (
          <>
            <h2>Recipes</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-label">Custom detection recipes</div>
                <div className="settings-desc">
                  Drop <code>*.yaml</code> files into the recipes folder to teach FoldDeck new
                  project types. See the README for the format.
                </div>
                {paths && <div className="settings-path">{paths.recipes}</div>}
                {recipeMsg && <div className="settings-desc ok-text">{recipeMsg}</div>}
              </div>
              <div className="settings-btns">
                <button
                  className="btn"
                  onClick={() => paths && invoke("open_folder", { path: paths.recipes })}
                >
                  <FolderOpen size={13} /> Open folder
                </button>
                <button className="btn" onClick={reloadRecipes}>
                  <RotateCcw size={13} /> Reload
                </button>
              </div>
            </div>
          </>
        )}

        {section === "storage" && (
          <>
            <h2>Storage</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-label">App data</div>
                <div className="settings-desc">Project list and app state live here.</div>
                {paths && <div className="settings-path">{paths.appData}</div>}
              </div>
              <div className="settings-btns">
                <button
                  className="btn"
                  onClick={() => paths && invoke("open_folder", { path: paths.appData })}
                >
                  <FolderOpen size={13} /> Open folder
                </button>
              </div>
            </div>
          </>
        )}

        {section === "about" && (
          <>
            <h2>About</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-label">FoldDeck {version && `v${version}`}</div>
                <div className="settings-desc">
                  Local-first dashboard for running and auditing your projects.
                </div>
              </div>
              <div className="settings-btns">
                <button className="btn" onClick={() => openUrl("https://github.com/Riyoway/FoldDeck")}>
                  GitHub
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
