import { Boxes, Folder, Globe, Server, Terminal } from "lucide-react";
import { siDiscord, siDocker, siNodedotjs, siPython } from "simple-icons";
import type { ProjectInfo } from "./App";

function Brand({ path, hex, size }: { path: string; hex: string; size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={`#${hex}`}
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d={path} />
    </svg>
  );
}

/** Simple pixel grass block — simple-icons has no Minecraft mark. */
function MinecraftIcon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="3" y="4" width="18" height="6" rx="1" fill="#6cc349" />
      <rect x="3" y="10" width="18" height="10" rx="1" fill="#966c4a" />
      <rect x="6" y="12" width="3" height="3" fill="#7d5a3c" />
      <rect x="15" y="14" width="3" height="3" fill="#7d5a3c" />
      <rect x="10" y="6" width="3" height="2" fill="#5aa93c" />
    </svg>
  );
}

export default function ProjectIcon({ project, size = 15 }: { project: ProjectInfo; size?: number }) {
  if (project.iconDataUri) {
    return (
      <img
        src={project.iconDataUri}
        width={size}
        height={size}
        alt=""
        style={{ flexShrink: 0, borderRadius: 3, objectFit: "contain" }}
      />
    );
  }
  if (project.subtype === "discord") return <Brand path={siDiscord.path} hex={siDiscord.hex} size={size} />;
  if (project.subtype === "minecraft") return <MinecraftIcon size={size} />;
  if (project.kind === "docker-compose") return <Brand path={siDocker.path} hex={siDocker.hex} size={size} />;
  if (project.kind === "worker" || project.kind === "bot") {
    if (project.runtime === "python") return <Brand path={siPython.path} hex={siPython.hex} size={size} />;
    if (project.runtime === "node") return <Brand path={siNodedotjs.path} hex={siNodedotjs.hex} size={size} />;
    return <Terminal size={size} style={{ flexShrink: 0 }} aria-hidden="true" />;
  }
  if (project.kind === "web-app" || project.kind === "static-site") {
    return <Globe size={size} color="#58a6ff" style={{ flexShrink: 0 }} aria-hidden="true" />;
  }
  if (project.kind === "backend-server") {
    return <Server size={size} color="#58a6ff" style={{ flexShrink: 0 }} aria-hidden="true" />;
  }
  if (project.kind === "game-server") {
    return <Boxes size={size} style={{ flexShrink: 0 }} aria-hidden="true" />;
  }
  return <Folder size={size} color="#8b949e" style={{ flexShrink: 0 }} aria-hidden="true" />;
}
