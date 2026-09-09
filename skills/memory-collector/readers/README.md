# Session readers and newest-first selection

Dependency-free Node scripts (Node ≥ 22.13 for built-in `node:sqlite`). Parsing
comes from EI ([Flare576/ei](https://github.com/Flare576/ei), MIT, © 2026 Jeremy
Scherer). **Do not parse session stores by hand.**

| Reader | Source | Traps handled |
|---|---|---|
| `claude_code.mjs` | `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` | skips agent sidechains; array user content is tool results; assistant text blocks only |
| `pi.mjs` | `~/.pi/agent/sessions/`, `~/.omp/agent/sessions/` | authoritative cwd from session header, not lossy dirname; user/assistant text messages only |
| `codex.mjs` | highest `~/.codex/state_<N>.sqlite` + rollout JSONL | DB read-only; event_msg user_message/agent_message only; supports seconds-only and millisecond DB schemas |

OpenCode and Cursor do **not** yet have bundled readers. Report them unsupported;
do not improvise parsing or claim selection covered them.

## Reader CLI

```sh
node readers/<reader>.mjs --list [--since <ISO>] [--limit 100] [--offset 0] [--root <path>]
node readers/<reader>.mjs --session <id> [--root <path>]
```

- `--list` → JSON array, **newest-first by lastMessageAt**, then tool, ID and path
  ascending using locale-independent code-point order. Slice only after sorting
  and filtering. Without `--limit`, returns all metadata (no message text).
- Entries: `{tool,id,title,cwd,firstMessageAt,lastMessageAt,messageCount,path,
  revision,lastModifiedAt,fileVersion,stable,parseComplete,userMessageCount,automation}`.
- `--session` → same fields plus `messages: [{id,role,content,timestamp}]`.
  Message order remains chronological. Existing provenance IDs are unchanged.
- `revision` hashes normalized message identities/content/timestamps. `fileVersion`
  includes device/inode/size/mtime/ctime; compare it as well as revision when
  checking selection/conversion/checkpoint stability. Tool-only changes still
  trigger the live guard. Malformed JSON sets `parseComplete:false` (not empty).
- `--since` is an **exclusive** comparison of the parsed `lastMessageAt` instant,
  with timezone offsets normalized. It is an optional diagnostic filter, **not
  a collection cursor**. Equality is excluded. Codex no longer pre-filters using
  DB timestamps: those can lag rollouts, and old `updated_at` values use seconds.
- Missing store → `[]` / `null`, exit 0. Permission/schema/read failures are
  errors, not evidence of an empty source. A missing Codex rollout stays unresolved.
- Existing text-only/sidechain filtering remains in each source reader. Credentials
  may still exist in conversation text: extraction must remove them before stores,
  pending plans, quotes, or reports. The selector suppresses titles/opening text.

## Collection selector (read-only)

```sh
node readers/select.mjs --cursor /private/mac-cursor.json --host mac --budget 3
# Fixture/diagnostic controls:
node readers/select.mjs --host test --claude-root /fixtures/claude \
  --pi-root /fixtures/pi --codex-root /fixtures/codex \
  --now 2026-09-09T12:00:00Z --live-id pi:active-id --limit 50 --offset 0
```

Omit `--cursor` for the first run. An existing cursor's host must match `--host`.
The selector intentionally rejects `--since`: every run scans full metadata,
merges all supported sources, filters live/completed/trivial entries, then
reserves at most the remaining session budget. This both discovers new arrivals
and walks backward without losing holes below any timestamp. No transcript,
cursor, memory store or source DB is written by this command.

The result contains selected candidate metadata, counts, remaining eligible
count, oldest eligible unresolved ID/date, and paged `skippedTrivial`/`blocked`
metadata (`nextOffset`). `--limit`/`--offset` affect those diagnostic pages only,
not selection. Keep a saved result/snapshot for paging within a run; a new run
must rediscover from the newest end, not resume a saved listing offset. A scan
still reads the local files; bounded output is **not** a claim of bounded I/O.

The live guard excludes mtime or message activity within 30 minutes, unstable
reads, `live:true`, explicit repeatable `--live-id tool:id`, and the current
`PI_SESSION_ID`. It precedes all resolution/trivial checks. Duplicate source IDs
across Pi/OMP copies collapse to the newest entry, then path tie-break; if **any**
copy is live the identity is excluded. Verify `--session` conversion matches the
selected fileVersion/revision before acting.

Trivial means <4 cleaned messages, no user messages, or only recognized machine
prompts (including the Substrate worker/outcome envelope). Automation detection
is deliberately narrow; a substantive human
follow-up prevents that shortcut. **Candidates are not charged budget yet**:
the agent must inspect the bundled conversion for unfamiliar machine templates
before extraction, honestly skip them, and refill with the remaining budget.
Failed/partially analyzed human sessions still consume a slot. Newest-first can
starve old history under sustained arrivals; no fairness policy is added.

## Cursor and retry contract

`collector-state.mjs` exports tested pure helpers; import it by absolute path
from a small driver and persist the returned object through your store tools:

```js
import { pendingMessages, checkpointWindow, completeSession, skipTrivial,
  windowKey, plantOnce } from "/path/to/readers/collector-state.mjs";
// Read selected session with its bundled reader, retain `before`.
const pending = pendingMessages(cursor, before);
// Analyze a window, persist its sanitized plan + stable operation keys BEFORE
// writes, reconcile each write, verify all pipelines/stores. Then re-read `after`.
cursor = checkpointWindow(cursor, before, after, window, verifiedReceiptIds);
// Persist/read back cursor. Partial remains partial; do not restart its windows.
// At end, re-read `after` again and verify the session-level event scan:
cursor = completeSession(cursor, before, after, { eventsComplete: true });
```

This is not an ingestion engine; the agent still runs extraction, credential
filtering, matching, store verification and persistence. `plantOnce` accepts an
adapter with `find(operationKey) → id|null`, `write(key,sanitizedRecord) → id`,
`verify(id,key)`; `find` must exhaustively reconcile a previous uncertain write
and `verify` must throw on missing content/provenance or secrets. Operation
keys must be persisted with the extraction plan and include window, store and
item identity. No store support for safe reconciliation → stop/report pending,
not blind retries. The fake-store test proves helper retry behavior, not live
provider ingestion or transactional exactly-once delivery.

State compatibility:
- Read legacy `sources.<tool>` or flat `<tool>`, `processed` maps,
  `skippedTrivial`/`skipped_trivial`/`skipped-trivial` maps or `{id,at}` arrays.
- Preserve **all** legacy fields, timestamps, stored references and unknown
  sources. Do not rewrite production cursors just to migrate. New transitions
  add only `collectorV2: {version:2,policy:"newest-first",sources:{<tool>:{
  sessions:{<id>:{status,revision,lastMessageAt,resolvedAt,messageKeys,receipts}}}}}`.
- Sidecar revision equality resolves processed/trivial entries; changed revisions
  reopen them. `partial` entries retain completed-message hashes and receipt IDs.
  Never mark an entire session complete until every pending message and event
  scan is done. Live/changed sources fail checkpoint validation.
- Legacy timestamp-only records remain respected: lastMessageAt, otherwise
  processedAt/skippedAt/at (or string timestamp) is the per-session boundary.
  Reopened processed sessions analyze only the timestamp-new suffix and reconcile
  existing provenance. Missing times → `legacy-review`, unresolved, no budget.
  Same-timestamp rewrites of legacy records cannot be detected without old
  fingerprints; do not claim otherwise. New sidecar records detect those edits.
- `highWater` and `high_water_mark` remain historical, unchanged, never fences.
  Legacy `skipped_live` is not completion. No blanket processed set, map pruning,
  implicit age cutoff, or backlog compaction.
- One writer per host cursor. Re-read/compare before persistence; a concurrent
  mutation requires reconciliation, never overwriting another collector's work.

## Tests

```sh
node --test skills/memory-collector/readers/tests/*.test.mjs
```

Fixtures create real Claude/Pi JSONL and a real read-only-consumed Codex SQLite
store in a temporary directory. They exercise the actual reader/selector CLIs,
legacy schemas, ordering/ties, pre-budget guards, backward progress/new arrivals,
old holes, partial failure, replay receipts, source changes and text filtering.

## Adding a reader

Use the same flags and normalized output; export `list`/`session` without CLI
side effects on import. Reuse common metadata/sorting, add the source to
`select.mjs`, and test real format fixtures before enabling it. Do not infer a
new format from a filename alone.
