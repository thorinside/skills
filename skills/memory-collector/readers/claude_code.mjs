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

import { readdir, readFile, access } from "node:fs/promises";
import { join } from "node:path";

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
  let text;
  try {
    text = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }
  const records = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  }
  return records;
}

// One pass over a session file: messages (text-only), span, cwd.
async function parseFile(sessionId, filePath) {
  const records = await readJsonl(filePath);
  const messages = [];
  let firstTs = null;
  let lastTs = null;
  let cwd = "";

  for (const record of records) {
    if (record.type !== "user" && record.type !== "assistant") continue;
    const ts = record.timestamp;
    if (ts) {
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;
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

  if (!firstTs || !lastTs) return null;
  messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return { sessionId, filePath, cwd, firstTs, lastTs, messages };
}

async function* sessionFiles(root) {
  let projectDirs;
  try {
    projectDirs = await readdir(root);
  } catch {
    return;
  }
  for (const dir of projectDirs) {
    if (dir.startsWith(".")) continue;
    let files;
    try {
      files = await readdir(join(root, dir));
    } catch {
      continue;
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
  };
}

async function list(root, since) {
  const out = [];
  for await (const { id, path } of sessionFiles(root)) {
    const parsed = await parseFile(id, path);
    if (!parsed || parsed.messages.length === 0) continue;
    if (since && parsed.lastTs <= since) continue;
    out.push(toListEntry(parsed));
  }
  out.sort((a, b) => new Date(a.lastMessageAt) - new Date(b.lastMessageAt));
  return out;
}

async function session(root, sessionId) {
  for await (const { id, path } of sessionFiles(root)) {
    if (id !== sessionId) continue;
    const parsed = await parseFile(id, path);
    if (!parsed) return null;
    return { ...toListEntry(parsed), messages: parsed.messages };
  }
  return null;
}

// --- CLI ---
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}
const root = flag("--root") ?? defaultRoot();

try {
  await access(root);
} catch {
  process.stdout.write(args.includes("--list") ? "[]\n" : "null\n");
  process.exit(0);
}

if (args.includes("--list")) {
  process.stdout.write(JSON.stringify(await list(root, flag("--since")), null, 2) + "\n");
} else if (flag("--session")) {
  process.stdout.write(JSON.stringify(await session(root, flag("--session")), null, 2) + "\n");
} else {
  process.stderr.write("usage: claude_code.mjs --list [--since ISO] | --session <id>  [--root <dir>]\n");
  process.exit(2);
}
