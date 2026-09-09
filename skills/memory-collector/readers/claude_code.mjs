#!/usr/bin/env node
// Claude Code session reader — memory-collector skill
//
// Ported from Flare576/ei src/integrations/claude-code/reader.ts
// (MIT, © 2026 Jeremy Scherer). Dependency-free; Node >= 22.
//
// Sessions live in ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl.
// Keeps human text + assistant text blocks only; skips agent-* sidechain
// files and thinking/tool_use/system/summary/progress records.
//
// Usage:
//   node claude_code.mjs --list [--since <ISO>] [--root <projectsDir>]
//   node claude_code.mjs --session <id> [--root <projectsDir>]
//
// Output contract: see readers/README.md. Missing store => empty output, exit 0.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readSnapshot, conversationMetadata, newestFirst, isMain, listPage } from "./common.mjs";

const TOOL = "claudecode";

function defaultRoot() {
  return join(process.env.HOME || "~", ".claude", "projects");
}

function titleFromCwd(cwd) {
  if (!cwd) return "Unknown";
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

function extractAssistantText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}

async function readJsonl(filePath) {
  const snapshot = await readSnapshot(filePath);
  const records = [];
  let parseComplete = true;
  for (const line of snapshot.text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      if (!record || typeof record !== "object") { parseComplete = false; continue; }
      records.push(record);
    } catch {
      parseComplete = false;
    }
  }
  return { records, snapshot, parseComplete };
}

// One pass over a session file: messages (text-only), span, cwd.
async function parseFile(sessionId, filePath) {
  const { records, snapshot, parseComplete } = await readJsonl(filePath);
  const messages = [];
  let firstTs = null;
  let lastTs = null;
  let cwd = "";

  for (const record of records) {
    if (record.type !== "user" && record.type !== "assistant") continue;
    const ts = record.timestamp;
    if (ts) {
      if (!firstTs || Date.parse(ts) < Date.parse(firstTs)) firstTs = ts;
      if (!lastTs || Date.parse(ts) > Date.parse(lastTs)) lastTs = ts;
    }
    if (!cwd && record.cwd) cwd = record.cwd;

    let content = "";
    if (record.type === "user") {
      // Human messages have string content; tool_result records have arrays — skip those.
      content = typeof record.message?.content === "string" ? record.message.content.trim() : "";
    } else {
      content = extractAssistantText(record.message?.content ?? []);
    }
    if (!content) continue;

    messages.push({
      id: record.uuid,
      role: record.type,
      content,
      timestamp: ts ?? new Date(0).toISOString(),
    });
  }

  if (!firstTs || !lastTs) {
    if (parseComplete) return null;
    firstTs = lastTs = snapshot.lastModifiedAt;
  }
  messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return { sessionId, filePath, cwd, firstTs, lastTs, messages,
    metadata: conversationMetadata(messages, snapshot, parseComplete) };
}

async function* sessionFiles(root) {
  let projectDirs;
  try {
    projectDirs = await readdir(root);
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const dir of projectDirs) {
    if (dir.startsWith(".")) continue;
    let files;
    try {
      files = await readdir(join(root, dir));
    } catch (err) {
      if (err.code === "ENOTDIR") continue;
      throw err;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      if (f.startsWith("agent-")) continue; // sidechain sub-agent sessions
      yield { id: f.replace(/\.jsonl$/, ""), path: join(root, dir, f) };
    }
  }
}

function toListEntry(parsed) {
  return {
    tool: TOOL,
    id: parsed.sessionId,
    title: titleFromCwd(parsed.cwd),
    cwd: parsed.cwd,
    firstMessageAt: parsed.firstTs,
    lastMessageAt: parsed.lastTs,
    messageCount: parsed.messages.length,
    path: parsed.filePath,
    ...parsed.metadata,
  };
}

export async function list(root = defaultRoot(), since) {
  const out = [];
  for await (const { id, path } of sessionFiles(root)) {
    const parsed = await parseFile(id, path);
    if (!parsed || (parsed.messages.length === 0 && parsed.metadata.parseComplete)) continue;
    if (since && Date.parse(parsed.lastTs) <= Date.parse(since)) continue;
    out.push(toListEntry(parsed));
  }
  out.sort(newestFirst);
  return out;
}

export async function session(root = defaultRoot(), sessionId) {
  const matches = [];
  for await (const { id, path } of sessionFiles(root)) {
    if (id !== sessionId) continue;
    const parsed = await parseFile(id, path);
    if (parsed && (parsed.messages.length || !parsed.metadata.parseComplete)) {
      matches.push({ ...toListEntry(parsed), messages: parsed.messages });
    }
  }
  return matches.sort(newestFirst)[0] ?? null;
}

// --- CLI ---
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  function flag(name) {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  }
  const root = flag("--root") ?? defaultRoot();

  if (args.includes("--list")) {
    process.stdout.write(JSON.stringify(listPage(await list(root), args), null, 2) + "\n");
  } else if (flag("--session")) {
    process.stdout.write(JSON.stringify(await session(root, flag("--session")), null, 2) + "\n");
  } else {
    process.stderr.write("usage: claude_code.mjs --list [--since ISO] [--limit N] [--offset N] | --session <id> [--root <dir>]\n");
    process.exit(2);
  }
}
