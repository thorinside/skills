import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { fixture, NOW, at } from "./fixtures.mjs";
import * as claude from "../claude_code.mjs";
import * as pi from "../pi.mjs";
import * as codex from "../codex.mjs";
import { conversationMetadata } from "../common.mjs";
import { selectSessions } from "../collector-state.mjs";

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
