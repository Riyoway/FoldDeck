import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ExternalLink,
  FolderOpen,
  Play,
  Plus,
  RotateCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import EnvEditor from "./EnvEditor";
import PackagePanel from "./PackagePanel";
import "./App.css";

export interface ProjectInfo {
  id: string;
  path: string;
  name: string;
  kind: string;
  subtype?: string | null;
  framework?: string | null;
  runtime?: string | null;
  packageManager?: string | null;
  startCommand?: string | null;
  defaultPort?: number | null;
  scripts: Record<string, string>;
  envFiles: string[];
  lockfiles: string[];
  depsInstalled?: boolean | null;
  warnings: string[];
}

export interface ProjectStatus {
  id: string;
  running: boolean;
  startedAt?: number | null;
  url?: string | null;
  crashCount: number;
  lastExitCode?: number | null;
}

type Tab = "logs" | "env" | "packages" | "info";

const MAX_LOG_LINES = 2000;

function formatUptime(startedAt?: number | null): string {
  if (!startedAt) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - startedAt);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

function App() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ProjectStatus>>({});
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("logs");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [, setTick] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  const refreshProjects = useCallback(async () => {
    setProjects(await invoke<ProjectInfo[]>("list_projects"));
  }, []);

  const refreshStatuses = useCallback(async () => {
    const arr = await invoke<ProjectStatus[]>("get_statuses");
    setStatuses(Object.fromEntries(arr.map((s) => [s.id, s])));
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshProjects(), refreshStatuses()]);
  }, [refreshProjects, refreshStatuses]);

  const addPaths = useCallback(
    async (paths: string[]) => {
      setError(null);
      let lastAdded: string | null = null;
      for (const p of paths) {
        try {
          const info = await invoke<ProjectInfo>("add_project", { path: p });
          lastAdded = info.id;
        } catch (e) {
          setError(String(e));
        }
      }
      await refreshAll();
      if (lastAdded) setSelectedId(lastAdded);
    },
    [refreshAll],
  );

  useEffect(() => {
    refreshAll();
    const unlisteners = [
      listen<{ id: string; line: string }>("project-log", (e) => {
        setLogs((prev) => {
          const lines = [...(prev[e.payload.id] ?? []), e.payload.line];
          if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
          return { ...prev, [e.payload.id]: lines };
        });
      }),
      listen("project-started", refreshStatuses),
      listen("project-exit", refreshAll),
      listen("project-url", refreshStatuses),
      getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === "drop") {
          setDragging(false);
          addPaths(e.payload.paths);
        } else if (e.payload.type === "leave") {
          setDragging(false);
        } else {
          setDragging(true);
        }
      }),
    ];
    const timer = setInterval(() => setTick((t) => t + 1), 5000);
    return () => {
      unlisteners.forEach((u) => u.then((f) => f()));
      clearInterval(timer);
    };
  }, [addPaths, refreshAll, refreshStatuses]);

  useEffect(() => {
    if (tab === "logs") logEndRef.current?.scrollIntoView();
  }, [logs, selectedId, tab]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected && projects.length > 0) setSelectedId(projects[0].id);
  }, [projects, selected]);

  const addFolder = async () => {
    const picked = await open({ directory: true, multiple: true });
    if (picked) await addPaths(Array.isArray(picked) ? picked : [picked]);
  };

  const call = async (cmd: string, args: Record<string, unknown>) => {
    setError(null);
    try {
      await invoke(cmd, args);
    } catch (e) {
      setError(String(e));
    }
  };

  const start = async (id: string) => {
    setLogs((prev) => ({ ...prev, [id]: [] }));
    await call("start_project", { id });
    setTab("logs");
  };

  const remove = async (id: string) => {
    await invoke("remove_project", { id });
    if (selectedId === id) setSelectedId(null);
    await refreshAll();
  };

  const seedLogs = async (id: string) => {
    const existing = await invoke<string[]>("get_logs", { id });
    setLogs((prev) => (prev[id]?.length ? prev : { ...prev, [id]: existing }));
  };

  const selectProject = (id: string) => {
    setSelectedId(id);
    seedLogs(id);
  };

  const running = projects.filter((p) => statuses[p.id]?.running);
  const stopped = projects.filter((p) => !statuses[p.id]?.running);

  const renderRow = (p: ProjectInfo) => {
    const st = statuses[p.id];
    const isRunning = !!st?.running;
    return (
      <div
        key={p.id}
        className={`row ${p.id === selectedId ? "row-selected" : ""}`}
        onClick={() => selectProject(p.id)}
      >
        <span className={`st ${isRunning ? "st-on" : ""}`} />
        <span className="row-name">{p.name}</span>
        {p.warnings.length > 0 && <span className="row-warn">{p.warnings.length}</span>}
        <span className="row-fw">{p.framework ?? p.kind}</span>
        <span className="row-port">
          {isRunning && st?.url
            ? st.url.replace(/^https?:\/\//, "")
            : p.defaultPort
              ? `:${p.defaultPort}`
              : ""}
        </span>
      </div>
    );
  };

  const st = selected ? statuses[selected.id] : undefined;
  const isRunning = !!st?.running;
  const url =
    st?.url ??
    (isRunning && selected?.defaultPort && selected.kind === "web-app"
      ? `http://localhost:${selected.defaultPort}`
      : null);

  const tabs: [Tab, string, boolean][] = selected
    ? [
        ["logs", "Logs", true],
        ["env", "Env", selected.envFiles.length > 0],
        ["packages", "Packages", !!selected.packageManager],
        ["info", "Info", true],
      ]
    : [];
  const activeTab = tabs.find(([t, , show]) => t === tab && show) ? tab : "logs";

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">FoldDeck</span>
        <span className="topbar-hint">drop a folder to add a project</span>
        <button className="btn" onClick={addFolder}>
          <Plus size={13} /> Add folder
        </button>
      </header>

      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button className="btn btn-ghost" onClick={() => setError(null)}>
            <X size={12} />
          </button>
        </div>
      )}

      <div className="body">
        <aside className="sidebar">
          {projects.length === 0 && (
            <div className="sidebar-empty">
              No projects.
              <br />
              Drop a folder or use Add folder.
            </div>
          )}
          {running.length > 0 && (
            <>
              <div className="group-label">running — {running.length}</div>
              {running.map(renderRow)}
            </>
          )}
          {stopped.length > 0 && (
            <>
              <div className="group-label">stopped — {stopped.length}</div>
              {stopped.map(renderRow)}
            </>
          )}
        </aside>

        <main className="detail">
          {!selected ? (
            <div className="detail-empty">Select a project.</div>
          ) : (
            <>
              <div className="detail-head">
                <div className="detail-title">
                  <span className="detail-name">{selected.name}</span>
                  <span className="tag">{selected.framework ?? selected.kind}</span>
                  {selected.subtype === "discord" && <span className="tag">discord bot</span>}
                  {selected.runtime && <span className="tag tag-dim">{selected.runtime}</span>}
                  {selected.packageManager && (
                    <span className="tag tag-dim">{selected.packageManager}</span>
                  )}
                </div>
                <div
                  className="detail-path"
                  title="Open folder"
                  onClick={() => invoke("open_folder", { path: selected.path })}
                >
                  {selected.path}
                </div>
                <div className="detail-status">
                  {isRunning ? (
                    <>
                      <span className="st st-on" />
                      <span className="ok-text">running</span>
                      <span className="dim">{formatUptime(st?.startedAt)}</span>
                      {url && (
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            openUrl(url);
                          }}
                        >
                          {url}
                        </a>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="st" />
                      <span className="dim">stopped</span>
                      {st?.lastExitCode != null && st.lastExitCode !== 0 && (
                        <span className="warn-text">
                          exit {st.lastExitCode}
                          {st.crashCount > 0 && ` · crashes ${st.crashCount}`}
                        </span>
                      )}
                    </>
                  )}
                  {selected.startCommand && <code className="dim">{selected.startCommand}</code>}
                </div>
                {selected.warnings.length > 0 && (
                  <div className="detail-warnings">
                    {selected.warnings.map((w, i) => (
                      <div key={i}>⚠ {w}</div>
                    ))}
                  </div>
                )}
                <div className="detail-actions">
                  {isRunning ? (
                    <>
                      <button className="btn btn-danger" onClick={() => call("stop_project", { id: selected.id })}>
                        <Square size={12} /> Stop
                      </button>
                      <button className="btn" onClick={() => call("restart_project", { id: selected.id })}>
                        <RotateCw size={12} /> Restart
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-ok"
                      onClick={() => start(selected.id)}
                      disabled={!selected.startCommand}
                      title={selected.startCommand ?? "No start command detected"}
                    >
                      <Play size={12} /> Start
                    </button>
                  )}
                  {url && (
                    <button className="btn" onClick={() => openUrl(url)}>
                      <ExternalLink size={12} /> Open
                    </button>
                  )}
                  <button className="btn" onClick={() => invoke("open_folder", { path: selected.path })}>
                    <FolderOpen size={12} /> Folder
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ marginLeft: "auto" }}
                    onClick={() => remove(selected.id)}
                    title="Remove from FoldDeck (files are kept)"
                  >
                    <Trash2 size={12} /> Remove
                  </button>
                </div>
              </div>

              <div className="tabbar">
                {tabs
                  .filter(([, , show]) => show)
                  .map(([t, label]) => (
                    <button
                      key={t}
                      className={`tab ${activeTab === t ? "tab-active" : ""}`}
                      onClick={() => setTab(t)}
                    >
                      {label}
                    </button>
                  ))}
              </div>

              <div className="tab-content">
                {activeTab === "logs" && (
                  <div className="terminal">
                    <pre>{(logs[selected.id] ?? []).join("\n") || "No output. Press Start to run the project."}</pre>
                    <div ref={logEndRef} />
                  </div>
                )}
                {activeTab === "env" && (
                  <EnvEditor
                    key={selected.id}
                    projectId={selected.id}
                    envFiles={selected.envFiles}
                    onChanged={refreshProjects}
                  />
                )}
                {activeTab === "packages" && (
                  <PackagePanel
                    key={selected.id}
                    project={selected}
                    onChanged={refreshProjects}
                    onRan={() => setTab("logs")}
                    onError={setError}
                  />
                )}
                {activeTab === "info" && (
                  <div className="info-table">
                    {(
                      [
                        ["id", selected.id],
                        ["path", selected.path],
                        ["type", selected.kind + (selected.subtype ? ` / ${selected.subtype}` : "")],
                        ["framework", selected.framework ?? "—"],
                        ["runtime", selected.runtime ?? "—"],
                        ["package manager", selected.packageManager ?? "—"],
                        ["start command", selected.startCommand ?? "—"],
                        ["default port", selected.defaultPort?.toString() ?? "—"],
                        ["env files", selected.envFiles.join(", ") || "—"],
                        ["lockfiles", selected.lockfiles.join(", ") || "—"],
                        [
                          "dependencies",
                          selected.depsInstalled == null
                            ? "—"
                            : selected.depsInstalled
                              ? "installed"
                              : "missing",
                        ],
                      ] as [string, string][]
                    ).map(([k, v]) => (
                      <div className="info-row" key={k}>
                        <span className="info-key">{k}</span>
                        <span className="info-val">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {dragging && <div className="drop-overlay">Drop folder to add</div>}
    </div>
  );
}

export default App;
