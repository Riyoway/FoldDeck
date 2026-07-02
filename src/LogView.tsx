import { useMemo, type ReactNode } from "react";

// ANSI SGR foreground palette, tuned to the GitHub-dark terminal look.
const FG: Record<number, string> = {
  30: "#6e7681",
  31: "#ff7b72",
  32: "#3fb950",
  33: "#d29922",
  34: "#58a6ff",
  35: "#bc8cff",
  36: "#39c5cf",
  37: "#b1bac4",
  90: "#8b949e",
  91: "#ffa198",
  92: "#56d364",
  93: "#e3b341",
  94: "#79c0ff",
  95: "#d2a8ff",
  96: "#56d4dd",
  97: "#f0f6fc",
};

// Drop OSC (window-title) and non-color CSI (cursor moves, line clears, spinners)
// so only SGR color codes remain for the parser to turn into spans.
function clean(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[A-HJKfhlsu]/g, "")
    .replace(/\r/g, "");
}

interface Style {
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

function parseAnsi(raw: string): ReactNode[] {
  const text = clean(raw);
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([0-9;]*)m/g;
  const out: ReactNode[] = [];
  let last = 0;
  let st: Style = {};
  let key = 0;

  const emit = (s: string) => {
    if (!s) return;
    if (!st.color && !st.bold && !st.dim) {
      out.push(s);
    } else {
      out.push(
        <span
          key={key++}
          style={{
            color: st.color,
            fontWeight: st.bold ? 600 : undefined,
            opacity: st.dim ? 0.65 : undefined,
          }}
        >
          {s}
        </span>,
      );
    }
  };

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    emit(text.slice(last, m.index));
    last = re.lastIndex;
    const codes = m[1] ? m[1].split(";").map(Number) : [0];
    for (const c of codes) {
      if (c === 0) st = {};
      else if (c === 1) st = { ...st, bold: true };
      else if (c === 2) st = { ...st, dim: true };
      else if (c === 22) st = { ...st, bold: false, dim: false };
      else if (c === 39) st = { ...st, color: undefined };
      else if (FG[c]) st = { ...st, color: FG[c] };
    }
  }
  emit(text.slice(last));
  return out;
}

export default function LogView({ lines }: { lines: string[] }) {
  const nodes = useMemo(() => parseAnsi(lines.join("\n")), [lines]);
  return (
    <pre className="log-pre">
      {lines.length ? nodes : "No output yet. Press Start to run this project."}
    </pre>
  );
}
