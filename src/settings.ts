const KEY = "folddeck-settings";

type Settings = {
  commandAuditConfirm: boolean;
  logAutoScroll: boolean;
};

const DEFAULTS: Settings = {
  commandAuditConfirm: true,
  logAutoScroll: true,
};

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
