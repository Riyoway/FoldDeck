import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity } from "lucide-react";

interface Bucket {
  minute: number;
  count: number;
}

const WINDOW_MIN = 30;
const W = 240;
const H = 36;

/** Per-minute request sparkline. Renders nothing until there is data. */
export default function RequestChart({ projectId, running }: { projectId: string; running: boolean }) {
  const [buckets, setBuckets] = useState<Bucket[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      invoke<Bucket[]>("get_request_stats", { id: projectId }).then((b) => {
        if (alive) setBuckets(b);
      });
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [projectId]);

  const nowMin = Math.floor(Date.now() / 60000);
  const series: number[] = [];
  for (let m = nowMin - WINDOW_MIN + 1; m <= nowMin; m++) {
    series.push(buckets.find((b) => b.minute === m)?.count ?? 0);
  }
  const total = series.reduce((a, b) => a + b, 0);
  if (total === 0 && !running) return null;

  const max = Math.max(...series, 1);
  const step = W / (WINDOW_MIN - 1);
  const y = (v: number) => H - 2 - (v / max) * (H - 6);
  const line = series.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;

  return (
    <div className="req-chart" title={`${total} requests in the last ${WINDOW_MIN} minutes`}>
      <svg width={W} height={H} role="img" aria-label={`${total} requests in the last ${WINDOW_MIN} minutes`}>
        <path d={area} fill="rgba(88, 166, 255, 0.18)" />
        <path d={line} fill="none" stroke="#58a6ff" strokeWidth="1.5" />
      </svg>
      <span className="req-chart-label">
        <Activity size={12} aria-hidden="true" />
        {total} req · {WINDOW_MIN}m
      </span>
    </div>
  );
}
