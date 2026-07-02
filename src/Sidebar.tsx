import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { Button } from "@heroui/react";
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
  onProjectContextMenu: (e: React.MouseEvent, project: ProjectInfo) => void;
  onBackgroundContextMenu: (e: React.MouseEvent) => void;
}

const MIN_W = 210;
const MAX_W = 480;

function ProjectRow({
  project,
  running,
  selected,
  onSelect,
  onDragStart,
  onDragEnd,
  onContextMenu,
}: {
  project: ProjectInfo;
  running: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onContextMenu: (e: React.MouseEvent, project: ProjectInfo) => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={project.id}
      as="div"
      dragListener={false}
      dragControls={controls}
      className={`row ${selected ? "row-selected" : ""}`}
      onClick={() => onSelect(project.id)}
      onContextMenu={(e: React.MouseEvent) => onContextMenu(e, project)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      whileDrag={{
        scale: 1.03,
        backgroundColor: "#2b2b31",
        boxShadow: "0 8px 22px rgba(0,0,0,0.55)",
        cursor: "grabbing",
      }}
    >
      <span
        className="grip"
        title="Drag to reorder"
        onPointerDown={(e) => {
          e.stopPropagation();
          controls.start(e);
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={14} />
      </span>
      <span className={`st ${running ? "st-on" : ""}`} />
      <ProjectIcon project={project} size={14} />
      <span className="row-name">{project.name}</span>
      {project.warnings.length > 0 && (
        <span className="row-warn" title={`${project.warnings.length} warning(s)`}>
          {project.warnings.length}
        </span>
      )}
      <span className="row-fw">{project.framework ?? project.kind}</span>
    </Reorder.Item>
  );
}

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
  onProjectContextMenu,
  onBackgroundContextMenu,
}: Props) {
  const [order, setOrder] = useState<string[]>(() => projects.map((p) => p.id));
  const draggingRef = useRef(false);
  const orderRef = useRef(order);
  orderRef.current = order;

  // Keep the local order in sync with the project list (add/remove) except
  // while a drag is in progress.
  useEffect(() => {
    if (draggingRef.current) return;
    const ids = projects.map((p) => p.id);
    setOrder((prev) => (prev.join("|") === ids.join("|") ? prev : ids));
  }, [projects]);

  const byId = new Map(projects.map((p) => [p.id, p] as const));

  const handleDragStart = () => {
    draggingRef.current = true;
    document.body.classList.add("dragging-row");
  };
  const handleDragEnd = () => {
    draggingRef.current = false;
    document.body.classList.remove("dragging-row");
    onReorder(orderRef.current);
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
    <aside className="sidebar" style={{ width }} onContextMenu={onBackgroundContextMenu}>
      <div className="sidebar-actions">
        <Button
          size="md"
          fullWidth
          className="btn-green"
          startContent={<Plus size={14} />}
          onPress={onAddFolder}
        >
          Add folder
        </Button>
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
        <div className="sidebar-list">
          <div className="group-label">
            Projects <span className="counter">{projects.length}</span>
          </div>
          <Reorder.Group axis="y" values={order} onReorder={setOrder} as="div">
            {order.map((id) => {
              const p = byId.get(id);
              if (!p) return null;
              return (
                <ProjectRow
                  key={id}
                  project={p}
                  running={!!statuses[id]?.running}
                  selected={id === selectedId}
                  onSelect={onSelectProject}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onContextMenu={onProjectContextMenu}
                />
              );
            })}
          </Reorder.Group>
        </div>
      )}

      <div className="sidebar-resize" onPointerDown={startResize} title="Drag to resize" />
    </aside>
  );
}
