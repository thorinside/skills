// Shared, read-only reader metadata. No transcript text in selection output.
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const messageKey = (m) => hash([m.id, m.role, m.timestamp, m.content]);
export const isMain = (url) => process.argv[1] && pathToFileURL(process.argv[1]).href === url;
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const newestFirst = (a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt)
  || compareText(a.tool, b.tool) || compareText(a.id, b.id) || compareText(a.path ?? "", b.path ?? "");
export const fileVersion = (s) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;

export async function readSnapshot(path) {
  const before = await stat(path);
  const text = await readFile(path, "utf8");
  const after = await stat(path);
  return { text, lastModifiedAt: after.mtime.toISOString(), fileVersion: fileVersion(after),
    stable: fileVersion(before) === fileVersion(after) };
}

export function conversationMetadata(messages, snapshot, parseComplete = true) {
  const users = messages.filter((m) => m.role === "user");
  // Deliberately narrow. Unknown job templates still need the agent's pre-budget
  // human-conversation check; an actual human follow-up defeats this shortcut.
  const machinePrompt = /^(?:Run one (?:collection|gardening) pass\b|You are (?:an? )?(?:approval assessor|Substrate runner)\b|\[Substrate (?:job|workflow)\])/i;
  const workflowEnvelope = (text) => /^You are\b/.test(text)
    && /Substrate (?:semantic outcome contract|outcome protocol):/.test(text)
    && text.includes("SUBSTRATE_OUTCOME_V1=");
  const automation = users.length > 0 && users.every((m) =>
    machinePrompt.test(m.content.trim()) || workflowEnvelope(m.content.trim()));
  return { revision: hash(messages.map(messageKey)), lastModifiedAt: snapshot.lastModifiedAt,
    fileVersion: snapshot.fileVersion, stable: snapshot.stable,
    parseComplete: parseComplete && messages.every((m) => m.id && Number.isFinite(Date.parse(m.timestamp))),
    userMessageCount: users.length, automation };
}

export function listPage(entries, args) {
  const value = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const since = value("--since");
  if (args.includes("--since") && !Number.isFinite(Date.parse(since))) throw Error("--since requires an ISO timestamp");
  const integer = (name, fallback) => {
    const raw = value(name);
    const n = raw === undefined && !args.includes(name) ? fallback : Number(raw);
    if (!Number.isSafeInteger(n) || n < 0) throw Error(`${name} requires a nonnegative integer`);
    return n;
  };
  const offset = integer("--offset", 0), limit = integer("--limit", entries.length);
  return entries.filter((s) => !since || Date.parse(s.lastMessageAt) > Date.parse(since))
    .sort(newestFirst).slice(offset, offset + limit);
}
