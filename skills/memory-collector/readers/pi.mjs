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

import { readdir } from "node:fs/promises";
import { readSnapshot, conversationMetadata, newestFirst, isMain, listPage } from "./common.mjs";
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
  const snapshot = await readSnapshot(filePath);
  const entries = [];
  let parseComplete = true;
  for (const line of snapshot.text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (!entry || typeof entry !== "object") { parseComplete = false; continue; }
      entries.push(entry);
    } catch {
      parseComplete = false;
    }
  }
  return { entries, snapshot, parseComplete };
}

async function parseFile(uuid, dirCwd, filePath) {
  const { entries, snapshot, parseComplete } = await readJsonl(filePath);
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
      if (!firstTs || Date.parse(ts) < Date.parse(firstTs)) firstTs = ts;
      if (!lastTs || Date.parse(ts) > Date.parse(lastTs)) lastTs = ts;
    }

    messages.push({
      id: `${uuid}/${entry.id}`,
      role,
      content,
      timestamp: ts ?? new Date(0).toISOString(),
    });
  }

  if (!firstTs || !lastTs || messages.length === 0) {
    if (parseComplete) return null;
    firstTs = lastTs = snapshot.lastModifiedAt;
  }
  messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return { sessionId: uuid, filePath, cwd: cwd || dirCwd, firstTs, lastTs, messages,
    metadata: conversationMetadata(messages, snapshot, parseComplete) };
}

async function* sessionFiles(roots) {
  for (const root of roots) {
    let cwdDirs;
    try {
      cwdDirs = await readdir(root);
    } catch (err) {
      if (err.code === "ENOENT") continue;
      throw err;
    }
    for (const dir of cwdDirs) {
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
    ...parsed.metadata,
  };
}

export async function list(roots = defaultRoots(), since) {
  const out = [];
  for await (const { uuid, dirCwd, path } of sessionFiles(roots)) {
    const parsed = await parseFile(uuid, dirCwd, path);
    if (!parsed) continue;
    if (since && Date.parse(parsed.lastTs) <= Date.parse(since)) continue;
    out.push(toListEntry(parsed));
  }
  out.sort(newestFirst);
  return out;
}

export async function session(roots = defaultRoots(), sessionId) {
  for await (const { uuid, dirCwd, path } of sessionFiles(roots)) {
    if (uuid !== sessionId) continue;
    const parsed = await parseFile(uuid, dirCwd, path);
    if (!parsed) return null;
    return { ...toListEntry(parsed), messages: parsed.messages };
  }
  return null;
}

// --- CLI ---
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  function flag(name) {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  }
  const roots = flag("--root") ? [flag("--root")] : defaultRoots();

  if (args.includes("--list")) {
    process.stdout.write(JSON.stringify(listPage(await list(roots), args), null, 2) + "\n");
  } else if (flag("--session")) {
    process.stdout.write(JSON.stringify(await session(roots, flag("--session")), null, 2) + "\n");
  } else {
    process.stderr.write("usage: pi.mjs --list [--since ISO] [--limit N] [--offset N] | --session <id> [--root <dir>]\n");
    process.exit(2);
  }
}
