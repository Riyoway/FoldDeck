import { invoke } from "@tauri-apps/api/core";
import { Download, Pin, Play, RefreshCcw } from "lucide-react";
import type { ProjectInfo } from "./App";

interface Props {
  project: ProjectInfo;
  onChanged: () => void;
  onRan: () => void;
  onError: (msg: string) => void;
}

function runCommand(pm: string, script: string): string {
  if (pm === "npm") return `npm run ${script}`;
  if (pm === "bun") return `bun run ${script}`;
  return `${pm} ${script}`;
}

export default function PackagePanel({ project, onChanged, onRan, onError }: Props) {
  const pm = project.packageManager ?? "npm";
  const scripts = Object.entries(project.scripts);
  const isNode = ["npm", "pnpm", "yarn", "bun"].includes(pm);

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

  const setStart = async (script: string) => {
    await call("set_start_command", { id: project.id, command: runCommand(pm, script) }, false);
    onChanged();
  };

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
        <button className="btn" onClick={() => call("install_dependencies", { id: project.id })}>
          <Download size={12} /> Install
        </button>
        {isNode && (
          <button className="btn" onClick={reinstall}>
            <RefreshCcw size={12} /> Reinstall
          </button>
        )}
      </div>

      {scripts.length > 0 && (
        <table className="pkg-scripts">
          <tbody>
            {scripts.map(([name, cmd]) => (
              <tr key={name}>
                <td className="pkg-script-name">{name}</td>
                <td className="pkg-script-cmd">{cmd}</td>
                <td className="pkg-script-btns">
                  <button
                    className="btn btn-ghost"
                    title={`Run ${runCommand(pm, name)}`}
                    onClick={() => call("run_project_command", { id: project.id, command: runCommand(pm, name) })}
                  >
                    <Play size={12} />
                  </button>
                  <button
                    className="btn btn-ghost"
                    title="Set as start command"
                    onClick={() => setStart(name)}
                  >
                    <Pin size={12} />
                  </button>
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
