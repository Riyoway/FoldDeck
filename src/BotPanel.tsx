import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@heroui/react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { ProjectInfo, ProjectStatus } from "./App";

interface EnvEntry {
  key: string;
  value: string;
  isSecret: boolean;
}

interface Props {
  project: ProjectInfo;
  status?: ProjectStatus;
  logs: string[];
}

const READY_RE = /\b(ready|logged in|connected|online)\b|on_ready/i;
const CLIENT_ID_KEYS = ["CLIENT_ID", "DISCORD_CLIENT_ID", "APPLICATION_ID", "APP_ID"];

function fmtTime(secs?: number | null): string {
  if (!secs) return "-";
  return new Date(secs * 1000).toLocaleString();
}

export default function BotPanel({ project, status, logs }: Props) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!project.envFiles.includes(".env")) return;
    invoke<EnvEntry[]>("read_env_file", { id: project.id, fileName: ".env" })
      .then((entries) => {
        const hit = entries.find((e) => CLIENT_ID_KEYS.includes(e.key.toUpperCase()) && /^\d{15,21}$/.test(e.value));
        setClientId(hit?.value ?? null);
      })
      .catch(() => setClientId(null));
  }, [project.id, project.envFiles]);

  const running = !!status?.running;
  const startedAt = status?.startedAt ?? 0;
  // Once a "ready" line is seen this run, stay online, the ready line scrolls
  // out of the log buffer, so re-checking the current buffer would wrongly
  // flip an online bot back to "connecting…".
  const [readySeen, setReadySeen] = useState(false);
  useEffect(() => {
    setReadySeen(false); // new run (start/restart) → re-detect
  }, [startedAt]);
  useEffect(() => {
    if (running && !readySeen && logs.some((l) => READY_RE.test(l))) setReadySeen(true);
  }, [running, logs, readySeen]);

  // Fallback: a bot that has been up a while (e.g. the ready line was already
  // gone when the panel opened) is almost certainly connected.
  const uptime = startedAt ? Math.floor(Date.now() / 1000) - startedAt : 0;
  const connection = !running ? "offline" : readySeen || uptime > 15 ? "online" : "connecting…";

  const inviteUrl = clientId
    ? `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=0&scope=bot%20applications.commands`
    : null;

  const copyInvite = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="info-table">
      <div className="info-row">
        <span className="info-key">connection</span>
        <span className={`info-val ${connection === "online" ? "ok-text" : "dim"}`}>{connection}</span>
      </div>
      <div className="info-row">
        <span className="info-key">runtime</span>
        <span className="info-val">{project.runtime ?? "-"}</span>
      </div>
      <div className="info-row">
        <span className="info-key">framework</span>
        <span className="info-val">{project.framework ?? "-"}</span>
      </div>
      <div className="info-row">
        <span className="info-key">last started</span>
        <span className="info-val">{fmtTime(status?.startedAt)}</span>
      </div>
      <div className="info-row">
        <span className="info-key">last stopped</span>
        <span className="info-val">{fmtTime(status?.lastStoppedAt)}</span>
      </div>
      <div className="info-row">
        <span className="info-key">crashes</span>
        <span className="info-val">{status?.crashCount ?? 0}</span>
      </div>
      <div className="info-row">
        <span className="info-key">client id</span>
        <span className="info-val">{clientId ?? "not found in .env"}</span>
      </div>
      <div className="bot-actions">
        <Button
          size="md"
          variant="flat"
          startContent={<ExternalLink size={14} />}
          onPress={() => openUrl("https://discord.com/developers/applications")}
        >
          Developer Portal
        </Button>
        <Button
          size="md"
          variant="flat"
          isDisabled={!inviteUrl}
          startContent={copied ? <Check size={14} /> : <Copy size={14} />}
          onPress={copyInvite}
        >
          {copied ? "Copied" : "Copy Invite URL"}
        </Button>
      </div>
    </div>
  );
}
