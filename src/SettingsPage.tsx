import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Input, Switch, Tab, Tabs } from "@heroui/react";
import { FolderOpen, RotateCcw } from "lucide-react";
import { applyUiZoom, getSetting, setSetting } from "./settings";

type Section =
  | "appearance"
  | "safety"
  | "logs"
  | "terminal"
  | "servers"
  | "recipes"
  | "storage"
  | "about";

const SECTIONS: [Section, string][] = [
  ["appearance", "Appearance"],
  ["safety", "Safety"],
  ["logs", "Logs"],
  ["terminal", "Terminal"],
  ["servers", "Servers"],
  ["recipes", "Recipes"],
  ["storage", "Storage"],
  ["about", "About"],
];

const SHELL_PRESETS: [string, string][] = [
  ["PowerShell", "powershell.exe"],
  ["PowerShell 7", "pwsh.exe"],
  ["Command Prompt", "cmd.exe"],
  ["Git Bash", "bash.exe"],
];

const TERM_FONT_SIZES = [12, 13, 14, 16];

const FILE_SERVER_OPTIONS: ["ask" | "builtin" | "python", string][] = [
  ["ask", "Ask every time"],
  ["builtin", "Built-in"],
  ["python", "Python"],
];

const ZOOM_LEVELS: [number, string][] = [
  [0.9, "90%"],
  [1, "100%"],
  [1.1, "110%"],
  [1.25, "125%"],
];

function SettingToggle({
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
      <Switch
        size="lg"
        isSelected={on}
        onValueChange={(v) => {
          setSetting(settingKey, v);
          setOn(v);
        }}
        classNames={{
          wrapper: "bg-default-300 group-data-[selected=true]:!bg-default-500",
          thumb: "bg-white",
        }}
        aria-label={label}
      />
    </div>
  );
}

export default function SettingsPage() {
  const [section, setSection] = useState<Section>("appearance");
  const [paths, setPaths] = useState<{ appData: string; recipes: string } | null>(null);
  const [version, setVersion] = useState("");
  const [recipeMsg, setRecipeMsg] = useState<string | null>(null);
  const [zoom, setZoom] = useState(getSetting("uiZoom"));
  const [fileServer, setFileServer] = useState(getSetting("fileServerDefault"));
  const [termShell, setTermShell] = useState(getSetting("terminalShell"));
  const [termSize, setTermSize] = useState(getSetting("terminalFontSize"));
  const [termFont, setTermFont] = useState(getSetting("terminalFontFamily"));

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
              <Tabs
                size="md"
                aria-label="Text size"
                selectedKey={String(zoom)}
                onSelectionChange={(k) => changeZoom(Number(k))}
              >
                {ZOOM_LEVELS.map(([z, label]) => (
                  <Tab key={String(z)} title={label} />
                ))}
              </Tabs>
            </div>
          </>
        )}

        {section === "safety" && (
          <>
            <h2>Safety</h2>
            <SettingToggle
              settingKey="commandAuditConfirm"
              label="Confirm flagged commands"
              description="Ask before running commands that look dangerous (remote script piping, recursive deletes, tokens in arguments)."
            />
          </>
        )}

        {section === "logs" && (
          <>
            <h2>Logs</h2>
            <SettingToggle
              settingKey="logAutoScroll"
              label="Auto-scroll logs"
              description="Keep the log view pinned to the newest line while a project is running."
            />
          </>
        )}

        {section === "terminal" && (
          <>
            <h2>Terminal</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-label">Shell</div>
                <div className="settings-desc">
                  Program launched in the Terminal tab (in the project folder). Applies the next
                  time a terminal opens.
                </div>
                <div className="settings-btns" style={{ marginTop: 10, flexWrap: "wrap" }}>
                  {SHELL_PRESETS.map(([label, cmd]) => (
                    <Button
                      key={cmd}
                      size="sm"
                      variant={termShell === cmd ? "solid" : "flat"}
                      onPress={() => {
                        setSetting("terminalShell", cmd);
                        setTermShell(cmd);
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              <Input
                size="md"
                variant="bordered"
                className="settings-input"
                value={termShell}
                onValueChange={(v) => {
                  setTermShell(v);
                  setSetting("terminalShell", v);
                }}
                placeholder="powershell.exe"
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-label">Font size</div>
                <div className="settings-desc">Text size inside the terminal.</div>
              </div>
              <Tabs
                size="md"
                aria-label="Terminal font size"
                selectedKey={String(termSize)}
                onSelectionChange={(k) => {
                  const n = Number(k);
                  setSetting("terminalFontSize", n);
                  setTermSize(n);
                }}
              >
                {TERM_FONT_SIZES.map((n) => (
                  <Tab key={String(n)} title={`${n}px`} />
                ))}
              </Tabs>
            </div>

            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-label">Font family</div>
                <div className="settings-desc">
                  A monospace font stack, e.g. <code>"JetBrains Mono", Consolas, monospace</code>.
                </div>
              </div>
              <Input
                size="md"
                variant="bordered"
                className="settings-input"
                value={termFont}
                onValueChange={(v) => {
                  setTermFont(v);
                  setSetting("terminalFontFamily", v);
                }}
              />
            </div>
          </>
        )}

        {section === "servers" && (
          <>
            <h2>Servers</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-label">Unrecognized folders</div>
                <div className="settings-desc">
                  How to serve folders FoldDeck can't identify (loose images, videos, files).
                  Built-in serves a file browser; Python runs <code>python -m http.server</code>.
                  Projects that already chose a server keep their choice.
                </div>
              </div>
              <Tabs
                size="md"
                aria-label="File server default"
                selectedKey={fileServer}
                onSelectionChange={(k) => {
                  const v = k as "ask" | "builtin" | "python";
                  setSetting("fileServerDefault", v);
                  setFileServer(v);
                }}
              >
                {FILE_SERVER_OPTIONS.map(([value, label]) => (
                  <Tab key={value} title={label} />
                ))}
              </Tabs>
            </div>
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
                <Button
                  size="md"
                  variant="flat"
                  startContent={<FolderOpen size={14} />}
                  onPress={() => paths && invoke("open_folder", { path: paths.recipes })}
                >
                  Open folder
                </Button>
                <Button
                  size="md"
                  variant="flat"
                  startContent={<RotateCcw size={14} />}
                  onPress={reloadRecipes}
                >
                  Reload
                </Button>
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
                <Button
                  size="md"
                  variant="flat"
                  startContent={<FolderOpen size={14} />}
                  onPress={() => paths && invoke("open_folder", { path: paths.appData })}
                >
                  Open folder
                </Button>
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
                <Button size="md" variant="flat" onPress={() => openUrl("https://github.com/Riyoway/FoldDeck")}>
                  GitHub
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
