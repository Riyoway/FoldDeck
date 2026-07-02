import { invoke } from "@tauri-apps/api/core";

/** Runs the command audit; asks the user before running a flagged command. */
export async function confirmCommandAudit(command: string): Promise<boolean> {
  const findings = await invoke<string[]>("run_command_audit", { command });
  if (findings.length === 0) return true;
  return confirm(
    `Command audit warning\n\n${command}\n\n${findings.map((f) => `- ${f}`).join("\n")}\n\nOnly run this if you trust the project. Run anyway?`,
  );
}
