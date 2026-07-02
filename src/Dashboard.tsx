import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Pencil, Play, Square, X } from "lucide-react";
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

  return (
    <div className="dashboard">
      <div className="stats">
        <div className="stat">
          <div className="stat-num">{projects.length}</div>
          <div className="stat-label">projects</div>
        </div>
        <div className="stat">
          <div className={`stat-num ${running.length ? "ok-text" : ""}`}>{running.length}</div>
          <div className="stat-label">running</div>
        </div>
        <div className="stat">
          <div className={`stat-num ${warnings ? "warn-text" : ""}`}>{warnings}</div>
          <div className="stat-label">warnings</div>
        </div>
        <div className="stat">
          <div className="stat-num">{ports.filter((p) => p.busy).length}</div>
          <div className="stat-label">ports in use</div>
        </div>
      </div>

      <h2 className="dash-h">Projects</h2>
      {projects.length === 0 ? (
        <p className="dim">Drop a folder anywhere to add your first project.</p>
      ) : (
        <table className="dash-table">
          <tbody>
            {projects.map((p) => {
              const st = statuses[p.id];
              const isRunning = !!st?.running;
              return (
                <tr key={p.id} className="dash-row" onClick={() => onSelect(p.id)}>
                  <td className="dash-st">
                    <span className={`st ${isRunning ? "st-on" : ""}`} />
                  </td>
                  <td className="dash-name">
                    <span className="dash-name-inner">
                      <ProjectIcon project={p} size={14} />
                      {p.name}
                    </span>
                  </td>
                  <td className="dash-fw dim">{p.framework ?? p.kind}</td>
                  <td className="dash-url">
                    {isRunning && st?.url ? (
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openUrl(st.url!);
                        }}
                      >
                        {st.url.replace(/^https?:\/\//, "")}
                      </a>
                    ) : p.defaultPort ? (
                      <span className="dim">:{p.defaultPort}</span>
                    ) : null}
                  </td>
                  <td className="dash-warn">
                    {p.warnings.length > 0 && <span className="row-warn">{p.warnings.length}</span>}
                  </td>
                  <td className="dash-actions" onClick={(e) => e.stopPropagation()}>
                    {isRunning ? (
                      <button className="btn btn-ghost" title="Stop" onClick={() => onStop(p.id)}>
                        <Square size={12} />
                      </button>
                    ) : (
                      <button
                        className="btn btn-ghost"
                        title={
                          p.startCommand ??
                          (p.kind === "static-site" || p.kind === "unknown"
                            ? "Serve"
                            : "No start command")
                        }
                        disabled={!p.startCommand && p.kind !== "static-site" && p.kind !== "unknown"}
                        onClick={() => onStart(p)}
                      >
                        <Play size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {ports.length > 0 && (
        <>
          <h2 className="dash-h">Ports</h2>
          <table className="dash-table">
            <tbody>
              {ports.map((p) => {
                const conflict = (portCounts[p.port] ?? 0) > 1;
                const editing = editingPort === p.projectId;
                return (
                  <tr key={p.projectId} className="dash-row" onClick={() => !editing && onSelect(p.projectId)}>
                    <td className="dash-port">
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
                    <td className="dash-name">{p.projectName}</td>
                    <td>
                      {conflict ? (
                        <span className="warn-text">conflict</span>
                      ) : p.running ? (
                        <span className="ok-text">running</span>
                      ) : p.busy ? (
                        <span className="warn-text">in use by another process</span>
                      ) : (
                        <span className="dim">free</span>
                      )}
                    </td>
                    <td className="dash-actions" onClick={(e) => e.stopPropagation()}>
                      {editing ? (
                        <>
                          <button className="btn btn-ghost" title="Save" onClick={() => savePort(p.projectId)}>
                            <Check size={12} />
                          </button>
                          <button className="btn btn-ghost" title="Cancel" onClick={() => setEditingPort(null)}>
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn-ghost"
                          title="Override port (sets PORT env var on start; clear for auto)"
                          onClick={() => {
                            setEditingPort(p.projectId);
                            setPortDraft(p.overridden ? String(p.port) : "");
                          }}
                        >
                          <Pencil size={12} />
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
  );
}
