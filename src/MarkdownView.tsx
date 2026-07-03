import { useEffect, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { ProjectInfo } from "./App";

export default function MarkdownView({ project }: { project: ProjectInfo }) {
  const docs = project.docs ?? [];
  const [active, setActive] = useState(docs[0] ?? "");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (docs.length && !docs.includes(active)) setActive(docs[0]);
  }, [docs, active]);

  useEffect(() => {
    if (!active) return;
    setError(null);
    invoke<string>("read_markdown", { id: project.id, path: active })
      .then(setContent)
      .catch((e) => {
        setError(String(e));
        setContent("");
      });
  }, [project.id, active]);

  if (docs.length === 0) {
    return <div className="md-view md-empty dim">No markdown docs found in this project.</div>;
  }

  // Resolve an image src: absolute (badges) pass through; project-relative paths
  // resolve to a local asset URL relative to the active markdown file's folder.
  const resolveSrc = (src?: string): string | undefined => {
    if (!src || /^(https?:|data:|asset:|blob:)/i.test(src)) return src;
    const dir = active.includes("/") ? active.slice(0, active.lastIndexOf("/")) : "";
    const base = project.path.replace(/[\\/]+$/, "").replace(/\\/g, "/");
    const rel = [dir, src.replace(/^\.\//, "")].filter(Boolean).join("/");
    return convertFileSrc(`${base}/${rel}`);
  };

  return (
    <div className="md-view">
      {docs.length > 1 && (
        <div className="env-tabs">
          {docs.map((d) => (
            <button
              key={d}
              className={`env-tab ${d === active ? "env-tab-active" : ""}`}
              onClick={() => setActive(d)}
            >
              {d}
            </button>
          ))}
        </div>
      )}
      <div className="md-body">
        {error ? (
          <div className="dim">{error}</div>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    if (href) openUrl(href);
                  }}
                >
                  {children}
                </a>
              ),
              img: ({ src, alt, node: _node, ...rest }) => (
                // eslint-disable-next-line jsx-a11y/alt-text
                <img
                  src={resolveSrc(typeof src === "string" ? src : undefined)}
                  alt={alt}
                  loading="lazy"
                  {...rest}
                />
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
