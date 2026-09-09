import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, appendFile, utimes } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { fixture, NOW, at, specs } from "./fixtures.mjs";
import * as claude from "../claude_code.mjs";
import * as pi from "../pi.mjs";
import * as codex from "../codex.mjs";
import { messageKey, newestFirst } from "../common.mjs";
import { selectSessions, checkpointWindow, completeSession, skipTrivial, pendingMessages,
  windowKey, plantOnce, resolution, beginWindow, reconcileWindow } from "../collector-state.mjs";

const readers = fileURLToPath(new URL("../", import.meta.url));
const scripts = { claudecode: "claude_code", pi: "pi", codex: "codex" };
const cli = (script, args) => JSON.parse(execFileSync(process.execPath, [join(readers, `${script}.mjs`), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const list = async (f) => [...await claude.list(f.roots.claudecode), ...await pi.list([f.roots.pi]), ...await codex.list(f.roots.codex)];
const options = { now: NOW, budget: 3 };
const legacy = { host: "test", sources: { pi: { highWater: at("11:00"),
  processed: { done: { lastMessageAt: at("08:00"), memoryIds: ["preserve-me"] } }, skippedTrivial: {} } } };
async function setup(t, opts) { const f = await fixture(opts); t.after(() => f.close()); return f; }
async function finish(cursor, f, row) {
  const mod = { pi, claudecode: claude, codex }[row.tool];
  const root = row.tool === "pi" ? [f.roots.pi] : f.roots[row.tool];
  const s = await mod.session(root, row.id);
  let next = checkpointWindow(cursor, s, s, pendingMessages(cursor, s), [], NOW);
  return completeSession(next, s, s, { eventsComplete: true, now: NOW });
}

test("actual CLIs: newest-first mixed sources, ties, pre-budget guards, bounded private-free selection", async (t) => {
  const f = await setup(t);
  const path = join(f.root, "cursor.json");
  const original = JSON.stringify(legacy);
  await writeFile(path, original);
  const args = ["--cursor", path, "--host", "test", "--now", new Date(NOW).toISOString(), "--budget", "3",
    "--claude-root", f.roots.claudecode, "--pi-root", f.roots.pi, "--codex-root", f.roots.codex, "--limit", "1"];
  const r = cli("select", args);
  assert.deepEqual(r.selected.map((s) => s.id), ["newest", "a-tie", "b-tie"]);
  assert.deepEqual(r.counts, { found: 9, live: 1, completed: 1, trivial: 2, blocked: 0, eligible: 5 });
  assert.equal(r.oldestUnresolved.id, "hole");
  assert.equal(r.skippedTrivial.items.length, 1);
  assert.equal(r.skippedTrivial.nextOffset, 1);
  assert.equal(cli("select", [...args, "--offset", "1"]).skippedTrivial.items[0].id, "robot");
  assert.equal(await readFile(path, "utf8"), original);
  assert.doesNotMatch(JSON.stringify(r), /private-title|Human design|private-opening|messages|cwd/);
  assert.throws(() => cli("select", [...args, "--host", "wrong"]));
  assert.throws(() => cli("select", [...args, "--since", at("08:00")]));
});

test("reader --since is exclusive by parsed time, supports zones and stale/seconds-only Codex DB", async (t) => {
  const f = await setup(t, { milliseconds: false });
  for (const [tool, script] of Object.entries(scripts)) {
    const args = ["--list", "--root", f.roots[tool]];
    const all = cli(script, args);
    assert.deepEqual(all, [...all].sort(newestFirst));
    const filtered = cli(script, [...args, "--since", "2026-09-09T04:00:00-05:00"]);
    assert.deepEqual(filtered.map((s) => s.id), all.filter((s) => Date.parse(s.lastMessageAt) > Date.parse(at("09:00"))).map((s) => s.id));
    assert.deepEqual(cli(script, [...args, "--offset", "1", "--limit", "1"]), all.slice(1, 2));
    assert.throws(() => cli(script, [...args, "--since", "invalid"]));
  }
  assert.ok(cli("codex", ["--list", "--root", f.roots.codex, "--since", at("09:00")]).some((s) => s.id === "robot"));
});

test("budget exhaustion, backward progress, new arrivals, and old holes below highWater", async (t) => {
  const f = await setup(t);
  const before = structuredClone(legacy);
  let cursor = structuredClone(legacy);
  const first = selectSessions(await list(f), cursor, options);
  for (const row of first.selected) cursor = await finish(cursor, f, row);
  const second = selectSessions(await list(f), cursor, options);
  assert.deepEqual(second.selected.map((s) => s.id), ["z-tie", "hole"]);
  await f.put({ tool: "pi", id: "arrival", date: at("11:00") });
  assert.deepEqual(selectSessions(await list(f), cursor, options).selected.map((s) => s.id), ["arrival", "z-tie", "hole"]);
  assert.deepEqual(cursor.sources, before.sources);
  assert.equal(selectSessions(await list(f), cursor, { ...options, budget: 0 }).remaining, 3);
});

test("Mac and dev legacy maps/arrays retained; unresolved low holes and old live records not fenced", async (t) => {
  const f = await setup(t);
  const rows = await list(f);
  const dev = { _meta: { host: "dev" }, pi: { processed: { done: at("08:10") },
    skipped_trivial: [{ id: "tiny", at: at("10:50"), reason: "tiny" }],
    skipped_live: [{ id: "hole", at: "2026-01-01T00:00:00Z" }], high_water_mark: at("11:00") } };
  const frozen = structuredClone(dev);
  const r = selectSessions(rows, dev, options);
  assert.equal(r.counts.completed, 2);
  assert.equal(r.oldestUnresolved.id, "hole");
  const next = await finish(dev, f, r.selected[0]);
  assert.deepEqual(next.pi, frozen.pi);
  assert.deepEqual(next._meta, frozen._meta);
  assert.equal(resolution({ pi: { processed: { done: {} } } }, rows.find((s) => s.id === "done")), "legacy-review");
});

test("live guard uses mtime and explicit active ID before trivial/completed classification", async (t) => {
  const f = await setup(t);
  await utimes(f.paths.tiny, new Date(NOW), new Date(NOW));
  const r = selectSessions(await list(f), legacy, { ...options, liveIds: ["pi:done"] });
  assert.equal(r.counts.live, 3);
  assert.equal(r.counts.completed, 0);
  assert.ok(!r.skippedTrivial.some((s) => s.id === "tiny"));
});

test("partial failure stays unresolved; only acknowledged windows resume; no duplicate replant after lost reply", async (t) => {
  const f = await setup(t);
  const s = await pi.session([f.roots.pi], "newest");
  const store = new Map(); let writes = 0, loseReply = true;
  const adapter = { find: async (key) => store.get(key)?.id,
    write: async (key, record) => { writes++; store.set(key, { id: "receipt-1", record });
      if (loseReply) { loseReply = false; throw Error("lost response after write"); } return "receipt-1"; },
    verify: async (id, key) => assert.equal(store.get(key)?.id, id) };
  const window = s.messages.slice(0, 2), key = windowKey("test", s, window, {});
  await assert.rejects(plantOnce(adapter, key, {}), /beginWindow/);
  const intent = beginWindow({}, s, s, window, key, "persisted-plan", NOW);
  const context = { cursor: intent, session: s, planKey: key };
  await assert.rejects(plantOnce(adapter, key, { source: "pi:test:newest" }, context), /lost response/);
  const receipt = await plantOnce(adapter, key, { source: "pi:test:newest" }, context);
  assert.equal(writes, 1);
  const reconciled = reconcileWindow(intent, s, key, [receipt]);
  const partial = checkpointWindow(reconciled, s, s, window, [], NOW);
  assert.equal(resolution(partial, s), "resume");
  assert.deepEqual(pendingMessages(partial, s), s.messages.slice(2));
  assert.throws(() => completeSession(partial, s, s, { eventsComplete: true, now: NOW }), /not fully/);
  const completed = completeSession(checkpointWindow(partial, s, s, s.messages.slice(2), [], NOW), s, s, { eventsComplete: true, now: NOW });
  assert.equal(resolution(completed, s), "completed");
  assert.equal(pendingMessages(completed, s).length, 0);
});

test("reopened/edited sources use revisions and message receipts, recheck refuses concurrent mutation", async (t) => {
  const f = await setup(t);
  const s = await pi.session([f.roots.pi], "newest");
  const cursor = await finish({}, f, s);
  await f.put({ tool: "pi", id: "newest", date: at("11:00"), count: 6 });
  const after = await pi.session([f.roots.pi], "newest");
  assert.equal(resolution(cursor, after), "changed");
  assert.throws(() => checkpointWindow({}, s, after, s.messages, [], NOW), /source changed/);
  // Append preserving all previous message IDs/times: only the new tail is pending.
  const appended = { ...s, revision: "new-revision", messages: [...s.messages,
    { id: "tail", role: "user", content: "A real follow-up", timestamp: at("11:00") }] };
  assert.deepEqual(pendingMessages(cursor, appended).map((m) => m.id), ["tail"]);
  const edited = { ...s, revision: "edited", messages: s.messages.map((m, i) => i ? m : { ...m, content: "Corrected decision" }) };
  assert.equal(pendingMessages(cursor, edited).length, 1);
  assert.notEqual(messageKey(edited.messages[0]), messageKey(s.messages[0]));
});

test("legacy reopened processed session does not replay historical prefix; trivial can become human", async (t) => {
  const f = await setup(t);
  const s = await pi.session([f.roots.pi], "newest");
  const cursor = { pi: { processed: { newest: { lastMessageAt: s.messages[1].timestamp } } } };
  assert.equal(resolution(cursor, s), "legacy-changed");
  assert.deepEqual(pendingMessages(cursor, s), s.messages.slice(2));
  const tiny = await pi.session([f.roots.pi], "tiny");
  const skipped = skipTrivial({}, tiny, tiny, "tiny", NOW);
  await f.put({ tool: "pi", id: "tiny", date: at("11:00"), count: 6 });
  const changed = await pi.session([f.roots.pi], "tiny");
  assert.equal(resolution(skipped, changed), "changed");
  assert.equal(pendingMessages(skipped, changed).length, 6);
});

test("malformed transcript never resolves; conversions preserve text-only provenance IDs", async (t) => {
  const f = await setup(t);
  for (const tool of Object.keys(scripts)) {
    const spec = specs.find((s) => s.tool === tool && s.id !== "live");
    const s = cli(scripts[tool], ["--session", spec.id, "--root", f.roots[tool]]);
    assert.ok(s.messages.every((m) => m.id && ["user", "assistant"].includes(m.role)));
    assert.doesNotMatch(JSON.stringify(s.messages), /not-conversation/);
    await appendFile(f.paths[spec.id], "{broken\n");
    await utimes(f.paths[spec.id], new Date(spec.date), new Date(spec.date));
    const broken = cli(scripts[tool], ["--session", spec.id, "--root", f.roots[tool]]);
    assert.equal(broken.parseComplete, false);
    assert.equal(selectSessions([broken], {}, options).blocked.length, 1);
  }
});

test("deterministic source/id/path ties and duplicate Pi/OMP identity", async (t) => {
  const f = await setup(t);
  const rows = await list(f);
  const selected = selectSessions(rows, legacy, options).selected;
  for (let i = 0; i < 5; i++) {
    rows.reverse();
    assert.deepEqual(selectSessions(rows, legacy, options).selected, selected);
  }
  assert.equal(selectSessions([...rows, ...rows], legacy, options).counts.found, rows.length);
  const duplicate = { ...selected[0], path: "z-later-path", lastModifiedAt: new Date(NOW).toISOString() };
  assert.ok(!selectSessions([...rows, duplicate], legacy, options).selected.some((s) => s.id === duplicate.id));
});

test("missing stores are empty and robot opening plus human follow-up is not automatically skipped", async (t) => {
  const f = await setup(t, { sessions: [] });
  for (const script of Object.values(scripts)) assert.deepEqual(cli(script, ["--list", "--root", join(f.root, "absent")]), []);
  await f.put({ tool: "pi", id: "mixed", date: at("10:00") });
  const path = f.paths.mixed;
  const text = (await readFile(path, "utf8")).replace("Human design conversation 0", "Run one collection pass for today");
  await writeFile(path, text); await utimes(path, new Date(at("10:00")), new Date(at("10:00")));
  assert.equal((await pi.list([f.roots.pi]))[0].automation, false);
  assert.equal(selectSessions(await list(f), {}, options).selected.length, 1);
});
