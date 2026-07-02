import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, FolderOpen, RotateCcw } from "lucide-react";
import { getSetting, setSetting } from "./settings";

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

export default function SettingsPage({ onClose }: { onClose: () => void }) {
  const [paths, setPaths] = useState<{ appData: string; recipes: string } | null>(null);
  const [version, setVersion] = useState("");
  const [recipeMsg, setRecipeMsg] = useState<string | null>(null);

  useEffect(() => {
    invoke<{ appData: string; recipes: string }>("get_app_paths").then(setPaths);
    getVersion().then(setVersion);
  }, []);

  const reloadRecipes = async () => {
    const count = await invoke<number>("reload_recipes");
    setRecipeMsg(`${count} recipe${count === 1 ? "" : "s"} loaded.`);
  };

  return (
    <div className="settings">
      <div className="settings-inner">
        <div className="settings-head">
          <button className="btn" onClick={onClose}>
            <ArrowLeft size={13} /> Back
          </button>
          <h1>Settings</h1>
        </div>

        <h2>Safety</h2>
        <Toggle
          settingKey="commandAuditConfirm"
          label="Confirm flagged commands"
          description="Ask before running commands that look dangerous (remote script piping, recursive deletes, tokens in arguments)."
        />

        <h2>Logs</h2>
        <Toggle
          settingKey="logAutoScroll"
          label="Auto-scroll logs"
          description="Keep the log view pinned to the newest line while a project is running."
        />

        <h2>Recipes</h2>
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-label">Custom detection recipes</div>
            <div className="settings-desc">
              Drop <code>*.yaml</code> files into the recipes folder to teach FoldDeck new project
              types. See the README for the format.
            </div>
            {paths && <div className="settings-path">{paths.recipes}</div>}
            {recipeMsg && <div className="settings-desc ok-text">{recipeMsg}</div>}
          </div>
          <div className="settings-btns">
            <button className="btn" onClick={() => paths && invoke("open_folder", { path: paths.recipes })}>
              <FolderOpen size={13} /> Open folder
            </button>
            <button className="btn" onClick={reloadRecipes}>
              <RotateCcw size={13} /> Reload
            </button>
          </div>
        </div>

        <h2>Storage</h2>
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-label">App data</div>
            <div className="settings-desc">Project list and app state live here.</div>
            {paths && <div className="settings-path">{paths.appData}</div>}
          </div>
          <div className="settings-btns">
            <button className="btn" onClick={() => paths && invoke("open_folder", { path: paths.appData })}>
              <FolderOpen size={13} /> Open folder
            </button>
          </div>
        </div>

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
      </div>
    </div>
  );
}
