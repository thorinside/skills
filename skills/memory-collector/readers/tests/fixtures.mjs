import { mkdtemp, mkdir, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const NOW = Date.parse("2026-09-09T12:00:00Z");
export const at = (hour) => `2026-09-09T${hour}:00.000Z`;
export const specs = [
  { tool: "pi", id: "live", date: at("11:50") },
  { tool: "pi", id: "tiny", date: at("10:50"), count: 2 },
  { tool: "codex", id: "robot", date: at("10:40"), robot: true },
  { tool: "pi", id: "newest", date: at("10:00") },
  { tool: "codex", id: "z-tie", date: at("09:00") },
  { tool: "claudecode", id: "b-tie", date: at("09:00") },
  { tool: "claudecode", id: "a-tie", date: at("09:00") },
  { tool: "pi", id: "done", date: at("08:00") },
  { tool: "pi", id: "hole", date: "2026-01-01T00:00:00.000Z" },
];
export function messages(spec) {
  return Array.from({ length: spec.count ?? 4 }, (_, i) => ({ id: `m${i}`,
    role: spec.robot ? (i ? "assistant" : "user") : (i % 2 ? "assistant" : "user"),
    content: spec.robot && !i ? "Run one collection pass for today" : `Human design conversation ${i}`,
    timestamp: new Date(Date.parse(spec.date) - ((spec.count ?? 4) - i - 1) * 1000).toISOString() }));
}
export async function fixture({ sessions = specs, milliseconds = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "collector-fixture-"));
  const roots = { claudecode: join(root, "claude"), pi: join(root, "pi"), codex: join(root, "codex") };
  for (const path of Object.values(roots)) await mkdir(path, { recursive: true });
  const db = new DatabaseSync(join(roots.codex, "state_5.sqlite"));
  db.exec(`CREATE TABLE threads (id TEXT, rollout_path TEXT, title TEXT, first_user_message TEXT, cwd TEXT,
    created_at INTEGER, updated_at INTEGER${milliseconds ? ", created_at_ms INTEGER, updated_at_ms INTEGER" : ""})`);
  const paths = {};
  async function put(spec) {
    const ms = messages(spec);
    const dir = spec.tool === "codex" ? roots.codex : join(roots[spec.tool], "encoded-cwd");
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${spec.tool === "pi" ? "timestamp_" : ""}${spec.id}.jsonl`);
    let records;
    if (spec.tool === "pi") records = [{ type: "session", cwd: "/real/with-hyphen" },
      ...ms.map((m) => ({ type: "message", id: m.id, timestamp: m.timestamp, message: { role: m.role,
        content: [{ type: "text", text: m.content }, { type: "thinking", thinking: "not-conversation" }] } }))];
    else if (spec.tool === "claudecode") records = ms.map((m) => ({ type: m.role, uuid: m.id,
      timestamp: m.timestamp, cwd: "/real/project", message: { content: m.role === "user" ? m.content
        : [{ type: "text", text: m.content }, { type: "tool_use", name: "not-conversation" }] } }));
    else records = ms.map((m) => ({ type: "event_msg", timestamp: m.timestamp,
      payload: { type: m.role === "user" ? "user_message" : "agent_message", message: m.content } }));
    await writeFile(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    await utimes(path, new Date(spec.date), new Date(spec.date));
    paths[spec.id] = path;
    if (spec.tool === "codex") {
      db.prepare("DELETE FROM threads WHERE id = ?").run(spec.id);
      // Intentionally stale DB timestamps: rollout is the authoritative --since span.
      const values = [spec.id, path, "private-title-sentinel", "private-opening", "/real/project", 1, 1];
      if (milliseconds) values.push(null, 1);
      db.prepare(`INSERT INTO threads VALUES (${values.map(() => "?").join(",")})`).run(...values);
    }
    return path;
  }
  for (const spec of sessions) await put(spec);
  return { root, roots, paths, put, close: async () => { db.close(); await rm(root, { recursive: true, force: true }); } };
}
