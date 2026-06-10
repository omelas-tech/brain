// Write helpers — mutate a user's brain via the repo's deterministic CLIs, with
// BRAIN_DIR pointed at the user's working copy. Same engine the CLI uses, so a
// memory written from the connector is byte-identical to one written locally.
// (The caller syncs the working copy back to brain-cloud — see store.syncBack.)

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin");

function run(file: string, args: string[], brainDir: string, input?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(BIN, file), ...args], {
      env: { ...process.env, BRAIN_DIR: brainDir },
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      const text = out || err;
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { /* non-JSON */ }
      if (code !== 0 || parsed?.error) {
        return reject(new Error(parsed?.error || `${file} exited ${code}: ${text.slice(0, 200)}`));
      }
      resolve(parsed ?? { ok: true, output: text });
    });
    if (input !== undefined) { child.stdin.write(input); }
    child.stdin.end();
  });
}

function slug(s: string): string {
  return (s || "memory").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "memory";
}

export interface MemorizeInput {
  content: string;
  title?: string;
  type?: string;       // decision | insight | goal | experience | learning | relationship | preference | observation
  tags?: string[];
  category?: string;   // top-level area; defaults to "captured" (reorganized later by sleep)
  project?: string;
}

/** Create a memory from explicitly-provided content (never the raw conversation). */
export async function memorize(brainDir: string, m: MemorizeInput): Promise<any> {
  const title = (m.title || m.content.split("\n")[0]).trim().slice(0, 80) || "Captured note";
  const type = m.type || "learning";
  const category = (m.category || "captured").replace(/^\/+|\/+$/g, "");
  const payload = {
    title,
    type,
    cognitive_type: "episodic",
    path: `${category}/${slug(title)}.md`,
    tags: m.tags ?? [],
    salience: 0.5,
    confidence: 0.8,
    source: "Claude connector",
    encoding_context: { project: m.project || "", topics: m.tags ?? [], task_type: "capturing" },
    content: m.content,
  };
  const res = await run("memorize.js", [], brainDir, JSON.stringify({ memories: [payload] }));
  return res?.stored?.[0] ?? res;
}

export async function pin(brainDir: string, id: string, opts: { scope?: string; priority?: number } = {}): Promise<any> {
  const args = [id];
  if (opts.scope) args.push("--scope", opts.scope);
  if (opts.priority != null) args.push("--priority", String(opts.priority));
  return run("pin.js", args, brainDir);
}

export async function unpin(brainDir: string, id: string): Promise<any> {
  return run("unpin.js", [id], brainDir);
}

/** Archive a memory (recoverable): removes it from recall but keeps it in _archived/. */
export async function forget(brainDir: string, id: string): Promise<any> {
  return run("forget.js", [id], brainDir);
}
