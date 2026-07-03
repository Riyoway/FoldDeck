import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Card, CardBody, Chip, Input, Select, SelectItem, Tooltip } from "@heroui/react";
import {
  AlertTriangle,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  LayoutGrid,
  Pencil,
  Pin,
  Play,
  Rows3,
  Search,
  Square,
  X,
} from "lucide-react";
import ProjectIcon from "./ProjectIcon";
import { formatUptime, type ProjectInfo, type ProjectStatus } from "./App";
import { getSetting, setSetting } from "./settings";

interface PortInfo {
  port: number;
  projectId: string;
  projectName: string;
  running: boolean;
  busy: boolean;
  overridden: boolean;
}

interface Props {
  projects: ProjectInfo[];
  statuses: Record<string, ProjectStatus>;
  onSelect: (id: string) => void;
  onStart: (project: ProjectInfo) => void;
  onStop: (id: string) => void;
  onChanged: () => void;
  onProjectContextMenu: (e: React.MouseEvent, project: ProjectInfo) => void;
  onBackgroundContextMenu: (e: React.MouseEvent) => void;
}

export default function Dashboard({
  projects,
  statuses,
  onSelect,
  onStart,
  onStop,
  onChanged,
  onProjectContextMenu,
  onBackgroundContextMenu,
}: Props) {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [editingPort, setEditingPort] = useState<string | null>(null);
  const [portDraft, setPortDraft] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "pinned" | "running" | "stopped" | "warnings">(
    "all",
  );
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [sort, setSort] = useState<"manual" | "name" | "created" | "category" | "status">("manual");
  const [density, setDensity] = useState(() => getSetting("dashDensity"));

  const refreshPorts = useCallback(() => {
    invoke<PortInfo[]>("get_ports_overview").then(setPorts);
  }, []);

  useEffect(refreshPorts, [refreshPorts, statuses, projects]);

  const running = projects.filter((p) => statuses[p.id]?.running);
  const warnings = projects.reduce((n, p) => n + p.warnings.length, 0);

  const savePort = async (projectId: string) => {
    const trimmed = portDraft.trim();
    const port = trimmed === "" ? null : Number(trimmed);
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return;
    await invoke("set_project_port", { id: projectId, port });
    setEditingPort(null);
    onChanged();
    refreshPorts();
  };

  const stats: [string, number, string][] = [
    ["Projects", projects.length, ""],
    ["Running", running.length, running.length ? "ok-text" : ""],
    ["Warnings", warnings, warnings ? "warn-text" : ""],
    ["Ports in use", ports.filter((p) => p.busy).length, ""],
  ];

  const q = query.trim().toLowerCase();
  const shown = projects.filter((p) => {
    if (filter === "pinned" && !p.pinned) return false;
    if (filter === "running" && !statuses[p.id]?.running) return false;
    if (filter === "stopped" && statuses[p.id]?.running) return false;
    if (filter === "warnings" && p.warnings.length === 0) return false;
    if (q && !(p.name.toLowerCase().includes(q) || (p.framework ?? p.kind).toLowerCase().includes(q)))
      return false;
    return true;
  });
  if (sort === "name") shown.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === "created") shown.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  else if (sort === "category")
    shown.sort((a, b) => (a.framework ?? a.kind).localeCompare(b.framework ?? b.kind));
  else if (sort === "status")
    shown.sort(
      (a, b) => Number(!!statuses[b.id]?.running) - Number(!!statuses[a.id]?.running),
    );
  // Pinned always float to the top (stable — keeps the chosen order within groups).
  shown.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const SORTS: [typeof sort, string][] = [
    ["manual", "Manual"],
    ["name", "Name"],
    ["created", "Newest"],
    ["category", "Category"],
    ["status", "Status"],
  ];
  const pinnedCount = projects.filter((p) => p.pinned).length;
  const FILTERS: [typeof filter, string][] = [
    ["all", "All"],
    ...(pinnedCount > 0 ? ([["pinned", "Pinned"]] as [typeof filter, string][]) : []),
    ["running", "Running"],
    ["stopped", "Stopped"],
    ["warnings", "Warnings"],
  ];

  return (
    <div className="dashboard" onContextMenu={onBackgroundContextMenu}>
      <div className="dash-inner">
        <div className="stats">
          {stats.map(([label, value, cls]) => (
            <Card key={label} shadow="none" radius="md" className="stat">
              <CardBody className="stat-body">
                <div className={`stat-num ${cls}`}>{value}</div>
                <div className="stat-label">{label}</div>
              </CardBody>
            </Card>
          ))}
        </div>

        <div className="dash-projects-head">
          <button
            className="dash-h dash-h-inline dash-collapse"
            onClick={() => setProjectsOpen((v) => !v)}
            title={projectsOpen ? "Collapse" : "Expand"}
          >
            {projectsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            Projects <span className="counter">{shown.length}</span>
          </button>
          {projects.length > 6 && (
            <div className="dash-toolbar">
              <div className="dash-search">
                <Search size={15} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
                  spellCheck={false}
                />
                {query && (
                  <button onClick={() => setQuery("")} title="Clear">
                    <X size={13} />
                  </button>
                )}
              </div>
              <div className="dash-filters">
                {FILTERS.map(([f, label]) => (
                  <button
                    key={f}
                    className={`dash-filter ${filter === f ? "dash-filter-on" : ""}`}
                    onClick={() => setFilter(f)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Select
                size="sm"
                aria-label="Sort projects"
                className="dash-sort"
                selectedKeys={[sort]}
                onSelectionChange={(keys) => {
                  const k = Array.from(keys)[0] as typeof sort | undefined;
                  if (k) setSort(k);
                }}
                startContent={<ArrowUpDown size={14} />}
                renderValue={() => SORTS.find(([s]) => s === sort)?.[1] ?? "Sort"}
              >
                {SORTS.map(([s, label]) => (
                  <SelectItem key={s}>{label}</SelectItem>
                ))}
              </Select>
              <div className="dash-filters dash-density" role="group" aria-label="Density">
                {([["comfortable", LayoutGrid, "Cards"], ["compact", Rows3, "List"]] as const).map(
                  ([d, Icon, label]) => (
                    <button
                      key={d}
                      className={`dash-filter ${density === d ? "dash-filter-on" : ""}`}
                      title={`${label} view`}
                      aria-label={`${label} view`}
                      aria-pressed={density === d}
                      onClick={() => {
                        setDensity(d);
                        setSetting("dashDensity", d);
                      }}
                    >
                      <Icon size={14} />
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
        {!projectsOpen ? null : projects.length === 0 ? (
          <p className="dim dash-empty">Drop a folder anywhere to add your first project.</p>
        ) : shown.length === 0 ? (
          <div className="dash-empty dash-empty-filtered">
            <span className="dim">No projects match.</span>
            <Button
              size="sm"
              variant="light"
              onPress={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Reset filters
            </Button>
          </div>
        ) : (
          <div className={`proj-grid ${density === "compact" ? "proj-grid-compact" : ""}`}>
            {shown.map((p) => {
              const st = statuses[p.id];
              const isRunning = !!st?.running;
              const url =
                st?.url ??
                (isRunning && p.defaultPort && p.kind === "web-app"
                  ? `http://localhost:${p.defaultPort}`
                  : null);
              const canStart =
                !!p.startCommand || p.kind === "static-site" || p.kind === "unknown";
              const cardState = isRunning
                ? "running"
                : st?.crashCount
                  ? "crashed"
                  : (st?.lastExitCode != null && st.lastExitCode !== 0) || p.depsInstalled === false
                    ? "warn"
                    : "stopped";
              return (
                <div
                  key={p.id}
                  className={`proj-card proj-card--${cardState}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${p.name}`}
                  onClick={() => onSelect(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(p.id);
                    }
                  }}
                  onContextMenu={(e) => onProjectContextMenu(e, p)}
                >
                  <div className="proj-card-head">
                    <ProjectIcon project={p} size={16} />
                    <span className="proj-card-name">{p.name}</span>
                    {p.pinned && <Pin size={12} className="proj-pin" aria-label="Pinned" />}
                    {p.warnings.length > 0 && (
                      <span className="proj-warn" title={`${p.warnings.length} warning(s)`}>
                        <AlertTriangle size={12} /> {p.warnings.length}
                      </span>
                    )}
                  </div>
                  <div className="proj-card-meta">
                    <span className="proj-tag">{p.framework ?? p.kind}</span>
                    {p.runtime ? `${p.runtime}` : ""}
                    <span className="proj-card-path" title={p.path}>
                      {p.runtime ? " · " : ""}
                      {p.path.split(/[\\/]/).filter(Boolean).slice(-2).join("/")}
                    </span>
                  </div>
                  <div className="proj-card-status">
                    <span className="st" />
                    {isRunning ? (
                      <>
                        {url ? (
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openUrl(url);
                            }}
                          >
                            {url.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          <span className="ok-text">running</span>
                        )}
                        <span className="dim proj-card-uptime">{formatUptime(st?.startedAt)}</span>
                      </>
                    ) : st?.crashCount ? (
                      <span className="warn-text">
                        <AlertTriangle size={11} /> crashed {st.crashCount}×
                      </span>
                    ) : st?.lastExitCode != null && st.lastExitCode !== 0 ? (
                      <span className="warn-text">exited ({st.lastExitCode})</span>
                    ) : p.depsInstalled === false ? (
                      <span className="warn-text">deps not installed</span>
                    ) : (
                      <span className="dim">
                        {p.defaultPort ? `stopped · ${p.defaultPort}` : "stopped"}
                      </span>
                    )}
                  </div>
                  {isRunning && st?.networkUrl && (
                    <div className="proj-card-net">
                      <span className="dim url-label">Net</span>
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openUrl(st.networkUrl!);
                        }}
                      >
                        {st.networkUrl.replace(/^https?:\/\//, "")}
                      </a>
                    </div>
                  )}
                  <div className="proj-card-actions" onClick={(e) => e.stopPropagation()}>
                    {isRunning ? (
                      <Button
                        size="sm"
                        color="danger"
                        variant="flat"
                        startContent={<Square size={14} />}
                        onPress={() => onStop(p.id)}
                      >
                        Stop
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        color="primary"
                        variant="flat"
                        isDisabled={!canStart}
                        startContent={<Play size={14} />}
                        onPress={() => onStart(p)}
                      >
                        Start
                      </Button>
                    )}
                    {url && (
                      <Button
                        size="sm"
                        variant="flat"
                        startContent={<ExternalLink size={14} />}
                        onPress={() => openUrl(url)}
                      >
                        Open
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {ports.length > 0 && (
          <>
            <h2 className="dash-h">Ports</h2>
            <table className="ports-table">
              <thead>
                <tr>
                  <th className="col-port">Port</th>
                  <th className="col-project">Project</th>
                  <th className="col-status">Status</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {ports.map((p) => {
                  const editing = editingPort === p.projectId;
                  return (
                    <tr
                      key={p.projectId}
                      tabIndex={editing ? undefined : 0}
                      onClick={() => !editing && onSelect(p.projectId)}
                      onKeyDown={(e) => {
                        if (!editing && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          onSelect(p.projectId);
                        }
                      }}
                    >
                      <td className="col-port">
                        {editing ? (
                          <span onClick={(e) => e.stopPropagation()}>
                            <Input
                              size="md"
                              variant="bordered"
                              className="port-input-hero"
                              value={portDraft}
                              autoFocus
                              placeholder="auto"
                              onValueChange={setPortDraft}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") savePort(p.projectId);
                                if (e.key === "Escape") setEditingPort(null);
                              }}
                            />
                          </span>
                        ) : (
                          <>
                            {p.port}
                            {p.running ? (
                              <Chip size="md" variant="flat" className="port-tag">
                                actual
                              </Chip>
                            ) : (
                              p.overridden && (
                                <Chip size="md" variant="flat" className="port-tag">
                                  custom
                                </Chip>
                              )
                            )}
                          </>
                        )}
                      </td>
                      <td className="col-project">{p.projectName}</td>
                      <td className="col-status">
                        {p.running ? (
                          <span className="ok-text">running</span>
                        ) : p.busy ? (
                          <span className="warn-text">in use — will auto-pick another</span>
                        ) : (
                          <span className="dim">free</span>
                        )}
                      </td>
                      <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                        {editing ? (
                          <>
                            <Button isIconOnly size="md" variant="light" aria-label="Save" onPress={() => savePort(p.projectId)}>
                              <Check size={14} />
                            </Button>
                            <Button isIconOnly size="md" variant="light" aria-label="Cancel" onPress={() => setEditingPort(null)}>
                              <X size={14} />
                            </Button>
                          </>
                        ) : (
                          <Tooltip content="Override port (sets PORT on start; clear for auto)" size="md">
                            <Button
                              isIconOnly
                              size="md"
                              variant="light"
                              aria-label="Edit port"
                              onPress={() => {
                                setEditingPort(p.projectId);
                                setPortDraft(p.overridden ? String(p.port) : "");
                              }}
                            >
                              <Pencil size={14} />
                            </Button>
                          </Tooltip>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
