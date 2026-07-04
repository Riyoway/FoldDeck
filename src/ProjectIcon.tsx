import { AppWindow, Boxes, Folder, Globe, Server, Terminal } from "lucide-react";
import {
  siAdonisjs,
  siAngular,
  siAstro,
  siBun,
  siDeno,
  siDiscord,
  siDjango,
  siDocker,
  siDocusaurus,
  siDotnet,
  siElectron,
  siEleventy,
  siExpress,
  siFastapi,
  siFastify,
  siFlask,
  siFresh,
  siGatsby,
  siGo,
  siGradio,
  siHono,
  siJupyter,
  siKoa,
  siKotlin,
  siLaravel,
  siMedusa,
  siNestjs,
  siNextdotjs,
  siNodedotjs,
  siNuxt,
  siPhp,
  siPython,
  siQuarkus,
  siQwik,
  siReact,
  siRemix,
  siRuby,
  siRubyonrails,
  siRust,
  siSolid,
  siSpringboot,
  siStrapi,
  siStreamlit,
  siSvelte,
  siSymfony,
  siTauri,
  siVite,
  siVuedotjs,
  siWails,
  type SimpleIcon,
} from "simple-icons";
import type { ProjectInfo } from "./App";

// The framework name detect.rs assigns → its official brand icon.
const FRAMEWORK_BRAND: Record<string, SimpleIcon> = {
  "Next.js": siNextdotjs,
  Nuxt: siNuxt,
  Angular: siAngular,
  "Vue CLI": siVuedotjs,
  Gatsby: siGatsby,
  Docusaurus: siDocusaurus,
  VitePress: siVite,
  Eleventy: siEleventy,
  Qwik: siQwik,
  SolidStart: siSolid,
  Remix: siRemix,
  Astro: siAstro,
  SvelteKit: siSvelte,
  Vite: siVite,
  "Create React App": siReact,
  NestJS: siNestjs,
  AdonisJS: siAdonisjs,
  Strapi: siStrapi,
  Medusa: siMedusa,
  Express: siExpress,
  Fastify: siFastify,
  Koa: siKoa,
  Hono: siHono,
  Elysia: siBun, // Bun-based; no dedicated mark
  Laravel: siLaravel,
  Symfony: siSymfony,
  PHP: siPhp,
  "Ruby on Rails": siRubyonrails,
  "Spring Boot": siSpringboot,
  Quarkus: siQuarkus,
  Ktor: siKotlin,
  "ASP.NET Core": siDotnet,
  ".NET": siDotnet,
  Deno: siDeno,
  Fresh: siFresh,
  Streamlit: siStreamlit,
  Gradio: siGradio,
  Jupyter: siJupyter,
  FastAPI: siFastapi,
  Uvicorn: siFastapi,
  Django: siDjango,
  Flask: siFlask,
  Tauri: siTauri,
  Electron: siElectron,
  "electron-vite": siElectron,
  "Electron Forge": siElectron,
  Wails: siWails,
};

// Language icon for backends/workers/bots without a framework-specific brand.
const RUNTIME_BRAND: Record<string, SimpleIcon> = {
  python: siPython,
  node: siNodedotjs,
  go: siGo,
  rust: siRust,
  php: siPhp,
  ruby: siRuby,
  deno: siDeno,
};

/** Keep dark brand marks (Next.js, Rust, Express… all #000) visible on the
 *  dark theme by lightening anything with low luminance. */
function brandColor(hex: string): string {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.42 ? "#cdd3da" : `#${hex}`;
}

function Brand({ icon, size }: { icon: SimpleIcon; size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={brandColor(icon.hex)}
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d={icon.path} />
    </svg>
  );
}

/** Minecraft has no brand mark (trademark), a tidy grass block stands in. */
function MinecraftIcon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" fill="#8a6a48" />
      <rect x="3" y="4" width="18" height="6" rx="1.5" fill="#6cbf3f" />
      <rect x="3" y="9" width="18" height="2" fill="#54a034" />
      <rect x="6.2" y="13" width="2.4" height="2.4" fill="#6f533a" />
      <rect x="12" y="15" width="2.4" height="2.4" fill="#6f533a" />
      <rect x="15.4" y="12.2" width="2.4" height="2.4" fill="#6f533a" />
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
  if (project.subtype === "discord") return <Brand icon={siDiscord} size={size} />;
  if (project.subtype === "minecraft") return <MinecraftIcon size={size} />;
  if (project.kind === "docker-compose") return <Brand icon={siDocker} size={size} />;

  const fw = project.framework ? FRAMEWORK_BRAND[project.framework] : undefined;
  if (fw) return <Brand icon={fw} size={size} />;

  const rt = project.runtime ? RUNTIME_BRAND[project.runtime] : undefined;
  if (rt && (project.kind === "backend-server" || project.kind === "worker" || project.kind === "bot")) {
    return <Brand icon={rt} size={size} />;
  }

  const style = { flexShrink: 0 } as const;
  switch (project.kind) {
    case "web-app":
    case "static-site":
      return <Globe size={size} color="#58a6ff" style={style} aria-hidden="true" />;
    case "backend-server":
      return <Server size={size} color="#58a6ff" style={style} aria-hidden="true" />;
    case "desktop-app":
      return <AppWindow size={size} color="#58a6ff" style={style} aria-hidden="true" />;
    case "game-server":
      return <Boxes size={size} style={style} aria-hidden="true" />;
    case "bot":
    case "worker":
      return <Terminal size={size} style={style} aria-hidden="true" />;
    default:
      return <Folder size={size} color="#8b949e" style={style} aria-hidden="true" />;
  }
}
