import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { currentMonitor, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Tooltip,
} from "@heroui/react";
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Minus,
  Pencil,
  Play,
  Plus,
  RotateCw,
  ScrollText,
  Settings,
  Square,
  Trash2,
  X,
} from "lucide-react";
import BotPanel from "./BotPanel";
import ContextMenu, { type MenuItem, type MenuState } from "./ContextMenu";
import Dashboard from "./Dashboard";
import GitImportModal from "./GitImportModal";
import LogView from "./LogView";
import MarkdownView from "./MarkdownView";
import TerminalView from "./TerminalView";
import EnvEditor from "./EnvEditor";
import PackagePanel from "./PackagePanel";
import DoctorPanel from "./DoctorPanel";
import ProjectIcon from "./ProjectIcon";
import RequestChart from "./RequestChart";
import SettingsPage from "./SettingsPage";
import Sidebar from "./Sidebar";
import { confirmCommandAudit } from "./audit";
import { applyUiFont, applyUiZoom, getSetting, setSetting } from "./settings";
import "./App.css";

const appWindow = getCurrentWindow();

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
  iconDataUri?: string | null;
  fileServer?: string | null;
  docs?: string[];
  warnings: string[];
}

export interface ProjectStatus {
  id: string;
  running: boolean;
  startedAt?: number | null;
  url?: string | null;
  crashCount: number;
  lastExitCode?: number | null;
  lastStoppedAt?: number | null;
}

type Tab = "logs" | "terminal" | "readme" | "bot" | "doctor" | "env" | "packages" | "info";

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
  const [view, setView] = useState<"main" | "settings">("main");
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getSetting("sidebarCollapsed"));
  const [sidebarWidth, setSidebarWidth] = useState(getSetting("sidebarWidth"));
  const [fileServerAsk, setFileServerAsk] = useState<ProjectInfo | null>(null);
  const [detailHeaderHeight, setDetailHeaderHeight] = useState(getSetting("detailHeaderHeight"));
  const detailHeadRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [gitImportOpen, setGitImportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [, setTick] = useState(0);
  const terminalRef = useRef<HTMLDivElement>(null);

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
    applyUiZoom();
    applyUiFont();
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
    // Scroll the terminal container itself — never scrollIntoView, which also
    // scrolls ancestor scroll containers and would lift the whole app (and the
    // titlebar) off the top of the window.
    if (tab === "logs" && getSetting("logAutoScroll") && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, selectedId, tab]);

  // Frameless-window guards: keep the custom titlebar reachable if the window is
  // dragged above the screen top, and compensate for Windows' borderless-maximize
  // overflow so the titlebar isn't clipped off the top edge.
  useEffect(() => {
    const syncMaximized = async () => {
      const isMax = await appWindow.isMaximized();
      document.documentElement.classList.toggle("maximized", isMax);
      let inset = 0;
      if (isMax) {
        const [pos, mon] = await Promise.all([appWindow.outerPosition(), currentMonitor()]);
        if (mon) inset = Math.max(0, (mon.position.y - pos.y) / mon.scaleFactor);
      }
      document.documentElement.style.setProperty("--max-inset-top", `${inset}px`);
    };
    const unlisten = [
      appWindow.onMoved(async ({ payload }) => {
        // Windows parks minimized windows at ~(-32000, -32000). Repositioning
        // then corrupts the window and it restores transparent — never clamp.
        if (payload.y <= -30000) return;
        if ((await appWindow.isMinimized()) || (await appWindow.isMaximized())) return;
        const mon = await currentMonitor();
        const top = mon ? mon.position.y : 0;
        if (payload.y < top) await appWindow.setPosition(new PhysicalPosition(payload.x, top));
      }),
      appWindow.onResized(syncMaximized),
    ];
    syncMaximized();
    return () => unlisten.forEach((u) => u.then((f) => f()));
  }, []);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    setRenaming(false);
  }, [selectedId]);

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

  const startFileServer = async (id: string, mode: string) => {
    setLogs((prev) => ({ ...prev, [id]: [] }));
    await call("start_file_server", { id, mode });
    await refreshProjects();
    setTab("logs");
  };

  const start = async (p: ProjectInfo) => {
    // Unrecognized folders are served as a file server; ask once if not configured.
    if (p.kind === "unknown" && !p.startCommand) {
      const globalDefault = getSetting("fileServerDefault");
      const mode = p.fileServer ?? (globalDefault !== "ask" ? globalDefault : null);
      if (!mode) {
        setFileServerAsk(p);
        return;
      }
      await startFileServer(p.id, mode);
      return;
    }
    if (p.startCommand && !(await confirmCommandAudit(p.startCommand))) return;
    setLogs((prev) => ({ ...prev, [p.id]: [] }));
    await call("start_project", { id: p.id });
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

  // Custom right-click menus; suppress the native one everywhere.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);

  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const projectMenuItems = (p: ProjectInfo): MenuItem[] => {
    const st = statuses[p.id];
    const isRunning = !!st?.running;
    const url =
      st?.url ??
      (isRunning && p.defaultPort && p.kind === "web-app"
        ? `http://localhost:${p.defaultPort}`
        : null);
    const canStart = !!p.startCommand || p.kind === "static-site" || p.kind === "unknown";
    return [
      isRunning
        ? { key: "stop", label: "Stop", icon: <Square size={14} />, onClick: () => call("stop_project", { id: p.id }) }
        : { key: "start", label: "Start", icon: <Play size={14} />, disabled: !canStart, onClick: () => start(p) },
      ...(isRunning
        ? [{ key: "restart", label: "Restart", icon: <RotateCw size={14} />, onClick: () => call("restart_project", { id: p.id }) }]
        : []),
      { key: "open", label: "Open & view logs", icon: <ScrollText size={14} />, onClick: () => { selectProject(p.id); setTab("logs"); } },
      ...(url
        ? [{ key: "browser", label: "Open in browser", icon: <ExternalLink size={14} />, onClick: () => openUrl(url) }]
        : []),
      { key: "folder", label: "Open folder", icon: <FolderOpen size={14} />, onClick: () => invoke("open_folder", { path: p.path }) },
      { key: "copy", label: "Copy path", icon: <Copy size={14} />, onClick: () => navigator.clipboard.writeText(p.path) },
      { key: "d1", divider: true },
      { key: "remove", label: "Remove from FoldDeck", icon: <Trash2 size={14} />, danger: true, onClick: () => remove(p.id) },
    ];
  };

  const projectContextMenu = (e: React.MouseEvent, p: ProjectInfo) => openMenu(e, projectMenuItems(p));
  const generalContextMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { key: "add", label: "Add folder", icon: <Plus size={14} />, onClick: addFolder },
      { key: "git", label: "Import from Git", icon: <GitBranch size={14} />, onClick: () => setGitImportOpen(true) },
    ]);

  const handleGitImported = async (path: string) => {
    setGitImportOpen(false);
    try {
      const info = await invoke<ProjectInfo>("add_project", { path });
      await refreshAll();
      setSelectedId(info.id);
    } catch (e) {
      setError(String(e));
    }
  };
  const logsContextMenu = (e: React.MouseEvent, id: string) =>
    openMenu(e, [
      { key: "copy", label: "Copy all logs", icon: <Copy size={14} />, onClick: () => navigator.clipboard.writeText((logs[id] ?? []).join("\n")) },
    ]);

  const setSidebar = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    setSetting("sidebarCollapsed", collapsed);
  };

  const changeSidebarWidth = (w: number) => {
    setSidebarWidth(w);
    setSetting("sidebarWidth", w);
  };

  const startHeaderResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = detailHeadRef.current?.offsetHeight ?? 160;
    const set = (h: number) => {
      const clamped = Math.min(window.innerHeight * 0.6, Math.max(48, h));
      setDetailHeaderHeight(clamped);
      setSetting("detailHeaderHeight", clamped);
    };
    const move = (ev: PointerEvent) => set(startH + ev.clientY - startY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing-v");
    };
    document.body.classList.add("resizing-v");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const reorderProjects = (ids: string[]) => {
    // Optimistic reorder so there's no flash, then persist to the backend.
    setProjects((prev) => ids.map((id) => prev.find((p) => p.id === id)).filter(Boolean) as ProjectInfo[]);
    invoke("reorder_projects", { ids }).catch((e) => setError(String(e)));
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
        ["terminal", "Terminal", true],
        ["readme", "Readme", (selected.docs?.length ?? 0) > 0],
        ["bot", "Bot", selected.kind === "bot"],
        ["doctor", "Doctor", true],
        ["env", "Env", selected.envFiles.length > 0],
        ["packages", "Packages", !!selected.packageManager],
        ["info", "Info", true],
      ]
    : [];
  const activeTab = tabs.find(([t, , show]) => t === tab && show) ? tab : "logs";

  return (
    <div className="app">
      <header className="titlebar" data-tauri-drag-region>
        <span className="brand" data-tauri-drag-region>
          FoldDeck
        </span>
        <div className="titlebar-controls">
          <button
            className={`tb-btn ${view === "settings" ? "tb-btn-active" : ""}`}
            title="Settings"
            onClick={() => setView(view === "settings" ? "main" : "settings")}
          >
            <Settings size={17} />
          </button>
          <button className="tb-btn" title="Minimize" onClick={() => appWindow.minimize()}>
            <Minus size={17} />
          </button>
          <button className="tb-btn" title="Maximize" onClick={() => appWindow.toggleMaximize()}>
            <Square size={13} />
          </button>
          <button className="tb-btn tb-close" title="Close" onClick={() => appWindow.close()}>
            <X size={17} />
          </button>
        </div>
      </header>

      {view === "settings" ? (
        <SettingsPage />
      ) : (
        <>
      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <Button isIconOnly size="md" variant="light" className="ml-auto" aria-label="Dismiss error" onPress={() => setError(null)}>
            <X size={14} />
          </Button>
        </div>
      )}

      <div className="body">
        <Sidebar
          projects={projects}
          statuses={statuses}
          selectedId={selectedId}
          width={sidebarWidth}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebar(!sidebarCollapsed)}
          onSelectDashboard={() => setSelectedId(null)}
          onSelectProject={selectProject}
          onAddFolder={addFolder}
          onReorder={reorderProjects}
          onResize={changeSidebarWidth}
          onProjectContextMenu={projectContextMenu}
          onBackgroundContextMenu={generalContextMenu}
          onImportGit={() => setGitImportOpen(true)}
        />

        <main className="detail">
          {!selected ? (
            <Dashboard
              projects={projects}
              statuses={statuses}
              onSelect={selectProject}
              onStart={start}
              onStop={(id) => call("stop_project", { id })}
              onChanged={refreshProjects}
              onProjectContextMenu={projectContextMenu}
              onBackgroundContextMenu={generalContextMenu}
            />
          ) : (
            <>
              <div
                className="detail-head"
                ref={detailHeadRef}
                style={
                  detailHeaderHeight
                    ? { height: detailHeaderHeight, overflowY: "auto" }
                    : undefined
                }
              >
                <div className="detail-title">
                  {renaming ? (
                    <>
                      <Input
                        size="md"
                        variant="bordered"
                        className="rename-input"
                        value={nameDraft}
                        autoFocus
                        placeholder="Display name (empty = folder name)"
                        onValueChange={setNameDraft}
                        onKeyDown={async (e) => {
                          if (e.key === "Enter") {
                            await invoke("set_project_name", {
                              id: selected.id,
                              name: nameDraft.trim() || null,
                            });
                            setRenaming(false);
                            await refreshProjects();
                          }
                          if (e.key === "Escape") setRenaming(false);
                        }}
                      />
                      <Button
                        isIconOnly
                        size="md"
                        variant="light"
                        aria-label="Save name"
                        onPress={async () => {
                          await invoke("set_project_name", {
                            id: selected.id,
                            name: nameDraft.trim() || null,
                          });
                          setRenaming(false);
                          await refreshProjects();
                        }}
                      >
                        <Check size={15} />
                      </Button>
                    </>
                  ) : (
                    <>
                      <ProjectIcon project={selected} size={18} />
                      <span className="detail-name">{selected.name}</span>
                      <Tooltip content="Rename" size="md">
                        <Button
                          isIconOnly
                          size="md"
                          variant="light"
                          aria-label="Rename"
                          onPress={() => {
                            setNameDraft(selected.name);
                            setRenaming(true);
                          }}
                        >
                          <Pencil size={14} />
                        </Button>
                      </Tooltip>
                    </>
                  )}
                  <Chip size="md" variant="flat">
                    {selected.framework ?? selected.kind}
                  </Chip>
                  {selected.subtype === "discord" && (
                    <Chip size="md" variant="flat">
                      discord bot
                    </Chip>
                  )}
                  {selected.runtime && (
                    <Chip size="md" variant="flat" className="chip-dim">
                      {selected.runtime}
                    </Chip>
                  )}
                  {selected.packageManager && (
                    <Chip size="md" variant="flat" className="chip-dim">
                      {selected.packageManager}
                    </Chip>
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
                {(["web-app", "backend-server", "static-site", "docker-compose"].includes(selected.kind) ||
                  (selected.kind === "unknown" && (isRunning || selected.fileServer))) && (
                  <RequestChart key={selected.id} projectId={selected.id} running={isRunning} />
                )}
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
                      <Button
                        size="md"
                        color="danger"
                        variant="flat"
                        startContent={<Square size={14} />}
                        onPress={() => call("stop_project", { id: selected.id })}
                      >
                        Stop
                      </Button>
                      <Button
                        size="md"
                        variant="flat"
                        startContent={<RotateCw size={14} />}
                        onPress={() => call("restart_project", { id: selected.id })}
                      >
                        Restart
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="md"
                      color="primary"
                      variant="flat"
                      startContent={<Play size={14} />}
                      onPress={() => start(selected)}
                      isDisabled={
                        !selected.startCommand &&
                        selected.kind !== "static-site" &&
                        selected.kind !== "unknown"
                      }
                    >
                      Start
                    </Button>
                  )}
                  {url && (
                    <Button
                      size="md"
                      variant="flat"
                      startContent={<ExternalLink size={14} />}
                      onPress={() => openUrl(url)}
                    >
                      Open
                    </Button>
                  )}
                  <Button
                    size="md"
                    variant="flat"
                    startContent={<FolderOpen size={14} />}
                    onPress={() => invoke("open_folder", { path: selected.path })}
                  >
                    Folder
                  </Button>
                  <Tooltip content="Remove from FoldDeck (files are kept)" size="md">
                    <Button
                      size="md"
                      variant="light"
                      className="ml-auto"
                      startContent={<Trash2 size={14} />}
                      onPress={() => remove(selected.id)}
                    >
                      Remove
                    </Button>
                  </Tooltip>
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

              <div className="detail-resize" onPointerDown={startHeaderResize} title="Drag to resize" />

              <div className="tab-content">
                {activeTab === "logs" && (
                  <div
                    className="terminal"
                    ref={terminalRef}
                    onContextMenu={(e) => logsContextMenu(e, selected.id)}
                  >
                    <LogView lines={logs[selected.id] ?? []} />
                  </div>
                )}
                {activeTab === "terminal" && (
                  <TerminalView key={selected.id} projectId={selected.id} cwd={selected.path} />
                )}
                {activeTab === "readme" && <MarkdownView key={selected.id} project={selected} />}
                {activeTab === "bot" && (
                  <BotPanel key={selected.id} project={selected} status={st} logs={logs[selected.id] ?? []} />
                )}
                {activeTab === "doctor" && <DoctorPanel key={selected.id} projectId={selected.id} />}
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
        </>
      )}

      <Modal
        isOpen={!!fileServerAsk}
        onClose={() => setFileServerAsk(null)}
        size="md"
        placement="center"
        backdrop="opaque"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="modal-head-hero">
                <FolderOpen size={16} aria-hidden="true" /> Serve this folder?
              </ModalHeader>
              <ModalBody>
                <p>
                  <code className="inline-code">{fileServerAsk?.name}</code> doesn't look like an
                  app, but you can serve its files over HTTP and browse them from a browser.
                </p>
                <p className="dim" style={{ fontSize: "12.5px" }}>
                  Your choice is remembered for this project — change it anytime in Settings →
                  Servers.
                </p>
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="flat"
                  onPress={() => {
                    const p = fileServerAsk!;
                    onClose();
                    startFileServer(p.id, "python");
                  }}
                >
                  Python (http.server)
                </Button>
                <Button
                  color="primary"
                  onPress={() => {
                    const p = fileServerAsk!;
                    onClose();
                    startFileServer(p.id, "builtin");
                  }}
                >
                  Built-in file server
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <GitImportModal
        open={gitImportOpen}
        onClose={() => setGitImportOpen(false)}
        onImported={handleGitImported}
      />

      <ContextMenu menu={menu} onClose={() => setMenu(null)} />

      {dragging && <div className="drop-overlay">Drop folder to add</div>}
    </div>
  );
}

export default App;
