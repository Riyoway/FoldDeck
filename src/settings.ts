const KEY = "folddeck-settings";

type Settings = {
  commandAuditConfirm: boolean;
  logAutoScroll: boolean;
  uiZoom: number;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  detailHeaderHeight: number;
  fileServerDefault: "ask" | "builtin" | "python";
  terminalShell: string;
  terminalFontSize: number;
  terminalFontFamily: string;
  /** Clone destination for Git imports; empty = Documents/GitHub. */
  gitImportDir: string;
  /** UI font family; empty = built-in default. */
  uiFontFamily: string;
};

const DEFAULTS: Settings = {
  commandAuditConfirm: true,
  logAutoScroll: true,
  uiZoom: 1,
  sidebarWidth: 272,
  sidebarCollapsed: false,
  detailHeaderHeight: 0,
  fileServerDefault: "ask",
  terminalShell: "powershell.exe",
  terminalFontSize: 13,
  terminalFontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
  gitImportDir: "",
  uiFontFamily: "",
};

/** ponytail: CSS `zoom` is non-standard but WebView2 is Chromium — scales everything uniformly. */
export function applyUiZoom(): void {
  (document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = String(getSetting("uiZoom"));
}

/** Overrides the --font-ui CSS variable used across the app chrome. */
export function applyUiFont(): void {
  const f = getSetting("uiFontFamily").trim();
  if (f) document.documentElement.style.setProperty("--font-ui", f);
  else document.documentElement.style.removeProperty("--font-ui");
}

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  return load()[key];
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  localStorage.setItem(KEY, JSON.stringify({ ...load(), [key]: value }));
}
