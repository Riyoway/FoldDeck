import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@heroui/react";
import { ExternalLink, RotateCw, Square } from "lucide-react";
import ProjectIcon from "./ProjectIcon";
import { formatUptime, type ProjectInfo, type ProjectStatus } from "./App";

interface ProcStat {
  id: string;
  pid: number;
  cpu: number | null;
  memMb: number | null;
}

type SortKey = "name" | "cpu" | "mem" | "uptime";

/** Tiny monochrome sparkline / area chart (same style as RequestChart). */
function Spark({
  series,
  w,
  h,
  fill,
  floor = 1,
}: {
  series: number[];
  w: number;
  h: number;
  fill?: boolean;
  /** Minimum y-scale so idle noise doesn't render as full-height mountains. */
  floor?: number;
}) {
  if (series.length < 2) return <svg width={w} height={h} className="mon-spark" />;
  const max = Math.max(...series, floor);
  const step = w / (series.length - 1);
  const y = (v: number) => h - 2 - (v / max) * (h - 6);
  const line = series.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="mon-spark">
      {fill && <path d={`${line} L${w},${h} L0,${h} Z`} fill="rgba(88,166,255,0.18)" />}
      <path d={line} fill="none" stroke="#58a6ff" strokeWidth={fill ? 1.5 : 1} />
    </svg>
  );
}

function portOf(st: ProjectStatus | undefined, p: ProjectInfo): number | null {
  const fromUrl = st?.url?.match(/:(\d+)/)?.[1];
  return fromUrl ? Number(fromUrl) : p.defaultPort ?? null;
}

export default function MonitorView({
  projects,
  statuses,
  onSelect,
  onStop,
  onRestart,
  onStopAll,
}: {
  projects: ProjectInfo[];
  statuses: Record<string, ProjectStatus>;
  onSelect: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onStopAll: () => void;
}) {
  const [stats, setStats] = useState<ProcStat[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "cpu", dir: -1 });
  const histRef = useRef<Record<string, number[]>>({});
  const aggCpuRef = useRef<number[]>([]);
  const aggMemRef = useRef<number[]>([]);
  /** Memory-bar scale ratchets to the session peak so bars don't rescale each tick. */
  const memScaleRef = useRef(1);

  // 1s render tick so uptime counts smoothly between the 2s stat events.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const ingest = (s: ProcStat[]) => {
      const h = histRef.current;
      let cpuSum = 0;
      let memSum = 0;
      for (const st of s) {
        if (st.cpu != null) {
          (h[st.id] ??= []).push(st.cpu);
          if (h[st.id].length > 30) h[st.id].shift();
          cpuSum += st.cpu;
        }
        if (st.memMb != null) memSum += st.memMb;
      }
      const push = (ref: React.MutableRefObject<number[]>, v: number) => {
        ref.current.push(v);
        if (ref.current.length > 30) ref.current.shift();
      };
      push(aggCpuRef, cpuSum);
      push(aggMemRef, memSum);
    };
    invoke<ProcStat[]>("get_process_stats")
      .then((s) => {
        ingest(s);
        setStats(s);
      })
      .catch(() => {});
    const un = listen<ProcStat[]>("process-stats", (e) => {
      ingest(e.payload);
      setStats(e.payload);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const statMap: Record<string, ProcStat> = {};
  for (const s of stats) statMap[s.id] = s;
  const running = projects.filter((p) => statuses[p.id]?.running);

  const rows = [...running].sort((a, b) => {
    const sa = statMap[a.id];
    const sb = statMap[b.id];
    let d = 0;
    if (sort.key === "name") d = a.name.localeCompare(b.name);
    else if (sort.key === "cpu") d = (sa?.cpu ?? -1) - (sb?.cpu ?? -1);
    else if (sort.key === "mem") d = (sa?.memMb ?? -1) - (sb?.memMb ?? -1);
    else if (sort.key === "uptime")
      d = (statuses[a.id]?.startedAt ?? 0) - (statuses[b.id]?.startedAt ?? 0);
    return d * sort.dir;
  });

  const totalCpu = stats.reduce((n, s) => n + (s.cpu ?? 0), 0);
  const totalMem = stats.reduce((n, s) => n + (s.memMb ?? 0), 0);
  const maxMem = Math.max(1, ...stats.map((s) => s.memMb ?? 0));
  memScaleRef.current = Math.max(memScaleRef.current, maxMem);
  const memLabel = totalMem >= 1024 ? `${(totalMem / 1024).toFixed(2)} GB` : `${totalMem.toFixed(0)} MB`;

  const sortHead = (key: SortKey, label: string, cls = "") => (
    <th
      className={`${cls} mon-sortable ${sort.key === key ? "mon-sorted" : ""}`}
      onClick={() => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }))}
    >
      {label}
      {sort.key === key && <span className="mon-sort-dir">{sort.dir === -1 ? "▾" : "▴"}</span>}
    </th>
  );

  return (
    <div className="monitor">
      <div className="mon-head">
        <div className="mon-metrics">
          <span className="mon-metric">
            <span className="mon-metric-label">Running</span>
            <span className="mon-metric-val">{running.length}</span>
          </span>
          <span className="mon-metric">
            <span className="mon-metric-label">CPU</span>
            <span className="mon-metric-val">{totalCpu.toFixed(0)}%</span>
          </span>
          <span className="mon-metric">
            <span className="mon-metric-label">Memory</span>
            <span className="mon-metric-val">{memLabel}</span>
          </span>
        </div>
        {running.length > 0 && (
          <span className="mon-live">
            <span className="st st-on" />
            live · 2s
          </span>
        )}
        {aggCpuRef.current.length > 1 && (
          <div className="mon-charts">
            <div className="mon-chart">
              <span className="mon-chart-label">
                CPU %<span className="mon-chart-val">{totalCpu.toFixed(0)}%</span>
              </span>
              <Spark series={aggCpuRef.current} w={200} h={38} fill floor={50} />
            </div>
            <div className="mon-chart">
              <span className="mon-chart-label">
                Memory<span className="mon-chart-val">{memLabel}</span>
              </span>
              <Spark series={aggMemRef.current} w={200} h={38} fill floor={512} />
            </div>
          </div>
        )}
        <Button size="sm" variant="light" color="danger" onPress={onStopAll} isDisabled={!running.length}>
          Stop all
        </Button>
      </div>

      {running.length === 0 ? (
        <div className="mon-empty">
          <span className="dim">no processes running</span>
          <span className="mon-empty-hint dim">
            start a project from the dashboard to see live CPU / memory
          </span>
        </div>
      ) : (
        <div className="mon-table-wrap">
          <table className="mon-table">
            <thead>
              <tr>
                <th className="mon-col-icon"></th>
                {sortHead("name", "Project")}
                <th className="mon-col-pid mon-num">PID</th>
                {sortHead("cpu", "CPU", "mon-num")}
                {sortHead("mem", "Memory", "mon-num")}
                {sortHead("uptime", "Uptime", "mon-num")}
                <th className="mon-col-port mon-num">Port</th>
                <th className="mon-col-act"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const st = statuses[p.id];
                const ps = statMap[p.id];
                const url = st?.url ?? null;
                const port = portOf(st, p);
                const warn =
                  (st?.crashCount ?? 0) > 0 || (st?.lastExitCode != null && st.lastExitCode !== 0);
                return (
                  <tr
                    key={p.id}
                    tabIndex={0}
                    onClick={() => onSelect(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(p.id);
                      }
                    }}
                  >
                    <td className="mon-col-icon">
                      <ProjectIcon project={p} size={15} />
                    </td>
                    <td className="mon-col-name">
                      <span
                        className={`st ${warn ? "st-warn" : "st-on"}`}
                        title={
                          warn
                            ? `crashed ${st?.crashCount ?? 0}× · last exit ${st?.lastExitCode ?? 0}`
                            : "running"
                        }
                      />
                      <span className="mon-name">{p.name}</span>
                      <span className="mon-path dim" title={p.path}>
                        {p.path.split(/[\\/]/).filter(Boolean).slice(-2).join("/")}
                      </span>
                    </td>
                    <td className="mon-num dim">{ps?.pid ? ps.pid : "—"}</td>
                    <td className="mon-num mon-cpu">
                      <span className="mon-cell">
                        {histRef.current[p.id] && (
                          <Spark series={histRef.current[p.id]} w={54} h={16} />
                        )}
                        {ps === undefined ? (
                          <span className="mon-val dim">…</span>
                        ) : (
                          <span className="mon-val">{ps.cpu != null ? `${ps.cpu.toFixed(0)}%` : "—"}</span>
                        )}
                      </span>
                    </td>
                    <td className="mon-num mon-mem">
                      <span className="mon-cell">
                        {ps?.memMb != null && (
                          <span
                            className="mon-membar"
                            title={`scale: ${memScaleRef.current.toFixed(0)} MB session peak`}
                          >
                            <span
                              style={{
                                width: `${Math.min(100, (ps.memMb / memScaleRef.current) * 100)}%`,
                              }}
                            />
                          </span>
                        )}
                        <span className="mon-val">
                          {ps?.memMb != null ? `${ps.memMb.toFixed(0)} MB` : "—"}
                        </span>
                      </span>
                    </td>
                    <td className="mon-num dim">{formatUptime(st?.startedAt) || "—"}</td>
                    <td className="mon-num dim">{port ?? "—"}</td>
                    <td className="mon-col-act" onClick={(e) => e.stopPropagation()}>
                      <Button isIconOnly size="sm" variant="light" aria-label="Stop" onPress={() => onStop(p.id)}>
                        <Square size={14} />
                      </Button>
                      <Button isIconOnly size="sm" variant="light" aria-label="Restart" onPress={() => onRestart(p.id)}>
                        <RotateCw size={14} />
                      </Button>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        aria-label="Open"
                        isDisabled={!url}
                        onPress={() => url && openUrl(url)}
                      >
                        <ExternalLink size={14} />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
