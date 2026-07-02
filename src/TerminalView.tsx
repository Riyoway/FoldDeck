import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const THEME = {
  background: "#050506",
  foreground: "#e6e6e6",
  cursor: "#e6e6e6",
  cursorAccent: "#050506",
  selectionBackground: "rgba(255,255,255,0.18)",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
};

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default function TerminalView({ projectId, cwd }: { projectId: string; cwd: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      theme: THEME,
      cursorBlink: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const encoder = new TextEncoder();
    term.onData((data) => {
      invoke("terminal_input", { id: projectId, data: Array.from(encoder.encode(data)) });
    });

    const unlistenOutput = listen<{ id: string; data: string }>("terminal-output", (e) => {
      if (e.payload.id === projectId) term.write(b64ToBytes(e.payload.data));
    });
    const unlistenExit = listen<{ id: string }>("terminal-exit", (e) => {
      if (e.payload.id === projectId) term.write("\r\n\x1b[90m[shell exited]\x1b[0m\r\n");
    });

    invoke("terminal_open", { id: projectId, cwd, cols: term.cols, rows: term.rows });

    const doFit = () => {
      fit.fit();
      invoke("terminal_resize", { id: projectId, cols: term.cols, rows: term.rows });
    };
    const ro = new ResizeObserver(doFit);
    ro.observe(el);
    term.focus();

    return () => {
      ro.disconnect();
      unlistenOutput.then((f) => f());
      unlistenExit.then((f) => f());
      term.dispose();
      // The PTY is kept alive so the session survives tab switches.
    };
  }, [projectId, cwd]);

  return <div className="term-host" ref={hostRef} />;
}
