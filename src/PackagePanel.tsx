import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Tooltip } from "@heroui/react";
import { Download, Pin, Play, RefreshCcw, ShieldAlert } from "lucide-react";
import type { ProjectInfo } from "./App";
import { confirmCommandAudit } from "./audit";

interface Props {
  project: ProjectInfo;
  onChanged: () => void;
  onRan: () => void;
  onError: (msg: string) => void;
}

interface AuditResult {
  supported: boolean;
  summary: Record<string, number>;
  advisories: { severity: string; package: string; title: string }[];
}

const SEVERITY_ORDER = ["critical", "high", "moderate", "low", "info"];

function runCommand(pm: string, script: string): string {
  if (pm === "npm") return `npm run ${script}`;
  if (pm === "bun") return `bun run ${script}`;
  return `${pm} ${script}`;
}

export default function PackagePanel({ project, onChanged, onRan, onError }: Props) {
  const pm = project.packageManager ?? "npm";
  const scripts = Object.entries(project.scripts);
  const isNode = ["npm", "pnpm", "yarn", "bun"].includes(pm);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [auditing, setAuditing] = useState(false);

  const call = async (cmd: string, args: Record<string, unknown>, thenLogs = true) => {
    try {
      await invoke(cmd, args);
      if (thenLogs) onRan();
    } catch (e) {
      onError(String(e));
    }
  };

  const reinstall = () => {
    if (!confirm(`Remove node_modules and run ${pm} install?\nLockfiles will not be deleted.`)) return;
    call("reinstall_dependencies", { id: project.id });
  };

  const runScript = async (script: string) => {
    const command = runCommand(pm, script);
    // The script body is what actually runs — audit it, not just the runner.
    const body = project.scripts[script] ?? "";
    if (!(await confirmCommandAudit(`${command}\n(${body})`))) return;
    call("run_project_command", { id: project.id, command });
  };

  const rawAuditCommand =
    pm === "yarn" ? "yarn audit" : pm === "pip" ? "pip-audit" : pm === "uv" ? "uv pip audit" : `${pm} audit`;

  const runAudit = async () => {
    setAuditing(true);
    setAudit(null);
    try {
      const result = await invoke<AuditResult>("run_dependency_audit", { id: project.id });
      if (result.supported) {
        setAudit(result);
      } else {
        // No structured output for this manager — stream the raw command to Logs.
        await call("run_project_command", { id: project.id, command: rawAuditCommand });
      }
    } catch (e) {
      onError(String(e));
    } finally {
      setAuditing(false);
    }
  };

  const totalVulns = audit
    ? SEVERITY_ORDER.reduce((n, s) => n + (audit.summary[s] ?? 0), 0)
    : 0;

  return (
    <div className="pkg">
      <div className="pkg-summary">
        <span className="info-key">manager</span>
        <span className="info-val">{pm}</span>
        <span className="info-key">lockfiles</span>
        <span className="info-val">{project.lockfiles.join(", ") || "none"}</span>
        {project.depsInstalled != null && (
          <>
            <span className="info-key">deps</span>
            <span className={`info-val ${project.depsInstalled ? "" : "warn-text"}`}>
              {project.depsInstalled ? "installed" : "missing"}
            </span>
          </>
        )}
      </div>

      <div className="pkg-actions">
        <Button
          size="sm"
          variant="flat"
          startContent={<Download size={14} />}
          onPress={() => call("install_dependencies", { id: project.id })}
        >
          Install
        </Button>
        {isNode && (
          <Button size="sm" variant="flat" startContent={<RefreshCcw size={14} />} onPress={reinstall}>
            Reinstall
          </Button>
        )}
        <Tooltip content={`Run ${rawAuditCommand}`} size="sm">
          <Button
            size="sm"
            variant="flat"
            isLoading={auditing}
            startContent={!auditing && <ShieldAlert size={14} />}
            onPress={runAudit}
          >
            {auditing ? "Auditing…" : "Audit"}
          </Button>
        </Tooltip>
      </div>

      {audit && (
        <div className="audit-result">
          <div className="audit-summary">
            {totalVulns === 0 ? (
              <span className="ok-text">No known vulnerabilities.</span>
            ) : (
              SEVERITY_ORDER.filter((s) => (audit.summary[s] ?? 0) > 0).map((s) => (
                <span key={s} className={`sev sev-${s}`}>
                  {s}: {audit.summary[s]}
                </span>
              ))
            )}
          </div>
          {audit.advisories.length > 0 && (
            <table className="pkg-scripts">
              <tbody>
                {audit.advisories.map((a, i) => (
                  <tr key={i}>
                    <td className={`sev sev-${a.severity}`}>{a.severity}</td>
                    <td className="pkg-script-name">{a.package}</td>
                    <td className="pkg-script-cmd">{a.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {scripts.length > 0 && (
        <table className="pkg-scripts">
          <tbody>
            {scripts.map(([name, cmd]) => (
              <tr key={name}>
                <td className="pkg-script-name">{name}</td>
                <td className="pkg-script-cmd">{cmd}</td>
                <td className="pkg-script-btns">
                  <Tooltip content={`Run ${runCommand(pm, name)}`} size="sm">
                    <Button isIconOnly size="sm" variant="light" aria-label="Run script" onPress={() => runScript(name)}>
                      <Play size={14} />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Set as start command" size="sm">
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      aria-label="Set as start command"
                      onPress={async () => {
                        await call("set_start_command", { id: project.id, command: runCommand(pm, name) }, false);
                        onChanged();
                      }}
                    >
                      <Pin size={14} />
                    </Button>
                  </Tooltip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {scripts.length === 0 && <p className="dim">No scripts in package.json.</p>}
    </div>
  );
}
