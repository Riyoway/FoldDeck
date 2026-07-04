import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { GitBranch } from "lucide-react";
import { getSetting } from "./settings";

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: (path: string) => void;
}

export default function GitImportModal({ open, onClose, onImported }: Props) {
  const [url, setUrl] = useState("");
  const [destDir, setDestDir] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!open) return;
    setUrl("");
    setLog([]);
    setError(null);
    const configured = getSetting("gitImportDir");
    if (configured) {
      setDestDir(configured);
    } else {
      invoke<string>("get_default_clone_dir").then(setDestDir).catch(() => setDestDir(""));
    }
    const unlisten = listen<{ line: string }>("git-import-log", (e) => {
      setLog((prev) => [...prev.slice(-200), e.payload.line]);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [open]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  const doImport = async () => {
    setBusy(true);
    setError(null);
    setLog([]);
    try {
      const path = await invoke<string>("git_import", {
        url,
        destDir: getSetting("gitImportDir") || null,
      });
      onImported(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={() => !busy && onClose()} size="lg" placement="center" backdrop="opaque">
      <ModalContent>
        <ModalHeader className="modal-head-hero">
          <GitBranch size={16} aria-hidden="true" /> Import from Git
        </ModalHeader>
        <ModalBody>
          <Input
            size="md"
            variant="bordered"
            label="Repository URL"
            placeholder="https://github.com/user/repo.git"
            value={url}
            onValueChange={setUrl}
            isDisabled={busy}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim() && !busy) doImport();
            }}
          />
          <p className="dim git-dest">
            Clones into <code className="inline-code">{destDir || "…"}</code>, change it in
            Settings → Git.
          </p>
          {error && <div className="error-bar git-error">{error}</div>}
          {(busy || log.length > 0) && (
            <pre className="git-log" ref={logRef}>
              {log.join("\n") || "Starting clone…"}
            </pre>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={busy}>
            Cancel
          </Button>
          <Button color="primary" onPress={doImport} isDisabled={!url.trim()} isLoading={busy}>
            {busy ? "Cloning…" : "Clone & add"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
