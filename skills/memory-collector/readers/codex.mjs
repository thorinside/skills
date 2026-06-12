#!/usr/bin/env node
// Codex session reader — memory-collector skill
//
// Ported from Flare576/ei src/integrations/codex/reader.ts
// (MIT, © 2026 Jeremy Scherer), with bun:sqlite swapped for node:sqlite
// (built-in, unflagged since Node 22.13). Dependency-free; Node >= 22.13.
//
// Session metadata lives in ~/.codex/state_<N>.sqlite (threads table, highest
// N wins); message content lives in the per-thread rollout JSONL file, where
// only event_msg records with payload.type user_message / agent_message are
// conversational.
//
// Usage:
//   node codex.mjs --list [--since <ISO>] [--root <codexHome>]
//   node codex.mjs --session <id> [--root <codexHome>]
//
// Output contract: see readers/README.md. Missing store => empty output, exit 0.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const TOOL = "codex";

function defaultHome() {
  return process.env.CODEX_HOME || join(process.env.HOME || "~", ".codex");
}

function titleFromCwd(cwd) {
  if (!cwd) return "Codex Session";
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

function tsFromMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value).toISOString();
}

function parseRolloutMessages(text) {
  const messages = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (record.type !== "event_msg") continue;
    const payload = record.payload ?? {};
    if (payload.type !== "user_message" && payload.type !== "agent_message") continue;
    if (typeof payload.message !== "string" || payload.message.trim() === "") continue;

    messages.push({
      id: `evt_${i + 1}`,
      role: payload.type === "user_message" ? "user" : "assistant",
      content: payload.message.trim(),
      timestamp:
        typeof record.timestamp === "string" && record.timestamp.trim()
          ? record.timestamp
          : new Date(0).toISOString(),
    });
  }
  return messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

async function findStateDb(home) {
  let entries;
  try {
    entries = await readdir(home);
  } catch {
    return null;
  }
  const dbs = entries
    .map((name) => {
      const m = name.match(/^state_(\d+)\.sqlite$/);
      return m ? { name, version: Number(m[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.version - a.version);
  if (dbs.length > 0) return join(home, dbs[0].name);
  if (entries.includes("state.sqlite")) return join(home, "state.sqlite");
  return null;
}

async function threadRows(home) {
  const dbPath = await findStateDb(home);
  if (!dbPath) return null;

  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    process.stderr.write("codex.mjs: node:sqlite unavailable (need Node >= 22.13); skipping codex source\n");
    return null;
  }

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    process.stderr.write(`codex.mjs: failed to open ${dbPath}: ${err.message}\n`);
    return null;
  }
  try {
    return db
      .prepare(
        "SELECT id, rollout_path, title, first_user_message, cwd, created_at, updated_at, created_at_ms, updated_at_ms FROM threads WHERE rollout_path IS NOT NULL AND rollout_path != ''"
      )
      .all();
  } catch (err) {
    process.stderr.write(`codex.mjs: failed to read threads table: ${err.message}\n`);
    return null;
  } finally {
    db.close();
  }
}

async function sessionFromRow(row, { withMessages }) {
  let text;
  try {
    text = await readFile(row.rollout_path, "utf-8");
  } catch {
    return null; // rollout file moved/deleted — skip
  }
  const messages = parseRolloutMessages(text);
  if (messages.length === 0) return null;

  const first = messages[0];
  const last = messages[messages.length - 1];
  const entry = {
    tool: TOOL,
    id: row.id,
    title: (row.title || "").trim() || (row.first_user_message || "").trim().slice(0, 80) || titleFromCwd(row.cwd ?? ""),
    cwd: row.cwd ?? "",
    firstMessageAt: first.timestamp || tsFromMs(row.created_at_ms) || tsFromMs(row.created_at) || new Date(0).toISOString(),
    lastMessageAt: last.timestamp || tsFromMs(row.updated_at_ms) || tsFromMs(row.updated_at) || new Date(0).toISOString(),
    messageCount: messages.length,
    path: row.rollout_path,
  };
  return withMessages ? { ...entry, messages } : entry;
}

async function list(home, since) {
  const rows = await threadRows(home);
  if (!rows) return [];
  const out = [];
  for (const row of rows) {
    // Cheap incremental pre-filter on DB timestamps before touching rollout files.
    if (since) {
      const updated = tsFromMs(row.updated_at_ms) || tsFromMs(row.updated_at);
      if (updated && updated <= since) continue;
    }
    const entry = await sessionFromRow(row, { withMessages: false });
    if (!entry) continue;
    if (since && entry.lastMessageAt <= since) continue;
    out.push(entry);
  }
  out.sort((a, b) => new Date(a.lastMessageAt) - new Date(b.lastMessageAt));
  return out;
}

async function session(home, sessionId) {
  const rows = await threadRows(home);
  if (!rows) return null;
  const row = rows.find((r) => r.id === sessionId);
  if (!row) return null;
  return sessionFromRow(row, { withMessages: true });
}

// --- CLI ---
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}
const home = flag("--root") ?? defaultHome();

if (args.includes("--list")) {
  process.stdout.write(JSON.stringify(await list(home, flag("--since")), null, 2) + "\n");
} else if (flag("--session")) {
  process.stdout.write(JSON.stringify(await session(home, flag("--session")), null, 2) + "\n");
} else {
  process.stderr.write("usage: codex.mjs --list [--since ISO] | --session <id>  [--root <codexHome>]\n");
  process.exit(2);
}
