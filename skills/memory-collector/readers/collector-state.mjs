// Pure cursor transitions; callers persist/read back through their memory store.
// Legacy fields are never rewritten, compacted, or treated as a traversal fence.
import { hash, messageKey, newestFirst } from "./common.mjs";

const source = (cursor, tool) => (cursor.sources ?? cursor)[tool] ?? {};
const state = (cursor, s) => cursor.collectorV2?.sources?.[s.tool]?.sessions?.[s.id];
const time = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
const find = (map, id) => Array.isArray(map)
  ? map.find((v) => (typeof v === "string" ? v : v.id) === id)
  : Object.hasOwn(map ?? {}, id) ? map[id] : undefined;

export function legacyRecord(cursor, s) {
  const src = source(cursor, s.tool);
  for (const name of ["processed", "skippedTrivial", "skipped_trivial", "skipped-trivial"]) {
    const value = find(src[name], s.id);
    if (value === undefined) continue;
    const cutoff = typeof value === "string" ? time(value)
      : time(value.lastMessageAt) ?? time(value.processedAt) ?? time(value.skippedAt) ?? time(value.at);
    return { status: name === "processed" ? "processed" : "skipped-trivial", cutoff, value };
  }
  return null;
}

export function resolution(cursor, s) {
  const current = state(cursor, s);
  if (current) {
    if (current.revision === s.revision && ["processed", "skipped-trivial"].includes(current.status)) return "completed";
    return current.status === "partial" ? "resume" : "changed";
  }
  const legacy = legacyRecord(cursor, s);
  if (!legacy) return "new";
  if (legacy.cutoff === null) return "legacy-review"; // no invented completion boundary
  return Date.parse(s.lastMessageAt) > legacy.cutoff ? "legacy-changed" : "completed";
}

export function isLive(s, now = Date.now(), liveIds = []) {
  return s.stable !== true || s.live === true || liveIds.includes(`${s.tool}:${s.id}`)
    || !Number.isFinite(Date.parse(s.lastModifiedAt))
    || Math.max(Date.parse(s.lastModifiedAt), Date.parse(s.lastMessageAt)) >= now - 30 * 60_000;
}

export function selectSessions(entries, cursor = {}, { budget = 3, now = Date.now(), liveIds = [] } = {}) {
  if (!Number.isSafeInteger(budget) || budget < 0 || !Number.isFinite(now)) throw Error("invalid budget/now");
  const selected = [], skippedTrivial = [], deferred = [], blocked = [];
  const counts = { found: 0, live: 0, completed: 0, trivial: 0, blocked: 0, eligible: 0 };
  const seen = new Set();
  const liveKeys = new Set(entries.filter((s) => isLive(s, now, liveIds)).map((s) => `${s.tool}:${s.id}`));
  for (const s of [...entries].sort(newestFirst)) {
    const key = `${s.tool}:${s.id}`;
    if (seen.has(key)) continue; // same source ID in Pi/OMP copies: newest, then path tie-break
    seen.add(key);
    counts.found++;
    if (liveKeys.has(key)) { counts.live++; continue; }
    if (!s.parseComplete || !s.revision || !Number.isFinite(Date.parse(s.lastMessageAt))) {
      blocked.push({ ...s, reason: "unreadable-or-invalid" }); counts.blocked++; continue;
    }
    const status = resolution(cursor, s);
    if (status === "completed") { counts.completed++; continue; }
    if (status === "legacy-review") { blocked.push({ ...s, reason: status }); counts.blocked++; continue; }
    if (s.messageCount < 4 || s.userMessageCount === 0 || s.automation) {
      skippedTrivial.push({ ...s, reason: s.automation ? "automation" : "tiny-or-no-human" });
      counts.trivial++; continue;
    }
    counts.eligible++;
    const candidate = { ...s, status };
    if (selected.length < budget) selected.push(candidate);
    else deferred.push(candidate);
  }
  return { selected, skippedTrivial, blocked, counts, remaining: deferred.length,
    oldestUnresolved: [...selected, ...deferred].at(-1) ?? null };
}

function update(cursor, s, fields) {
  const next = structuredClone(cursor);
  next.collectorV2 ??= { version: 2, policy: "newest-first", sources: {} };
  next.collectorV2.sources[s.tool] ??= { sessions: {} };
  const sessions = next.collectorV2.sources[s.tool].sessions;
  sessions[s.id] = { ...sessions[s.id], ...fields };
  return next;
}

export function assertStable(before, after, now = Date.now()) {
  if (!after || before.tool !== after.tool || before.id !== after.id
    || before.revision !== after.revision || before.fileVersion !== after.fileVersion
    || !after.parseComplete || isLive(after, now)) throw Error("source changed, live, or unreadable; leave unresolved");
}

export function pendingMessages(cursor, s) {
  const current = state(cursor, s);
  const done = new Set(current?.messageKeys ?? []);
  const legacy = legacyRecord(cursor, s);
  if (legacy?.status === "processed" && legacy.cutoff === null) throw Error("legacy provenance reconciliation required");
  // Use the legacy time boundary only until a stable read establishes prefix
  // fingerprints. After that, even same-timestamp edits must be reconsidered.
  return s.messages.filter((m) => !done.has(messageKey(m))
    && !(legacy?.status === "processed" && !current?.legacyBaseline
      && Date.parse(m.timestamp) <= legacy.cutoff));
}

function acknowledgedProgress(cursor, s) {
  const previous = state(cursor, s) ?? {};
  const legacy = legacyRecord(cursor, s);
  const establishBaseline = !previous.legacyBaseline && legacy?.status === "processed"
    && legacy.cutoff !== null && Array.isArray(s.messages);
  const prefixKeys = establishBaseline
    ? s.messages.filter((m) => Date.parse(m.timestamp) <= legacy.cutoff).map(messageKey) : [];
  return { messageKeys: [...new Set([...(previous.messageKeys ?? []), ...prefixKeys])],
    ...(previous.legacyBaseline || establishBaseline ? { legacyBaseline: true } : {}) };
}

export function windowKey(host, s, messages, pipeline = "window") {
  return hash([host, s.tool, s.id, pipeline, messages.map(messageKey)]);
}

export function checkpointWindow(cursor, before, after, messages, receipts, now = Date.now()) {
  assertStable(before, after, now);
  const pending = new Set(pendingMessages(cursor, before).map(messageKey));
  if (!messages.length || messages.some((m) => !pending.has(messageKey(m)))) throw Error("window is not pending");
  if (!Array.isArray(receipts)) throw Error("verified receipt list required (empty for empty extraction)");
  const previous = state(cursor, before) ?? {};
  const progress = acknowledgedProgress(cursor, before);
  return update(cursor, before, { ...progress, status: "partial", revision: before.revision,
    lastMessageAt: before.lastMessageAt,
    messageKeys: [...new Set([...progress.messageKeys, ...messages.map(messageKey)])],
    receipts: [...(previous.receipts ?? []), ...receipts] });
}

export function completeSession(cursor, before, after, { eventsComplete = false, now = Date.now() } = {}) {
  assertStable(before, after, now);
  if (!eventsComplete || pendingMessages(cursor, before).length) throw Error("session is not fully processed");
  return update(cursor, before, { ...acknowledgedProgress(cursor, before), status: "processed", revision: before.revision,
    lastMessageAt: before.lastMessageAt, resolvedAt: new Date(now).toISOString() });
}

export function skipTrivial(cursor, before, after, reason, now = Date.now()) {
  assertStable(before, after, now);
  if (!reason?.trim()) throw Error("trivial reason required");
  return update(cursor, before, { ...acknowledgedProgress(cursor, before), status: "skipped-trivial", revision: before.revision,
    lastMessageAt: before.lastMessageAt, reason, resolvedAt: new Date(now).toISOString() });
}

// Store adapter contract: find must exhaustively reconcile a durable operation
// key (including a prior write whose response was lost); read must verify both
// provenance and credential filtering. Single collector per host, no blind retries.
export async function plantOnce(store, operationKey, sanitizedRecord) {
  const found = await store.find(operationKey);
  const id = found ?? await store.write(operationKey, sanitizedRecord);
  await store.verify(id, operationKey);
  return id;
}
