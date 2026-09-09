#!/usr/bin/env node
// Read-only cross-source selector. Never writes a cursor or memory store.
import { readFile } from "node:fs/promises";
import { list as claude } from "./claude_code.mjs";
import { list as pi } from "./pi.mjs";
import { list as codex } from "./codex.mjs";
import { selectSessions } from "./collector-state.mjs";

const args = process.argv.slice(2), opts = {}, liveIds = [];
const allowed = new Set(["--cursor", "--host", "--budget", "--now", "--limit", "--offset",
  "--claude-root", "--pi-root", "--codex-root", "--live-id"]);
for (let i = 0; i < args.length; i += 2) {
  const key = args[i], value = args[i + 1];
  if (!allowed.has(key) || value === undefined || value.startsWith("--")) throw Error(`invalid option: ${key}`);
  if (key === "--live-id") liveIds.push(value);
  else opts[key] = value;
}
const number = (key, fallback) => {
  const n = opts[key] === undefined ? fallback : Number(opts[key]);
  if (!Number.isSafeInteger(n) || n < 0) throw Error(`invalid ${key}`);
  return n;
};
const cursor = opts["--cursor"] ? JSON.parse(await readFile(opts["--cursor"], "utf8")) : {};
const host = opts["--host"];
const cursorHost = cursor.host ?? cursor._meta?.host;
if (cursorHost && cursorHost !== host) throw Error("--host must match cursor host");
if (process.env.PI_SESSION_ID) liveIds.push(`pi:${process.env.PI_SESSION_ID}`);
const entries = [
  ...await claude(opts["--claude-root"]),
  ...await pi(opts["--pi-root"] ? [opts["--pi-root"]] : undefined),
  ...await codex(opts["--codex-root"]),
];
const result = selectSessions(entries, cursor, { budget: number("--budget", 3),
  now: opts["--now"] ? Date.parse(opts["--now"]) : Date.now(), liveIds });
const compact = (s) => s && Object.fromEntries(["tool", "id", "firstMessageAt", "lastMessageAt",
  "lastModifiedAt", "messageCount", "userMessageCount", "revision", "fileVersion", "status", "reason"]
  .filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
const limit = number("--limit", 50), offset = number("--offset", 0);
if (!limit) throw Error("--limit must be positive");
const pages = Object.fromEntries(["skippedTrivial", "blocked"].map((key) => [key, {
  total: result[key].length, items: result[key].slice(offset, offset + limit).map(compact),
  nextOffset: offset + limit < result[key].length ? offset + limit : null,
}]));
console.log(JSON.stringify({ policy: "newest-first", readOnly: true, host, counts: result.counts,
  selected: result.selected.map(compact), remaining: result.remaining,
  oldestUnresolved: compact(result.oldestUnresolved), ...pages }, null, 2));
