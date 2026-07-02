import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { GripVertical, LayoutDashboard, Plus } from "lucide-react";
import ProjectIcon from "./ProjectIcon";
import type { ProjectInfo, ProjectStatus } from "./App";

interface Props {
  projects: ProjectInfo[];
  statuses: Record<string, ProjectStatus>;
  selectedId: string | null;
  width: number;
  onSelectDashboard: () => void;
  onSelectProject: (id: string) => void;
  onAddFolder: () => void;
  onReorder: (ids: string[]) => void;
  onResize: (width: number) => void;
}

const MIN_W = 210;
const MAX_W = 480;

export default function Sidebar({
  projects,
  statuses,
  selectedId,
  width,
  onSelectDashboard,
  onSelectProject,
  onAddFolder,
  onReorder,
  onResize,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // While dragging, render from the working order; otherwise from the prop.
  const displayed =
    dragId && order
      ? (order.map((id) => projects.find((p) => p.id === id)).filter(Boolean) as ProjectInfo[])
      : projects;

  const startDrag = (id: string, e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragId(id);
    setOrder(projects.map((p) => p.id));
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveDrag = (e: ReactPointerEvent) => {
    if (!dragId || !order || !listRef.current) return;
    const rows = Array.from(listRef.current.querySelectorAll<HTMLElement>("[data-proj-id]"));
    let targetId: string | null = null;
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        targetId = row.dataset.projId ?? null;
        break;
      }
    }
    const without = order.filter((id) => id !== dragId);
    const idx = targetId ? without.indexOf(targetId) : without.length;
    const next = [...without.slice(0, idx), dragId, ...without.slice(idx)];
    if (next.join("|") !== order.join("|")) setOrder(next);
  };

  const endDrag = () => {
    if (order) onReorder(order);
    setDragId(null);
    setOrder(null);
  };

  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) =>
      onResize(Math.min(MAX_W, Math.max(MIN_W, startW + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-actions">
        <button className="btn btn-primary" onClick={onAddFolder}>
          <Plus size={13} /> Add folder
        </button>
      </div>

      <div
        className={`row row-nav ${selectedId === null ? "row-selected" : ""}`}
        onClick={onSelectDashboard}
      >
        <LayoutDashboard size={14} />
        <span className="row-name">Dashboard</span>
      </div>

      {projects.length === 0 ? (
        <div className="sidebar-empty">
          No projects yet.
          <br />
          Drop a folder anywhere, or use Add folder.
        </div>
      ) : (
        <div className="sidebar-list" ref={listRef}>
          <div className="group-label">
            Projects <span className="counter">{projects.length}</span>
          </div>
          {displayed.map((p) => {
            const running = !!statuses[p.id]?.running;
            const url = statuses[p.id]?.url;
            return (
              <div
                key={p.id}
                data-proj-id={p.id}
                className={`row ${p.id === selectedId ? "row-selected" : ""} ${
                  dragId === p.id ? "row-dragging" : ""
                }`}
                onClick={() => onSelectProject(p.id)}
              >
                <span
                  className="grip"
                  title="Drag to reorder"
                  onPointerDown={(e) => startDrag(p.id, e)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onClick={(e) => e.stopPropagation()}
                >
                  <GripVertical size={13} />
                </span>
                <span className={`st ${running ? "st-on" : ""}`} />
                <ProjectIcon project={p} size={14} />
                <span className="row-name">{p.name}</span>
                {p.warnings.length > 0 && <span className="row-warn">{p.warnings.length}</span>}
                <span className="row-fw">{p.framework ?? p.kind}</span>
                <span className="row-port">
                  {running && url
                    ? url.replace(/^https?:\/\//, "")
                    : p.defaultPort
                      ? `:${p.defaultPort}`
                      : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="sidebar-resize" onPointerDown={startResize} title="Drag to resize" />
    </aside>
  );
}
