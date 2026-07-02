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
};

const DEFAULTS: Settings = {
  commandAuditConfirm: true,
  logAutoScroll: true,
  uiZoom: 1,
  sidebarWidth: 288,
  sidebarCollapsed: false,
  detailHeaderHeight: 0,
  fileServerDefault: "ask",
  terminalShell: "powershell.exe",
  terminalFontSize: 13,
  terminalFontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
};

/** ponytail: CSS `zoom` is non-standard but WebView2 is Chromium — scales everything uniformly. */
export function applyUiZoom(): void {
  (document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = String(getSetting("uiZoom"));
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
