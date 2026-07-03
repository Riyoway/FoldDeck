import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@heroui/react";
import { Check, Copy, FolderOpen, Globe, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ProjectInfo } from "./App";

interface McInfo {
  jar: string | null;
  port: number;
  lanIp: string | null;
  eulaExists: boolean;
  eulaAccepted: boolean;
  propertiesExists: boolean;
  needsFirstRun: boolean;
}

interface PropEntry {
  key: string;
  value: string;
}

interface ExposeResult {
  publicAddress: string;
  externalPort: number;
  wanIp: string;
  cgnat: boolean;
  permanent: boolean;
}

interface ExposeStatus {
  publicAddress: string;
  externalPort: number;
}

function FallbackBlock({ port }: { port: number }) {
  return (
    <div className="mc-fallback">
      <div className="mc-fallback-title">Use a tunnel instead — no router setup, and it hides your home IP.</div>
      <p className="dim">
        A tunnel like{" "}
        <a href="#" onClick={(e) => { e.preventDefault(); openUrl("https://playit.gg"); }}>
          playit.gg
        </a>{" "}
        gives players a public address that works even behind CGNAT: install it, point it at port{" "}
        {port}, and share the address it prints — friends join with unmodified Minecraft.
      </p>
    </div>
  );
}

function ExposeSection({
  projectId,
  port,
  lanIp,
  props,
}: {
  projectId: string;
  port: number;
  lanIp: string | null;
  props: PropEntry[] | null;
}) {
  const [state, setState] = useState<"idle" | "opening" | "open" | "cgnat" | "unsupported" | "error">("idle");
  const [result, setResult] = useState<ExposeResult | null>(null);
  const [addr, setAddr] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    invoke<ExposeStatus | null>("mc_expose_status", { id: projectId })
      .then((s) => {
        if (s && s.publicAddress) {
          setAddr(s.publicAddress);
          setState("open");
        }
      })
      .catch(() => {});
  }, [projectId]);

  const open = async () => {
    setState("opening");
    setErr("");
    try {
      const r = await invoke<ExposeResult>("mc_expose_open", { id: projectId });
      setResult(r);
      if (r.cgnat) {
        setState("cgnat");
      } else {
        setAddr(r.publicAddress);
        setState("open");
      }
    } catch (e) {
      const m = String(e);
      setErr(m);
      setState(m.includes("UPnP") ? "unsupported" : "error");
    }
  };

  const close = async () => {
    try {
      await invoke("mc_expose_close", { id: projectId });
    } catch {
      /* best-effort */
    }
    setState("idle");
    setResult(null);
    setAddr("");
  };

  const firewall = () => invoke("mc_add_firewall_rule", { port }).catch(() => {});

  const pv = (k: string) => props?.find((p) => p.key === k)?.value;
  const warnings: string[] = [];
  if (pv("online-mode") === "false")
    warnings.push("online-mode=false — anyone can join as any username (even an op's). Turn it back on before exposing.");
  if (pv("white-list") !== undefined && pv("white-list") !== "true")
    warnings.push("white-list is off — the whole internet can join. Set white-list=true in server.properties.");
  if (pv("enable-rcon") === "true")
    warnings.push("enable-rcon=true — never forward RCON (25575). Only the game port is opened.");

  return (
    <div className="mc-expose">
      <div className="mc-props-head">Expose to internet</div>

      {warnings.length > 0 && (
        <ul className="mc-warn-list">
          {warnings.map((w, i) => (
            <li key={i} className="warn-text">{w}</li>
          ))}
        </ul>
      )}

      {state === "idle" && (
        <>
          <p className="dim">
            Opens port {port} on your router via UPnP so friends outside your network can join. Your
            public IP becomes visible to players.
          </p>
          <div className="mc-actions">
            <Button color="primary" startContent={<Globe size={15} />} onPress={open}>
              Expose to internet
            </Button>
          </div>
        </>
      )}

      {state === "opening" && (
        <div className="mc-actions">
          <Button color="primary" isLoading>Opening port {port}…</Button>
        </div>
      )}

      {state === "open" && (
        <>
          <p className="ok-text">
            <ShieldCheck size={15} style={{ verticalAlign: "-2px" }} /> Open — internet players can join.
          </p>
          <ConnectAddress label="internet players" addr={addr} />
          <ConnectAddress label="LAN players" addr={`${lanIp ?? "your-lan-ip"}:${port}`} />
          <p className="dim mc-note">
            Testing this public address from your own network may fail (router hairpin) even when
            outside players connect fine — ask a friend to test.
          </p>
          {result?.permanent && (
            <p className="dim mc-note">
              This router only supports permanent mappings; it's removed when you stop exposing or
              quit FoldDeck.
            </p>
          )}
          <div className="mc-actions">
            <Button variant="flat" startContent={<ShieldAlert size={15} />} onPress={firewall}>
              Allow in Windows Firewall
            </Button>
            <Button variant="flat" color="danger" onPress={close}>
              Stop exposing
            </Button>
          </div>
          <p className="dim mc-note">
            Forwarding the router port isn't always enough — Windows must also allow it inbound
            (approve Java's prompt, or click the button above).
          </p>
        </>
      )}

      {state === "cgnat" && (
        <>
          <p className="warn-text">
            <ShieldAlert size={15} style={{ verticalAlign: "-2px" }} /> Your router is behind
            carrier-grade NAT (WAN IP {result?.wanIp}), so port forwarding can't make this server
            reachable.
          </p>
          <FallbackBlock port={port} />
          <div className="mc-actions">
            <Button variant="flat" onPress={() => setState("idle")}>Back</Button>
          </div>
        </>
      )}

      {state === "unsupported" && (
        <>
          <p className="warn-text">Automatic port setup unavailable — UPnP is off or unsupported on your router.</p>
          <div className="info-table mc-manual">
            <div className="info-row"><span className="info-key">protocol</span><span className="info-val">TCP</span></div>
            <div className="info-row"><span className="info-key">port (ext + int)</span><span className="info-val">{port}</span></div>
            <div className="info-row"><span className="info-key">internal IP</span><span className="info-val">{lanIp ?? "your-lan-ip"}</span></div>
          </div>
          <p className="dim mc-note">Forward this in your router's admin page, or:</p>
          <FallbackBlock port={port} />
          <div className="mc-actions">
            <Button variant="flat" onPress={open}>Try UPnP again</Button>
          </div>
        </>
      )}

      {state === "error" && (
        <>
          <p className="warn-text">{err}</p>
          <div className="mc-actions">
            <Button variant="flat" onPress={open}>Try again</Button>
          </div>
        </>
      )}
    </div>
  );
}

const MEM_PRESETS = ["1G", "2G", "4G", "6G", "8G"];

function ConnectAddress({ label, addr }: { label: string; addr: string }) {
  return (
    <div className="info-row">
      <span className="info-key">{label}</span>
      <span className="info-val mc-addr">
        <code className="inline-code">{addr}</code>
        <button className="mc-copy" title="Copy" onClick={() => navigator.clipboard.writeText(addr)}>
          <Copy size={12} />
        </button>
      </span>
    </div>
  );
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
  const [props, setProps] = useState<PropEntry[] | null>(null);

  const load = useCallback(() => {
    invoke<McInfo>("get_minecraft_info", { id: project.id })
      .then(setInfo)
      .catch((e) => setError(String(e)));
  }, [project.id]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!info?.propertiesExists) return;
    invoke<PropEntry[]>("read_minecraft_properties", { id: project.id })
      .then(setProps)
      .catch(() => setProps(null));
  }, [info?.propertiesExists, project.id]);

  const mem = project.startCommand?.match(/-Xmx(\S+)/)?.[1] ?? "2G";

  const applyMemory = async (m: string) => {
    const jar = info?.jar ?? "server.jar";
    const cur = project.startCommand ?? `java -Xmx2G -jar "${jar}" nogui`;
    let c = /-Xmx\S+/.test(cur) ? cur.replace(/-Xmx\S+/, `-Xmx${m}`) : cur.replace(/\bjava\b/, `java -Xmx${m}`);
    c = /-Xms\S+/.test(c) ? c.replace(/-Xms\S+/, `-Xms${m}`) : c.replace(/-Xmx\S+/, (x) => `${x} -Xms${m}`);
    await invoke("set_start_command", { id: project.id, command: c });
    onChanged();
  };

  const saveProp = (key: string, value: string) =>
    invoke("set_minecraft_property", { id: project.id, key, value }).catch(() => {});

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
      <ConnectAddress label="connect (this PC)" addr={`localhost:${info.port}`} />
      {info.lanIp && <ConnectAddress label="connect (LAN)" addr={`${info.lanIp}:${info.port}`} />}
      <div className="info-row">
        <span className="info-key">EULA</span>
        <span className={`info-val ${info.eulaAccepted ? "ok-text" : "warn-text"}`}>
          {info.eulaAccepted ? "accepted" : info.eulaExists ? "not accepted" : "not generated yet"}
        </span>
      </div>

      {info.jar && (
        <div className="info-row">
          <span className="info-key">memory (RAM)</span>
          <span className="info-val mc-mem">
            {MEM_PRESETS.map((m) => (
              <button
                key={m}
                className={`dash-filter ${mem === m ? "dash-filter-on" : ""}`}
                onClick={() => applyMemory(m)}
              >
                {m}
              </button>
            ))}
            <input
              className="mc-mem-input"
              defaultValue={mem}
              key={mem}
              spellCheck={false}
              title="Custom (e.g. 3G, 512M)"
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== mem && applyMemory(e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </span>
        </div>
      )}

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
              <Button color="primary" startContent={<ShieldCheck size={15} />} onPress={acceptEula}>
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
          <p className="ok-text">
            <Check size={15} style={{ verticalAlign: "-2px" }} /> EULA accepted — ready to start.
          </p>
        )}
      </div>

      {info.jar && info.eulaAccepted && (
        <ExposeSection projectId={project.id} port={info.port} lanIp={info.lanIp} props={props} />
      )}

      {props && props.length > 0 && (
        <div className="mc-props-section">
          <div className="mc-props-head">server.properties</div>
          <div className="mc-props">
            {props.map((p) => (
              <label key={p.key} className="mc-prop">
                <span className="mc-prop-key" title={p.key}>{p.key}</span>
                <input
                  className="mc-prop-val"
                  defaultValue={p.value}
                  spellCheck={false}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v !== p.value) {
                      p.value = v;
                      saveProp(p.key, v);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
              </label>
            ))}
          </div>
          <p className="dim mc-props-note">Restart the server to apply changes.</p>
        </div>
      )}
    </div>
  );
}
