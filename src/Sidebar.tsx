import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { Button } from "@heroui/react";
import {
  GitBranch,
  GripVertical,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  X,
} from "lucide-react";
import ProjectIcon from "./ProjectIcon";
import type { ProjectInfo, ProjectStatus } from "./App";

interface Props {
  projects: ProjectInfo[];
  statuses: Record<string, ProjectStatus>;
  selectedId: string | null;
  width: number;
  collapsed: boolean;
  onToggle: () => void;
  onSelectDashboard: () => void;
  onSelectProject: (id: string) => void;
  onAddFolder: () => void;
  onReorder: (ids: string[]) => void;
  onResize: (width: number) => void;
  onProjectContextMenu: (e: React.MouseEvent, project: ProjectInfo) => void;
  onBackgroundContextMenu: (e: React.MouseEvent) => void;
  onImportGit: () => void;
}

const MIN_W = 210;
const MAX_W = 480;

function RowInner({ project, running }: { project: ProjectInfo; running: boolean }) {
  return (
    <>
      <span className={`st ${running ? "st-on" : ""}`} />
      <ProjectIcon project={project} size={14} />
      <span className="row-name">{project.name}</span>
      {project.warnings.length > 0 && (
        <span className="row-warn" title={`${project.warnings.length} warning(s)`}>
          {project.warnings.length}
        </span>
      )}
      <span className="row-fw">{project.framework ?? project.kind}</span>
    </>
  );
}

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
      onTap={() => onSelect(project.id)}
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
      <RowInner project={project} running={running} />
    </Reorder.Item>
  );
}

export default function Sidebar({
  projects,
  statuses,
  selectedId,
  width,
  collapsed,
  onToggle,
  onSelectDashboard,
  onSelectProject,
  onAddFolder,
  onReorder,
  onResize,
  onProjectContextMenu,
  onBackgroundContextMenu,
  onImportGit,
}: Props) {
  const [order, setOrder] = useState<string[]>(() => projects.map((p) => p.id));
  const [query, setQuery] = useState("");
  const draggingRef = useRef(false);
  const orderRef = useRef(order);
  orderRef.current = order;

  useEffect(() => {
    if (draggingRef.current) return;
    const ids = projects.map((p) => p.id);
    setOrder((prev) => (prev.join("|") === ids.join("|") ? prev : ids));
  }, [projects]);

  const byId = new Map(projects.map((p) => [p.id, p] as const));

  const q = query.trim().toLowerCase();
  const filtered = q
    ? order.filter((id) => {
        const p = byId.get(id);
        return (
          !!p &&
          (p.name.toLowerCase().includes(q) ||
            (p.framework ?? p.kind).toLowerCase().includes(q))
        );
      })
    : order;

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

  // Collapsed: a thin rail. The toggle stays at the same top-left spot, so it
  // never jumps between open and closed.
  if (collapsed) {
    return (
      <aside className="sidebar sidebar-rail" onContextMenu={onBackgroundContextMenu}>
        <div className="rail-top">
          <Button isIconOnly size="md" variant="light" title="Show sidebar" aria-label="Show sidebar" onPress={onToggle}>
            <PanelLeftOpen size={16} />
          </Button>
        </div>
        <button
          className={`rail-item ${selectedId === null ? "rail-selected" : ""}`}
          title="Dashboard"
          onClick={onSelectDashboard}
        >
          <LayoutDashboard size={18} />
        </button>
        <div className="rail-list">
          {order.map((id) => {
            const p = byId.get(id);
            if (!p) return null;
            return (
              <button
                key={id}
                className={`rail-item ${id === selectedId ? "rail-selected" : ""}`}
                title={p.name}
                onClick={() => onSelectProject(id)}
                onContextMenu={(e) => onProjectContextMenu(e, p)}
              >
                <ProjectIcon project={p} size={18} />
                {statuses[id]?.running && <span className="rail-dot" />}
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar" style={{ width }} onContextMenu={onBackgroundContextMenu}>
      <div className="sidebar-actions">
        <Button
          isIconOnly
          size="md"
          variant="light"
          title="Hide sidebar"
          aria-label="Hide sidebar"
          onPress={onToggle}
        >
          <PanelLeftClose size={16} />
        </Button>
        <Button
          size="md"
          className="btn-green sidebar-add"
          startContent={<Plus size={18} strokeWidth={2.5} />}
          onPress={onAddFolder}
        >
          Add folder
        </Button>
        <Button
          isIconOnly
          size="md"
          variant="light"
          aria-label="Import from Git"
          title="Import from Git"
          onPress={onImportGit}
        >
          <GitBranch size={16} />
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
          {projects.length > 6 && (
            <div className="sidebar-search">
              <Search size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects"
                spellCheck={false}
              />
              {query && (
                <button className="sidebar-search-clear" onClick={() => setQuery("")} title="Clear">
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          <div className="group-label">
            Projects{" "}
            <span className="counter">
              {query ? `${filtered.length}/${projects.length}` : projects.length}
            </span>
          </div>
          {query ? (
            filtered.length === 0 ? (
              <div className="sidebar-empty">No matches.</div>
            ) : (
              filtered.map((id) => {
                const p = byId.get(id);
                if (!p) return null;
                return (
                  <div
                    key={id}
                    className={`row ${id === selectedId ? "row-selected" : ""}`}
                    onClick={() => onSelectProject(id)}
                    onContextMenu={(e) => onProjectContextMenu(e, p)}
                  >
                    <span className="grip-spacer" />
                    <RowInner project={p} running={!!statuses[id]?.running} />
                  </div>
                );
              })
            )
          ) : (
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
          )}
        </div>
      )}

      <div className="sidebar-resize" onPointerDown={startResize} title="Drag to resize" />
    </aside>
  );
}
