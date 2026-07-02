import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@heroui/react";
import { RotateCcw } from "lucide-react";

interface DoctorReport {
  errors: string[];
  warnings: string[];
}

export default function DoctorPanel({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setError(null);
    try {
      setReport(await invoke<DoctorReport>("run_doctor", { id: projectId }));
    } catch (e) {
      setError(String(e));
    }
  }, [projectId]);

  useEffect(() => {
    run();
  }, [run]);

  if (error) return <div className="doctor">{error}</div>;
  if (!report) return <div className="doctor dim">Running checks…</div>;

  const clean = report.errors.length === 0 && report.warnings.length === 0;

  return (
    <div className="doctor">
      <div className="doctor-head">
        <span>
          {clean ? (
            <span className="ok-text">All checks passed.</span>
          ) : (
            <>
              <span className={report.errors.length ? "err-text" : "dim"}>
                {report.errors.length} error{report.errors.length === 1 ? "" : "s"}
              </span>
              <span className="dim">, </span>
              <span className={report.warnings.length ? "warn-text" : "dim"}>
                {report.warnings.length} warning{report.warnings.length === 1 ? "" : "s"}
              </span>
            </>
          )}
        </span>
        <Button size="md" variant="flat" startContent={<RotateCcw size={14} />} onPress={run}>
          Re-run
        </Button>
      </div>
      {report.errors.length > 0 && (
        <div className="doctor-section">
          <div className="group-label">errors</div>
          {report.errors.map((e, i) => (
            <div key={i} className="err-text doctor-line">✕ {e}</div>
          ))}
        </div>
      )}
      {report.warnings.length > 0 && (
        <div className="doctor-section">
          <div className="group-label">warnings</div>
          {report.warnings.map((w, i) => (
            <div key={i} className="warn-text doctor-line">⚠ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
