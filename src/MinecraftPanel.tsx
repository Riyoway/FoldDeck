import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@heroui/react";
import { Check, FolderOpen, ShieldCheck } from "lucide-react";
import type { ProjectInfo } from "./App";

interface McInfo {
  jar: string | null;
  port: number;
  eulaExists: boolean;
  eulaAccepted: boolean;
  propertiesExists: boolean;
  needsFirstRun: boolean;
}

export default function MinecraftPanel({
  project,
  onStart,
  onChanged,
}: {
  project: ProjectInfo;
  onStart: () => void;
  onChanged: () => void;
}) {
  const [info, setInfo] = useState<McInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    invoke<McInfo>("get_minecraft_info", { id: project.id })
      .then(setInfo)
      .catch((e) => setError(String(e)));
  }, [project.id]);

  useEffect(load, [load]);

  const acceptEula = async () => {
    setError(null);
    try {
      await invoke("accept_minecraft_eula", { id: project.id });
      load();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  if (error) return <div className="info-table">{error}</div>;
  if (!info) return <div className="info-table dim">Loading…</div>;

  return (
    <div className="info-table">
      <div className="info-row">
        <span className="info-key">server jar</span>
        <span className="info-val">{info.jar ?? "none — add a server .jar to this folder"}</span>
      </div>
      <div className="info-row">
        <span className="info-key">port</span>
        <span className="info-val">{info.port}</span>
      </div>
      <div className="info-row">
        <span className="info-key">config generated</span>
        <span className="info-val">{info.propertiesExists ? "yes (server.properties)" : "no"}</span>
      </div>
      <div className="info-row">
        <span className="info-key">EULA</span>
        <span className={`info-val ${info.eulaAccepted ? "ok-text" : "warn-text"}`}>
          {info.eulaAccepted ? "accepted" : info.eulaExists ? "not accepted" : "not generated yet"}
        </span>
      </div>

      <div className="mc-setup">
        {info.jar == null ? (
          <p className="dim">
            Drop a server jar (paper.jar, server.jar, …) into the project folder, then reopen this
            tab.
          </p>
        ) : info.needsFirstRun ? (
          <>
            <p>
              First run generates <code className="inline-code">server.properties</code> and{" "}
              <code className="inline-code">eula.txt</code>. Start the server once, then accept the
              EULA and start it again.
            </p>
            <div className="mc-actions">
              <Button color="primary" onPress={onStart}>
                Run setup (first start)
              </Button>
            </div>
          </>
        ) : !info.eulaAccepted ? (
          <>
            <p>
              To run a Minecraft server you must agree to the{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); openUrl("https://aka.ms/MinecraftEULA"); }}>
                Minecraft EULA
              </a>
              . Clicking accept writes <code className="inline-code">eula=true</code> on your behalf.
            </p>
            <div className="mc-actions">
              <Button
                color="primary"
                startContent={<ShieldCheck size={15} />}
                onPress={acceptEula}
              >
                Accept EULA
              </Button>
              <Button
                variant="flat"
                startContent={<FolderOpen size={15} />}
                onPress={() => invoke("open_folder", { path: project.path })}
              >
                Open folder
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="ok-text">
              <Check size={15} style={{ verticalAlign: "-2px" }} /> EULA accepted — ready to start.
            </p>
            <div className="mc-actions">
              <Button color="primary" onPress={onStart}>
                Start server
              </Button>
              <Button
                variant="flat"
                startContent={<FolderOpen size={15} />}
                onPress={() => invoke("open_folder", { path: project.path })}
              >
                Open folder
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
