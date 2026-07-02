import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
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
}

export default function Dashboard({ projects, statuses, onSelect, onStart, onStop, onChanged }: Props) {
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
    <div className="dashboard">
      <div className="dash-inner">
        <div className="stats">
          {stats.map(([label, value, cls]) => (
            <div className="stat" key={label}>
              <div className={`stat-num ${cls}`}>{value}</div>
              <div className="stat-label">{label}</div>
            </div>
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
                >
                  <div className="proj-card-head">
                    <ProjectIcon project={p} size={17} />
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
                      <button className="btn btn-danger" onClick={() => onStop(p.id)}>
                        <Square size={12} /> Stop
                      </button>
                    ) : (
                      <button
                        className="btn btn-ok"
                        disabled={!canStart}
                        title={canStart ? undefined : "No start command detected"}
                        onClick={() => onStart(p)}
                      >
                        <Play size={12} /> Start
                      </button>
                    )}
                    {url && (
                      <button className="btn" onClick={() => openUrl(url)}>
                        <ExternalLink size={12} /> Open
                      </button>
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
                            <input
                              className="port-input"
                              value={portDraft}
                              autoFocus
                              placeholder="auto"
                              onChange={(e) => setPortDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") savePort(p.projectId);
                                if (e.key === "Escape") setEditingPort(null);
                              }}
                            />
                          </span>
                        ) : (
                          <>
                            :{p.port}
                            {p.overridden && <span className="tag tag-dim port-tag">custom</span>}
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
                            <button className="btn btn-ghost" title="Save" onClick={() => savePort(p.projectId)}>
                              <Check size={13} />
                            </button>
                            <button className="btn btn-ghost" title="Cancel" onClick={() => setEditingPort(null)}>
                              <X size={13} />
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn btn-ghost"
                            title="Override port (sets PORT on start; clear for auto)"
                            onClick={() => {
                              setEditingPort(p.projectId);
                              setPortDraft(p.overridden ? String(p.port) : "");
                            }}
                          >
                            <Pencil size={13} />
                          </button>
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
