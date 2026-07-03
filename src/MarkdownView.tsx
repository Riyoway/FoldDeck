import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { ProjectInfo } from "./App";

// rehype-raw renders README HTML (badges, <p align>); rehype-sanitize then
// strips anything executable (script/iframe/on*-handlers/javascript: URLs) so a
// cloned/untrusted README can't run code. We re-allow only safe presentational
// attributes (align + img sizing) that the sanitizer drops by default.
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "align"],
    img: [...(defaultSchema.attributes?.img ?? []), "src", "alt", "width", "height"],
  },
};

const ABSOLUTE = /^(https?:|data:)/i;

/** A project-relative README image, loaded as a path-guarded data URI. */
function DocImage({
  project,
  dir,
  src,
  ...rest
}: {
  project: ProjectInfo;
  dir: string;
  src: string;
} & React.ImgHTMLAttributes<HTMLImageElement>) {
  const [resolved, setResolved] = useState<string | undefined>(undefined);
  useEffect(() => {
    const rel = [dir, src.replace(/^\.\//, "")].filter(Boolean).join("/");
    let live = true;
    invoke<string>("read_doc_image", { id: project.id, path: rel })
      .then((uri) => live && setResolved(uri))
      .catch(() => live && setResolved(undefined));
    return () => {
      live = false;
    };
  }, [project.id, dir, src]);
  // eslint-disable-next-line jsx-a11y/alt-text
  return <img src={resolved} loading="lazy" {...rest} />;
}

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

  const activeDir = active.includes("/") ? active.slice(0, active.lastIndexOf("/")) : "";

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
            rehypePlugins={[rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    // Only hand real web/mail links to the OS opener.
                    if (href && /^(https?|mailto):/i.test(href)) openUrl(href);
                  }}
                >
                  {children}
                </a>
              ),
              img: ({ src, node: _node, ...rest }) => {
                const s = typeof src === "string" ? src : "";
                if (ABSOLUTE.test(s)) {
                  // eslint-disable-next-line jsx-a11y/alt-text
                  return <img src={s} loading="lazy" {...rest} />;
                }
                return <DocImage project={project} dir={activeDir} src={s} {...rest} />;
              },
            }}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
