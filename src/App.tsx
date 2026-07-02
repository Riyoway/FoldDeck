import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  Bot,
  Boxes,
  ExternalLink,
  FileCode,
  FolderOpen,
  Gamepad2,
  Globe,
  Package,
  Play,
  Plus,
  ScrollText,
  Server,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import "./App.css";

interface ProjectInfo {
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
  warnings: string[];
}

interface ProjectStatus {
  id: string;
  running: boolean;
  startedAt?: number | null;
  url?: string | null;
  crashCount: number;
  lastExitCode?: number | null;
}

const KIND_ICONS: Record<string, typeof Globe> = {
  "web-app": Globe,
  "static-site": FileCode,
  "backend-server": Server,
  bot: Bot,
  worker: Terminal,
  "game-server": Gamepad2,
  "docker-compose": Boxes,
  unknown: Package,
};

const MAX_LOG_LINES = 2000;

function formatUptime(startedAt?: number | null): string {
  if (!startedAt) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - startedAt);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function App() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ProjectStatus>>({});
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
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

  const addPaths = useCallback(
    async (paths: string[]) => {
      setError(null);
      for (const p of paths) {
        try {
          await invoke("add_project", { path: p });
        } catch (e) {
          setError(String(e));
        }
      }
      await refreshProjects();
      await refreshStatuses();
    },
    [refreshProjects, refreshStatuses],
  );

  useEffect(() => {
    refreshProjects();
    refreshStatuses();

    const unlisteners = [
      listen<{ id: string; line: string }>("project-log", (e) => {
        setLogs((prev) => {
          const lines = [...(prev[e.payload.id] ?? []), e.payload.line];
          if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
          return { ...prev, [e.payload.id]: lines };
        });
      }),
      listen("project-started", refreshStatuses),
      listen("project-exit", refreshStatuses),
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
  }, [addPaths, refreshProjects, refreshStatuses]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
  }, [logs, selected]);

  const addFolder = async () => {
    const picked = await open({ directory: true, multiple: true });
    if (picked) await addPaths(Array.isArray(picked) ? picked : [picked]);
  };

  const start = async (id: string) => {
    setError(null);
    try {
      await invoke("start_project", { id });
      setLogs((prev) => ({ ...prev, [id]: [] }));
      setSelected(id);
    } catch (e) {
      setError(String(e));
    }
  };

  const stop = async (id: string) => {
    setError(null);
    try {
      await invoke("stop_project", { id });
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async (id: string) => {
    await invoke("remove_project", { id });
    if (selected === id) setSelected(null);
    await refreshProjects();
  };

  const openLogs = async (id: string) => {
    const existing = await invoke<string[]>("get_logs", { id });
    setLogs((prev) => ({ ...prev, [id]: existing }));
    setSelected(id);
  };

  const running = projects.filter((p) => statuses[p.id]?.running);
  const stopped = projects.filter((p) => !statuses[p.id]?.running);
  const selectedProject = projects.find((p) => p.id === selected);

  const renderCard = (p: ProjectInfo) => {
    const st = statuses[p.id];
    const isRunning = !!st?.running;
    const Icon = KIND_ICONS[p.kind] ?? Package;
    const url =
      st?.url ??
      (isRunning && p.defaultPort && p.kind === "web-app"
        ? `http://localhost:${p.defaultPort}`
        : null);
    return (
      <div className={`card ${isRunning ? "card-running" : ""}`} key={p.id}>
        <div className="card-head">
          <Icon size={18} className="kind-icon" />
          <span className="card-name" title={p.path}>{p.name}</span>
          <span className="badge">{p.framework ?? p.kind}</span>
          {p.subtype === "discord" && <span className="badge badge-discord">Discord Bot</span>}
        </div>
        <div className="card-meta">
          {p.runtime && <span>{p.runtime}</span>}
          {p.packageManager && <span>{p.packageManager}</span>}
          {p.startCommand && <code className="cmd">{p.startCommand}</code>}
        </div>
        {isRunning && (
          <div className="card-status">
            <span className="dot dot-green" />
            {url ? (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  openUrl(url);
                }}
              >
                {url}
              </a>
            ) : (
              <span>Running</span>
            )}
            <span className="uptime">{formatUptime(st?.startedAt)}</span>
          </div>
        )}
        {!isRunning && st?.lastExitCode != null && st.lastExitCode !== 0 && (
          <div className="card-status warn-text">
            <AlertTriangle size={13} /> exited with code {st.lastExitCode}
            {st.crashCount > 0 && ` (crashes: ${st.crashCount})`}
          </div>
        )}
        {p.warnings.length > 0 && (
          <ul className="warnings">
            {p.warnings.map((w, i) => (
              <li key={i}>
                <AlertTriangle size={12} /> {w}
              </li>
            ))}
          </ul>
        )}
        <div className="card-actions">
          {isRunning ? (
            <button className="btn btn-stop" onClick={() => stop(p.id)}>
              <Square size={14} /> Stop
            </button>
          ) : (
            <button
              className="btn btn-start"
              onClick={() => start(p.id)}
              disabled={!p.startCommand}
              title={p.startCommand ?? "No start command detected"}
            >
              <Play size={14} /> Start
            </button>
          )}
          {url && (
            <button className="btn" onClick={() => openUrl(url)}>
              <ExternalLink size={14} /> Open
            </button>
          )}
          <button className="btn" onClick={() => openLogs(p.id)}>
            <ScrollText size={14} /> Logs
          </button>
          <button className="btn" onClick={() => invoke("open_folder", { path: p.path })}>
            <FolderOpen size={14} /> Folder
          </button>
          <button className="btn btn-ghost" onClick={() => remove(p.id)} title="Remove from FoldDeck">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className={`app ${dragging ? "app-dragging" : ""}`}>
      <header className="header">
        <h1>FoldDeck</h1>
        <span className="hint">Drop a folder anywhere, or</span>
        <button className="btn btn-primary" onClick={addFolder}>
          <Plus size={15} /> Add Folder
        </button>
      </header>

      {error && (
        <div className="error-banner">
          <AlertTriangle size={14} /> {error}
          <button className="btn btn-ghost" onClick={() => setError(null)}>
            <X size={13} />
          </button>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="empty">
          <Package size={40} />
          <p>Drop a project folder here.</p>
          <p className="hint">FoldDeck detects what it is. Press Start.</p>
        </div>
      ) : (
        <main className="main">
          {running.length > 0 && (
            <section>
              <h2>Running</h2>
              <div className="grid">{running.map(renderCard)}</div>
            </section>
          )}
          <section>
            <h2>Stopped</h2>
            {stopped.length === 0 ? (
              <p className="hint">Everything is running.</p>
            ) : (
              <div className="grid">{stopped.map(renderCard)}</div>
            )}
          </section>
        </main>
      )}

      {selectedProject && (
        <div className="log-panel">
          <div className="log-head">
            <ScrollText size={15} />
            <span>{selectedProject.name}</span>
            {statuses[selectedProject.id]?.running && <span className="dot dot-green" />}
            <button className="btn btn-ghost log-close" onClick={() => setSelected(null)}>
              <X size={15} />
            </button>
          </div>
          <div className="log-body">
            <pre>{(logs[selectedProject.id] ?? []).join("\n") || "No logs yet."}</pre>
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {dragging && <div className="drop-overlay">Drop folder to add</div>}
    </div>
  );
}

export default App;
