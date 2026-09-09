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

import { readdir } from "node:fs/promises";
import { readSnapshot, conversationMetadata, newestFirst, isMain, listPage } from "./common.mjs";
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
  let parseComplete = true;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      parseComplete = false;
      continue;
    }
    if (!record || typeof record !== "object") { parseComplete = false; continue; }
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
  messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return { messages, parseComplete };
}

async function findStateDb(home) {
  let entries;
  try {
    entries = await readdir(home);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
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
    throw Error("codex.mjs: node:sqlite unavailable (need Node >= 22.13)");
  }

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    throw Error(`codex.mjs: failed to open state database: ${err.message}`);
  }
  try {
    const columns = new Set(db.prepare("PRAGMA table_info(threads)").all().map((c) => c.name));
    const optional = ["created_at_ms", "updated_at_ms"].map((c) => columns.has(c) ? c : `NULL AS ${c}`);
    return db
      .prepare(
        `SELECT id, rollout_path, title, first_user_message, cwd, created_at, updated_at, ${optional.join(", ")} FROM threads WHERE rollout_path IS NOT NULL AND rollout_path != ''`
      )
      .all();
  } catch (err) {
    throw Error(`codex.mjs: failed to read threads table: ${err.message}`);
  } finally {
    db.close();
  }
}

async function sessionFromRow(row, { withMessages }) {
  let snapshot;
  try {
    snapshot = await readSnapshot(row.rollout_path);
  } catch (err) {
    if (err.code === "ENOENT") return null; // missing rollout stays unresolved
    throw err;
  }
  const { messages, parseComplete } = parseRolloutMessages(snapshot.text);
  if (messages.length === 0 && parseComplete) return null;

  const first = messages[0] ?? { timestamp: snapshot.lastModifiedAt };
  const last = messages[messages.length - 1] ?? first;
  const entry = {
    tool: TOOL,
    id: row.id,
    title: (row.title || "").trim() || (row.first_user_message || "").trim().slice(0, 80) || titleFromCwd(row.cwd ?? ""),
    cwd: row.cwd ?? "",
    firstMessageAt: first.timestamp || tsFromMs(row.created_at_ms) || tsFromMs(row.created_at * 1000) || new Date(0).toISOString(),
    lastMessageAt: last.timestamp || tsFromMs(row.updated_at_ms) || tsFromMs(row.updated_at * 1000) || new Date(0).toISOString(),
    messageCount: messages.length,
    path: row.rollout_path,
    ...conversationMetadata(messages, snapshot, parseComplete),
  };
  return withMessages ? { ...entry, messages } : entry;
}

export async function list(home = defaultHome(), since) {
  const rows = await threadRows(home);
  if (!rows) return [];
  const out = [];
  for (const row of rows) {
    // DB timestamps can lag rollouts and older schemas use seconds, not ms.
    // Only the parsed conversation span can implement --since correctly.
    const entry = await sessionFromRow(row, { withMessages: false });
    if (!entry) continue;
    if (since && Date.parse(entry.lastMessageAt) <= Date.parse(since)) continue;
    out.push(entry);
  }
  out.sort(newestFirst);
  return out;
}

export async function session(home = defaultHome(), sessionId) {
  const rows = await threadRows(home);
  if (!rows) return null;
  const row = rows.find((r) => r.id === sessionId);
  if (!row) return null;
  return sessionFromRow(row, { withMessages: true });
}

// --- CLI ---
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  function flag(name) {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  }
  const home = flag("--root") ?? defaultHome();

  if (args.includes("--list")) {
    process.stdout.write(JSON.stringify(listPage(await list(home), args), null, 2) + "\n");
  } else if (flag("--session")) {
    process.stdout.write(JSON.stringify(await session(home, flag("--session")), null, 2) + "\n");
  } else {
    process.stderr.write("usage: codex.mjs --list [--since ISO] [--limit N] [--offset N] | --session <id> [--root <codexHome>]\n");
    process.exit(2);
  }
}
