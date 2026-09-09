import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, utimes, mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, NOW, at } from "./fixtures.mjs";
import * as claude from "../claude_code.mjs";
import * as pi from "../pi.mjs";
import * as codex from "../codex.mjs";
import { conversationMetadata } from "../common.mjs";
import { selectSessions, checkpointWindow, completeSession, pendingMessages, resolution,
  windowKey, plantOnce, beginWindow, reconcileWindow, skipTrivial } from "../collector-state.mjs";

test("workflow envelope is pre-budget automation, substantive human follow-up defeats it", () => {
  const user = { id: "one", role: "user", timestamp: at("10:00"),
    content: 'You are a scheduled worker.\nSubstrate outcome protocol:\nSUBSTRATE_OUTCOME_V1={}' };
  const snapshot = { lastModifiedAt: at("10:00"), fileVersion: "fixture", stable: true };
  const s = { tool: "pi", id: "robot", lastMessageAt: at("10:00"), messageCount: 6,
    ...conversationMetadata([user], snapshot) };
  const r = selectSessions([s], {}, { now: NOW, budget: 1 });
  assert.equal(r.selected.length, 0);
  assert.equal(r.skippedTrivial.length, 1);
  assert.equal(conversationMetadata([user, { ...user, id: "two", content: "No, I want to discuss the design" }], snapshot).automation, false);
});

test("all-malformed files are blocked rather than hidden as empty; source bytes/DB remain read-only", async (t) => {
  const f = await fixture(); t.after(() => f.close());
  const dbPath = join(f.roots.codex, "state_5.sqlite");
  const dbBefore = await readFile(dbPath);
  for (const [tool, reader, id] of [["pi", pi, "newest"], ["claudecode", claude, "a-tie"], ["codex", codex, "robot"]]) {
    const root = tool === "pi" ? [f.roots.pi] : f.roots[tool];
    const original = await readFile(f.paths[id]);
    await reader.list(root);
    assert.deepEqual(await readFile(f.paths[id]), original);
    await writeFile(f.paths[id], "{invalid\nnull\n");
    await utimes(f.paths[id], new Date(at("09:00")), new Date(at("09:00")));
    const rows = await reader.list(root);
    const row = rows.find((s) => s.id === id);
    assert.equal(row.parseComplete, false);
    assert.equal(selectSessions([row], {}, { now: NOW }).blocked.length, 1);
  }
  assert.deepEqual(await readFile(dbPath), dbBefore);
});

test("message spans compare instants rather than lexicographic timezone strings", async (t) => {
  const f = await fixture(); t.after(() => f.close());
  for (const [tool, reader, id] of [["pi", pi, "newest"], ["claudecode", claude, "a-tie"]]) {
    const path = f.paths[id];
    const records = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
    const messages = records.filter((r) => r.type !== "session");
    messages[0].timestamp = "2026-09-09T15:00:00+09:00"; // 06:00 UTC, lexicographically largest
    messages.at(-1).timestamp = "2026-09-09T08:00:00-03:00"; // 11:00 UTC, true last
    await writeFile(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    await utimes(path, new Date(at("11:00")), new Date(at("11:00")));
    const root = tool === "pi" ? [f.roots.pi] : f.roots[tool];
    const s = await reader.session(root, id);
    assert.equal(Date.parse(s.firstMessageAt), Date.parse(at("06:00")));
    assert.equal(Date.parse(s.lastMessageAt), Date.parse(at("11:00")));
  }
});

test("conversion selects the same duplicate Pi/OMP and Claude identity as metadata selection", async (t) => {
  const sessions = [{ tool: "pi", id: "duplicate", date: at("08:00") },
    { tool: "claudecode", id: "duplicate", date: at("08:00") }];
  const first = await fixture({ sessions }); t.after(() => first.close());
  const second = await fixture({ sessions: sessions.map((s) => ({ ...s, date: at("10:00") })) });
  t.after(() => second.close());
  const roots = [first.roots.pi, second.roots.pi];
  const row = selectSessions(await pi.list(roots), {}, { now: NOW }).selected[0];
  const converted = await pi.session(roots, "duplicate");
  assert.equal(converted.lastMessageAt, at("10:00"));
  assert.equal(converted.fileVersion, row.fileVersion);
  assert.equal(converted.revision, row.revision);
  assert.equal((await pi.session([...roots].reverse(), "duplicate")).fileVersion, row.fileVersion);
  const dir = join(first.roots.claudecode, "z-copy"); await mkdir(dir);
  const copy = join(dir, "duplicate.jsonl");
  await copyFile(second.paths.duplicate, copy); await utimes(copy, new Date(at("10:00")), new Date(at("10:00")));
  const claudeRow = selectSessions(await claude.list(first.roots.claudecode), {}, { now: NOW }).selected[0];
  assert.equal((await claude.session(first.roots.claudecode, "duplicate")).fileVersion, claudeRow.fileVersion);
  // Equal timestamp copies use the same path tie-break, independent of traversal.
  await first.put({ tool: "pi", id: "duplicate", date: at("10:00") });
  const tied = selectSessions(await pi.list(roots), {}, { now: NOW }).selected[0];
  assert.equal((await pi.session([...roots].reverse(), "duplicate")).fileVersion, tied.fileVersion);
});

test("legacy prefix is baselined once; a later same-time correction is pending after V2 completion", async (t) => {
  const f = await fixture(); t.after(() => f.close());
  const before = await pi.session([f.roots.pi], "newest");
  const legacy = { pi: { processed: { newest: { lastMessageAt: before.messages[1].timestamp,
    memoryIds: ["old-item"] } }, highWater: at("11:00") } };
  let cursor = checkpointWindow(legacy, before, before, pendingMessages(legacy, before), [], NOW);
  cursor = completeSession(cursor, before, before, { eventsComplete: true, now: NOW });
  assert.equal(cursor.collectorV2.sources.pi.sessions.newest.legacyBaseline, true);
  assert.deepEqual(cursor.pi, legacy.pi);
  const text = (await readFile(f.paths.newest, "utf8")).replace("Human design conversation 0", "Corrected historical decision");
  await writeFile(f.paths.newest, text); await utimes(f.paths.newest, new Date(at("10:00")), new Date(at("10:00")));
  const changed = await pi.session([f.roots.pi], "newest");
  assert.equal(resolution(cursor, changed), "changed");
  assert.equal(pendingMessages(cursor, changed).length, 1);
  assert.equal(pendingMessages(cursor, changed)[0].id, before.messages[0].id);
  assert.throws(() => completeSession(cursor, changed, changed, { eventsComplete: true, now: NOW }), /not fully/);
  cursor = checkpointWindow(cursor, changed, changed, pendingMessages(cursor, changed), ["updated-old-item"], NOW);
  cursor = completeSession(cursor, changed, changed, { eventsComplete: true, now: NOW });
  assert.equal(pendingMessages(cursor, changed).length, 0);
});

test("A to B to A restoration is new work, while retry operation keys stay stable", async (t) => {
  const f = await fixture(); t.after(() => f.close());
  const original = await pi.session([f.roots.pi], "newest");
  const edited = { ...original, revision: "edited-B", messages: original.messages.map((m, i) =>
    i ? m : { ...m, content: "Correction B" }) };
  let cursor = {}, storedContent, writes = 0;
  const operations = new Map();
  const store = { find: async (key) => operations.get(key),
    write: async (key, record) => { writes++; storedContent = record.content; operations.set(key, "same-matched-item"); return "same-matched-item"; },
    verify: async (id, key) => assert.equal(operations.get(key), id) };
  const keys = [];
  for (const s of [original, edited, original]) {
    const pending = pendingMessages(cursor, s);
    assert.ok(pending.some((m) => m.id === original.messages[0].id));
    const key = windowKey("test", s, [pending[0]], cursor);
    keys.push(key);
    cursor = beginWindow(cursor, s, s, pending, key, `plan-${key}`, NOW);
    const context = { cursor, session: s, planKey: key };
    const receipt = await plantOnce(store, key, { content: pending[0].content }, context);
    await plantOnce(store, key, { content: pending[0].content }, context); // retry, not another update
    cursor = reconcileWindow(cursor, s, key, [receipt]);
    cursor = checkpointWindow(cursor, s, s, pending, [], NOW);
    assert.equal(windowKey("test", s, [pending[0]], cursor), key);
    cursor = completeSession(cursor, s, s, { eventsComplete: true, now: NOW });
    assert.equal(storedContent, s.messages[0].content);
  }
  assert.equal(writes, 3);
  assert.equal(new Set(keys).size, 3);
  assert.equal(cursor.collectorV2.sources.pi.sessions.newest.messageKeys.length, 4);
  assert.equal(pendingMessages(cursor, original).length, 0);
});

test("lost B write followed by source restoration to acknowledged A cannot hide the pending correction", async (t) => {
  const f = await fixture(); t.after(() => f.close());
  const a = await pi.session([f.roots.pi], "newest");
  const b = { ...a, revision: "B", messages: a.messages.map((m, i) => i ? m : { ...m, content: "B" }) };
  const originalKey = windowKey("test", a, [a.messages[0]], {});
  let cursor = completeSession(checkpointWindow({}, a, a, a.messages, [], NOW), a, a, { eventsComplete: true, now: NOW });
  const bKey = windowKey("test", b, [b.messages[0]], cursor);
  cursor = beginWindow(cursor, b, b, [b.messages[0]], bKey, "persisted-plan-B", NOW);
  const writes = new Map(); let stored = "A", count = 0;
  const store = { find: async (key) => writes.get(key),
    write: async (key, record) => { stored = record.content; count++; writes.set(key, "matched-item");
      if (key === bKey) throw Error("reply lost"); return "matched-item"; },
    verify: async (id, key) => assert.equal(writes.get(key), id) };
  await assert.rejects(plantOnce(store, bKey, { content: "B" }, { cursor, session: b, planKey: bKey }), /reply lost/);
  assert.equal(stored, "B");
  // Source has reverted to A, but B's intent was durably saved before its write.
  assert.equal(resolution(cursor, a), "resume");
  assert.equal(pendingMessages(cursor, a).length, 1);
  assert.throws(() => completeSession(cursor, a, a, { eventsComplete: true, now: NOW }), /not fully/);
  assert.throws(() => skipTrivial(cursor, a, a, "hypothetical", NOW), /pending writes/);
  const found = await store.find(bKey); await store.verify(found, bKey);
  cursor = reconcileWindow(cursor, a, bKey, [found]); // no replay of superseded B
  const aKey = windowKey("test", a, [a.messages[0]], cursor);
  assert.notEqual(aKey, originalKey);
  cursor = beginWindow(cursor, a, a, [a.messages[0]], aKey, "persisted-plan-restored-A", NOW);
  const receipt = await plantOnce(store, aKey, { content: "A" }, { cursor, session: a, planKey: aKey });
  cursor = reconcileWindow(cursor, a, aKey, [receipt]);
  cursor = checkpointWindow(cursor, a, a, [a.messages[0]], [], NOW);
  cursor = completeSession(cursor, a, a, { eventsComplete: true, now: NOW });
  assert.equal(stored, "A"); assert.equal(count, 2);
  assert.equal(resolution(cursor, a), "completed");
  assert.equal(cursor.collectorV2.sources.pi.sessions.newest.reconciledPlans.length, 2);
});
