import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Eye, EyeOff, FilePlus2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";

interface EnvEntry {
  key: string;
  value: string;
  isSecret: boolean;
}

interface Props {
  projectId: string;
  envFiles: string[];
  onChanged: () => void;
}

const FILE_PRIORITY = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.example",
  ".env.template",
  ".env.sample",
];
const EXAMPLE_FILES = [".env.example", ".env.template", ".env.sample"];
const SECRET_RE =
  /TOKEN|SECRET|PASSWORD|PASS|API_KEY|PRIVATE_KEY|ACCESS_KEY|AUTH|SESSION|COOKIE|WEBHOOK|DATABASE_URL/i;

const sortFiles = (files: string[]) =>
  [...files].sort((a, b) => FILE_PRIORITY.indexOf(a) - FILE_PRIORITY.indexOf(b));

export default function EnvEditor({ projectId, envFiles, onChanged }: Props) {
  const [files, setFiles] = useState(sortFiles(envFiles));
  const [activeFile, setActiveFile] = useState(sortFiles(envFiles)[0]);
  const [entries, setEntries] = useState<EnvEntry[]>([]);
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const hasExample = files.some((f) => EXAMPLE_FILES.includes(f));
  const hasEnv = files.includes(".env");

  const load = useCallback(
    async (file: string) => {
      setError(null);
      setVisible(new Set());
      setDirty(false);
      setSaved(false);
      try {
        const loaded = await invoke<EnvEntry[]>("read_env_file", { id: projectId, fileName: file });
        setEntries(loaded);
        if (file === ".env" && hasExample) {
          const exampleFile = files.find((f) => EXAMPLE_FILES.includes(f))!;
          const example = await invoke<EnvEntry[]>("read_env_file", {
            id: projectId,
            fileName: exampleFile,
          });
          setMissingKeys(example.map((e) => e.key).filter((k) => !loaded.some((e) => e.key === k)));
        } else {
          setMissingKeys([]);
        }
      } catch (e) {
        setError(String(e));
        setEntries([]);
      }
    },
    [projectId, files, hasExample],
  );

  useEffect(() => {
    if (activeFile) load(activeFile);
  }, [activeFile, load]);

  const update = (i: number, patch: Partial<EnvEntry>) => {
    setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, ...patch } : e)));
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    setError(null);
    try {
      await invoke("save_env_file", { id: projectId, fileName: activeFile, entries });
      setDirty(false);
      setSaved(true);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const createFromExample = async () => {
    setError(null);
    try {
      await invoke("create_env_from_example", { id: projectId });
      const updated = sortFiles([...files, ".env"]);
      setFiles(updated);
      setActiveFile(".env");
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const addMissingKeys = () => {
    setEntries((prev) => [
      ...prev,
      ...missingKeys.map((k) => ({ key: k, value: "", isSecret: SECRET_RE.test(k) })),
    ]);
    setMissingKeys([]);
    setDirty(true);
  };

  return (
    <div className="env-editor">
      <div className="env-tabs">
        {files.map((f) => (
          <button
            key={f}
            className={`env-tab ${f === activeFile ? "env-tab-active" : ""}`}
            onClick={() => setActiveFile(f)}
          >
            {f}
          </button>
        ))}
        {!hasEnv && hasExample && (
          <button className="btn" onClick={createFromExample}>
            <FilePlus2 size={12} /> Create .env from example
          </button>
        )}
      </div>

      {error && <div className="error-bar">{error}</div>}

      {(() => {
        const keys = entries.map((e) => e.key.trim());
        const dupes = [...new Set(keys.filter((k, i) => k && keys.indexOf(k) !== i))];
        const issues = [
          dupes.length ? `duplicate keys: ${dupes.join(", ")}` : null,
          keys.some((k, i) => !k && entries[i].value) ? "entry with empty key" : null,
          entries.some((e) => e.value.includes("\n")) ? "value contains a newline" : null,
        ].filter(Boolean);
        return issues.length > 0 ? <div className="env-missing">⚠ {issues.join(" · ")}</div> : null;
      })()}

      {missingKeys.length > 0 && (
        <div className="env-missing">
          ⚠ Missing keys from example: {missingKeys.join(", ")}
          <button className="btn" onClick={addMissingKeys}>
            <Plus size={12} /> Add them
          </button>
        </div>
      )}

      <div className="env-rows">
        {entries.map((e, i) => (
          <div className="env-row" key={i}>
            <input
              className="env-key"
              value={e.key}
              onChange={(ev) => update(i, { key: ev.target.value })}
              placeholder="KEY"
              spellCheck={false}
            />
            <input
              className="env-value"
              type={e.isSecret && !visible.has(i) ? "password" : "text"}
              value={e.value}
              onChange={(ev) => update(i, { value: ev.target.value })}
              placeholder="value"
              spellCheck={false}
            />
            {e.isSecret && (
              <>
                <span className="tag tag-warn">secret</span>
                <button
                  className="btn btn-ghost"
                  onClick={() =>
                    setVisible((prev) => {
                      const next = new Set(prev);
                      next.has(i) ? next.delete(i) : next.add(i);
                      return next;
                    })
                  }
                >
                  {visible.has(i) ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </>
            )}
            <button
              className="btn btn-ghost"
              onClick={() => {
                setEntries((prev) => prev.filter((_, j) => j !== i));
                setDirty(true);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {entries.length === 0 && <p className="dim">No entries.</p>}
      </div>

      <div className="env-foot">
        <button
          className="btn"
          onClick={() => {
            setEntries((prev) => [...prev, { key: "", value: "", isSecret: false }]);
            setDirty(true);
          }}
        >
          <Plus size={12} /> Add variable
        </button>
        <span className="dim" style={{ marginLeft: "auto" }}>
          {saved ? "saved" : dirty ? "unsaved changes" : ""}
        </span>
        <button className="btn" onClick={() => load(activeFile)}>
          <RotateCcw size={12} /> Reload
        </button>
        <button className="btn btn-ok" onClick={save} disabled={!dirty}>
          <Save size={12} /> Save
        </button>
      </div>
    </div>
  );
}
