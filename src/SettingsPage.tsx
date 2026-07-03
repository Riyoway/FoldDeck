import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Input, Select, SelectItem, Switch, Tab, Tabs } from "@heroui/react";
import { FolderOpen, RotateCcw } from "lucide-react";
import { applyUiFont, applyUiZoom, getSetting, setSetting } from "./settings";

type Section =
  | "appearance"
  | "safety"
  | "logs"
  | "terminal"
  | "git"
  | "servers"
  | "recipes"
  | "storage"
  | "about";

const SECTIONS: [Section, string][] = [
  ["appearance", "Appearance"],
  ["safety", "Safety"],
  ["logs", "Logs"],
  ["terminal", "Terminal"],
  ["git", "Git"],
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

const UI_FONT_PRESETS: [string, string][] = [
  ["Default", ""],
  ["Segoe UI", '"Segoe UI", system-ui, sans-serif'],
  ["System UI", "system-ui, sans-serif"],
  ["Inter", 'Inter, "Segoe UI", sans-serif'],
  ["Roboto", 'Roboto, "Segoe UI", sans-serif'],
  ["Verdana", "Verdana, sans-serif"],
];

const FONT_PRESETS: [string, string][] = [
  ["Cascadia Code", '"Cascadia Code", "Cascadia Mono", Consolas, monospace'],
  ["Cascadia Mono", '"Cascadia Mono", Consolas, monospace'],
  ["JetBrains Mono", '"JetBrains Mono", Consolas, monospace'],
  ["Fira Code", '"Fira Code", Consolas, monospace'],
  ["Consolas", "Consolas, monospace"],
  ["Courier New", '"Courier New", monospace'],
];

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
  const [uiFont, setUiFont] = useState(getSetting("uiFontFamily"));
  const uiFontCustom = !UI_FONT_PRESETS.some(([, v]) => v === getSetting("uiFontFamily"));
  const [uiFontCustomMode, setUiFontCustomMode] = useState(uiFontCustom);
  const [fileServer, setFileServer] = useState(getSetting("fileServerDefault"));
  const [termShell, setTermShell] = useState(getSetting("terminalShell"));
  const [termSize, setTermSize] = useState(getSetting("terminalFontSize"));
  const [termFont, setTermFont] = useState(getSetting("terminalFontFamily"));
  const [gitDir, setGitDir] = useState(getSetting("gitImportDir"));
  const [defaultGitDir, setDefaultGitDir] = useState("");
  const [sizeCustom, setSizeCustom] = useState(!TERM_FONT_SIZES.includes(getSetting("terminalFontSize")));
  const [fontCustom, setFontCustom] = useState(
    !FONT_PRESETS.some(([, v]) => v === getSetting("terminalFontFamily")),
  );

  const changeTermSize = (n: number) => {
    const clamped = Math.min(32, Math.max(8, Math.round(n) || 13));
    setSetting("terminalFontSize", clamped);
    setTermSize(clamped);
  };
  const changeTermFont = (v: string) => {
    setSetting("terminalFontFamily", v);
    setTermFont(v);
  };

  useEffect(() => {
    invoke<{ appData: string; recipes: string }>("get_app_paths").then(setPaths);
    invoke<string>("get_default_clone_dir").then(setDefaultGitDir).catch(() => {});
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

            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-label">Interface font</div>
                <div className="settings-desc">Font used across the app UI.</div>
              </div>
              <div className="settings-control-col">
                <Select
                  size="md"
                  aria-label="Interface font"
                  className="settings-input"
                  selectedKeys={[uiFontCustomMode ? "__custom__" : uiFont]}
                  onSelectionChange={(keys) => {
                    const key = Array.from(keys)[0] as string | undefined;
                    if (key === undefined) return;
                    if (key === "__custom__") {
                      setUiFontCustomMode(true);
                    } else {
                      setUiFontCustomMode(false);
                      setUiFont(key);
                      setSetting("uiFontFamily", key);
                      applyUiFont();
                    }
                  }}
                >
                  {[
                    ...UI_FONT_PRESETS.map(([label, value]) => (
                      <SelectItem key={value} textValue={label}>
                        <span style={{ fontFamily: value || undefined }}>{label}</span>
                      </SelectItem>
                    )),
                    <SelectItem key="__custom__" textValue="Custom">
                      Custom…
                    </SelectItem>,
                  ]}
                </Select>
                {uiFontCustomMode && (
                  <Input
                    size="sm"
                    variant="bordered"
                    className="settings-input"
                    value={uiFont}
                    onValueChange={(v) => {
                      setUiFont(v);
                      setSetting("uiFontFamily", v);
                      applyUiFont();
                    }}
                    placeholder='"Segoe UI", system-ui, sans-serif'
                    aria-label="Custom interface font"
                  />
                )}
              </div>
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
              <div className="settings-control-col">
                <Tabs
                  size="md"
                  aria-label="Terminal font size"
                  selectedKey={sizeCustom ? "custom" : String(termSize)}
                  onSelectionChange={(k) => {
                    if (k === "custom") {
                      setSizeCustom(true);
                    } else {
                      setSizeCustom(false);
                      changeTermSize(Number(k));
                    }
                  }}
                >
                  {[...TERM_FONT_SIZES.map((n) => <Tab key={String(n)} title={`${n}px`} />), <Tab key="custom" title="Custom" />]}
                </Tabs>
                {sizeCustom && (
                  <Input
                    size="sm"
                    type="number"
                    variant="bordered"
                    className="settings-input-sm"
                    value={String(termSize)}
                    min={8}
                    max={32}
                    endContent={<span className="dim">px</span>}
                    onValueChange={(v) => changeTermSize(Number(v))}
                    aria-label="Custom font size"
                  />
                )}
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-label">Font family</div>
                <div className="settings-desc">Pick a monospace font, or choose Custom to type your own stack.</div>
              </div>
              <div className="settings-control-col">
                <Select
                  size="md"
                  aria-label="Terminal font"
                  className="settings-input"
                  selectedKeys={[fontCustom ? "__custom__" : termFont]}
                  onSelectionChange={(keys) => {
                    const key = Array.from(keys)[0] as string | undefined;
                    if (!key) return;
                    if (key === "__custom__") {
                      setFontCustom(true);
                    } else {
                      setFontCustom(false);
                      changeTermFont(key);
                    }
                  }}
                >
                  {[
                    ...FONT_PRESETS.map(([label, value]) => (
                      <SelectItem key={value} textValue={label}>
                        <span style={{ fontFamily: value }}>{label}</span>
                      </SelectItem>
                    )),
                    <SelectItem key="__custom__" textValue="Custom">
                      Custom…
                    </SelectItem>,
                  ]}
                </Select>
                {fontCustom && (
                  <Input
                    size="sm"
                    variant="bordered"
                    className="settings-input"
                    value={termFont}
                    onValueChange={changeTermFont}
                    placeholder='"JetBrains Mono", Consolas, monospace'
                    aria-label="Custom font family"
                  />
                )}
              </div>
            </div>
          </>
        )}

        {section === "git" && (
          <>
            <h2>Git</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-label">Clone directory</div>
                <div className="settings-desc">
                  Where "Import from Git" clones repositories. Leave empty for the default.
                </div>
                <div className="settings-path">Default: {defaultGitDir || "Documents/GitHub"}</div>
              </div>
              <div className="settings-control-col">
                <Input
                  size="md"
                  variant="bordered"
                  className="settings-input"
                  value={gitDir}
                  placeholder={defaultGitDir || "Documents/GitHub"}
                  onValueChange={(v) => {
                    setGitDir(v);
                    setSetting("gitImportDir", v.trim());
                  }}
                  aria-label="Clone directory"
                />
                <div className="settings-btns">
                  <Button
                    size="md"
                    variant="flat"
                    startContent={<FolderOpen size={14} />}
                    onPress={async () => {
                      const picked = await open({ directory: true, multiple: false });
                      if (typeof picked === "string") {
                        setGitDir(picked);
                        setSetting("gitImportDir", picked);
                      }
                    }}
                  >
                    Browse
                  </Button>
                  <Button
                    size="md"
                    variant="flat"
                    isDisabled={!gitDir}
                    onPress={() => {
                      setGitDir("");
                      setSetting("gitImportDir", "");
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </div>
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
