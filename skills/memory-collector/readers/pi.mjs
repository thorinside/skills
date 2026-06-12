#!/usr/bin/env node
// Pi (and OMP) session reader — memory-collector skill
//
// Ported from Flare576/ei src/integrations/pi/reader.ts
// (MIT, © 2026 Jeremy Scherer). Dependency-free; Node >= 22.
//
// Sessions live in ~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl
// (also checks ~/.omp/agent/sessions). One improvement over upstream: the v3
// session-header entry ({"type":"session", "cwd": ...}) is used as the
// authoritative cwd — the directory-name encoding is lossy and is only a
// fallback.
//
// Usage:
//   node pi.mjs --list [--since <ISO>] [--root <sessionsDir>]
//   node pi.mjs --session <id> [--root <sessionsDir>]
//
// Output contract: see readers/README.md. Missing store => empty output, exit 0.

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const TOOL = "pi";

function defaultRoots() {
  const home = process.env.HOME || "~";
  return [join(home, ".pi", "agent", "sessions"), join(home, ".omp", "agent", "sessions")];
}

// Lossy fallback only — prefer the session-header cwd.
function decodeCwdDir(dirName) {
  const inner = dirName.replace(/^-+/, "").replace(/-+$/, "");
  return "/" + inner.replace(/-/g, "/");
}

function titleFromCwd(cwd) {
  if (!cwd) return "Unknown";
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

function uuidFromFilename(filename) {
  const base = filename.replace(/\.jsonl$/, "");
  const i = base.indexOf("_");
  return i === -1 ? null : base.slice(i + 1);
}

function extractText(content) {
  if (!content) return "";
  if (typeof content === "string") return content.trim();
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
  const entries = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

async function parseFile(uuid, dirCwd, filePath) {
  const entries = await readJsonl(filePath);
  const messages = [];
  let cwd = "";
  let firstTs = null;
  let lastTs = null;

  for (const entry of entries) {
    if (entry.type === "session" && typeof entry.cwd === "string") {
      cwd = entry.cwd; // authoritative
      continue;
    }
    if (entry.type !== "message" || typeof entry.message !== "object" || entry.message === null) continue;

    const role = entry.message.role;
    if (role !== "user" && role !== "assistant") continue;

    const content = extractText(entry.message.content);
    if (!content) continue;

    const ts = entry.timestamp;
    if (ts) {
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;
    }

    messages.push({
      id: `${uuid}/${entry.id}`,
      role,
      content,
      timestamp: ts ?? new Date(0).toISOString(),
    });
  }

  if (!firstTs || !lastTs || messages.length === 0) return null;
  messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return { sessionId: uuid, filePath, cwd: cwd || dirCwd, firstTs, lastTs, messages };
}

async function* sessionFiles(roots) {
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let cwdDirs;
    try {
      cwdDirs = await readdir(root);
    } catch {
      continue;
    }
    for (const dir of cwdDirs) {
      if (dir.startsWith(".")) continue;
      let files;
      try {
        files = await readdir(join(root, dir));
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const uuid = uuidFromFilename(f);
        if (!uuid) continue;
        yield { uuid, dirCwd: decodeCwdDir(dir), path: join(root, dir, f) };
      }
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

async function list(roots, since) {
  const out = [];
  for await (const { uuid, dirCwd, path } of sessionFiles(roots)) {
    const parsed = await parseFile(uuid, dirCwd, path);
    if (!parsed) continue;
    if (since && parsed.lastTs <= since) continue;
    out.push(toListEntry(parsed));
  }
  out.sort((a, b) => new Date(a.lastMessageAt) - new Date(b.lastMessageAt));
  return out;
}

async function session(roots, sessionId) {
  for await (const { uuid, dirCwd, path } of sessionFiles(roots)) {
    if (uuid !== sessionId) continue;
    const parsed = await parseFile(uuid, dirCwd, path);
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
const roots = flag("--root") ? [flag("--root")] : defaultRoots();

if (!roots.some((r) => existsSync(r))) {
  process.stdout.write(args.includes("--list") ? "[]\n" : "null\n");
  process.exit(0);
}

if (args.includes("--list")) {
  process.stdout.write(JSON.stringify(await list(roots, flag("--since")), null, 2) + "\n");
} else if (flag("--session")) {
  process.stdout.write(JSON.stringify(await session(roots, flag("--session")), null, 2) + "\n");
} else {
  process.stderr.write("usage: pi.mjs --list [--since ISO] | --session <id>  [--root <dir>]\n");
  process.exit(2);
}
