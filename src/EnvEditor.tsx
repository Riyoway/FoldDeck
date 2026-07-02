import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Eye, EyeOff, FilePlus2, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";

interface EnvEntry {
  key: string;
  value: string;
  isSecret: boolean;
}

interface Props {
  projectId: string;
  projectName: string;
  envFiles: string[];
  onClose: () => void;
  onChanged: () => void;
}

const FILE_PRIORITY = [".env", ".env.local", ".env.development", ".env.production", ".env.example", ".env.template", ".env.sample"];

const sortFiles = (files: string[]) =>
  [...files].sort((a, b) => FILE_PRIORITY.indexOf(a) - FILE_PRIORITY.indexOf(b));

export default function EnvEditor({ projectId, projectName, envFiles, onClose, onChanged }: Props) {
  const [files, setFiles] = useState(sortFiles(envFiles));
  const [activeFile, setActiveFile] = useState(sortFiles(envFiles)[0]);
  const [entries, setEntries] = useState<EnvEntry[]>([]);
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const hasExample = files.some((f) => [".env.example", ".env.template", ".env.sample"].includes(f));
  const hasEnv = files.includes(".env");

  const load = useCallback(
    async (file: string) => {
      setError(null);
      setVisible(new Set());
      setDirty(false);
      try {
        const loaded = await invoke<EnvEntry[]>("read_env_file", { id: projectId, fileName: file });
        setEntries(loaded);
        if (file === ".env" && hasExample) {
          const exampleFile = files.find((f) => [".env.example", ".env.template", ".env.sample"].includes(f))!;
          const example = await invoke<EnvEntry[]>("read_env_file", { id: projectId, fileName: exampleFile });
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
      ...missingKeys.map((k) => ({ key: k, value: "", isSecret: /TOKEN|SECRET|PASSWORD|PASS|API_KEY|PRIVATE_KEY|ACCESS_KEY|AUTH|SESSION|COOKIE|WEBHOOK|DATABASE_URL/i.test(k) })),
    ]);
    setMissingKeys([]);
    setDirty(true);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Environment</strong>
          <span className="hint">{projectName}</span>
          <button className="btn btn-ghost" onClick={onClose} style={{ marginLeft: "auto" }}>
            <X size={15} />
          </button>
        </div>

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
            <button className="btn btn-primary" onClick={createFromExample}>
              <FilePlus2 size={13} /> Create .env from example
            </button>
          )}
        </div>

        {error && (
          <div className="error-banner">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {missingKeys.length > 0 && (
          <div className="env-missing">
            <AlertTriangle size={13} /> Missing keys from example: {missingKeys.join(", ")}
            <button className="btn" onClick={addMissingKeys}>
              <Plus size={13} /> Add them
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
                  <span className="badge badge-secret">Secret</span>
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
                    {visible.has(i) ? <EyeOff size={14} /> : <Eye size={14} />}
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
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {entries.length === 0 && <p className="hint">No entries.</p>}
        </div>

        <div className="modal-foot">
          <button
            className="btn"
            onClick={() => {
              setEntries((prev) => [...prev, { key: "", value: "", isSecret: false }]);
              setDirty(true);
            }}
          >
            <Plus size={14} /> Add variable
          </button>
          <span style={{ marginLeft: "auto" }} className="hint">
            {saved ? "Saved." : dirty ? "Unsaved changes" : ""}
          </span>
          <button className="btn" onClick={() => load(activeFile)}>
            <RotateCcw size={14} /> Reload
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!dirty}>
            <Save size={14} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}
