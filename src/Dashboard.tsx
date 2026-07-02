import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Card, CardBody, Chip, Input, Tooltip } from "@heroui/react";
import { AlertTriangle, Check, ExternalLink, Pencil, Play, Square, X } from "lucide-react";
import ProjectIcon from "./ProjectIcon";
import type { ProjectInfo, ProjectStatus } from "./App";

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

  const refreshPorts = useCallback(() => {
    invoke<PortInfo[]>("get_ports_overview").then(setPorts);
  }, []);

  useEffect(refreshPorts, [refreshPorts, statuses, projects]);

  const running = projects.filter((p) => statuses[p.id]?.running);
  const warnings = projects.reduce((n, p) => n + p.warnings.length, 0);
  const portCounts = ports.reduce<Record<number, number>>((m, p) => {
    m[p.port] = (m[p.port] ?? 0) + 1;
    return m;
  }, {});

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

        <h2 className="dash-h">Projects</h2>
        {projects.length === 0 ? (
          <p className="dim dash-empty">Drop a folder anywhere to add your first project.</p>
        ) : (
          <div className="proj-grid">
            {projects.map((p) => {
              const st = statuses[p.id];
              const isRunning = !!st?.running;
              const url =
                st?.url ??
                (isRunning && p.defaultPort && p.kind === "web-app"
                  ? `http://localhost:${p.defaultPort}`
                  : null);
              const canStart =
                !!p.startCommand || p.kind === "static-site" || p.kind === "unknown";
              return (
                <div
                  key={p.id}
                  className={`proj-card ${isRunning ? "proj-card-on" : ""}`}
                  onClick={() => onSelect(p.id)}
                  onContextMenu={(e) => onProjectContextMenu(e, p)}
                >
                  <div className="proj-card-head">
                    <ProjectIcon project={p} size={16} />
                    <span className="proj-card-name">{p.name}</span>
                    {p.warnings.length > 0 && (
                      <span className="proj-warn" title={`${p.warnings.length} warning(s)`}>
                        <AlertTriangle size={12} /> {p.warnings.length}
                      </span>
                    )}
                  </div>
                  <div className="proj-card-meta">
                    {p.framework ?? p.kind}
                    {p.runtime ? ` · ${p.runtime}` : ""}
                  </div>
                  <div className="proj-card-status">
                    <span className={`st ${isRunning ? "st-on" : ""}`} />
                    {isRunning ? (
                      url ? (
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
                      )
                    ) : st?.lastExitCode != null && st.lastExitCode !== 0 ? (
                      <span className="warn-text">exited ({st.lastExitCode})</span>
                    ) : (
                      <span className="dim">
                        {p.defaultPort ? `stopped · :${p.defaultPort}` : "stopped"}
                      </span>
                    )}
                  </div>
                  <div className="proj-card-actions" onClick={(e) => e.stopPropagation()}>
                    {isRunning ? (
                      <Button
                        size="md"
                        color="danger"
                        variant="flat"
                        startContent={<Square size={14} />}
                        onPress={() => onStop(p.id)}
                      >
                        Stop
                      </Button>
                    ) : (
                      <Button
                        size="md"
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
                        size="md"
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
                  const conflict = (portCounts[p.port] ?? 0) > 1;
                  const editing = editingPort === p.projectId;
                  return (
                    <tr key={p.projectId} onClick={() => !editing && onSelect(p.projectId)}>
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
                            :{p.port}
                            {p.overridden && (
                              <Chip size="md" variant="flat" className="port-tag">
                                custom
                              </Chip>
                            )}
                          </>
                        )}
                      </td>
                      <td className="col-project">{p.projectName}</td>
                      <td className="col-status">
                        {conflict ? (
                          <span className="warn-text">conflict</span>
                        ) : p.running ? (
                          <span className="ok-text">running</span>
                        ) : p.busy ? (
                          <span className="warn-text">used by another process</span>
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
