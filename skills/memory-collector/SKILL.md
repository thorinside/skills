---
name: memory-collector
description: Harvest coding-agent session transcripts already on disk (Claude Code, Codex, OpenCode, Cursor, Pi) and extract durable knowledge — topics, people, facts, events, quotes — into whatever persistent memory the agent can reach. Cursor-tracked, budgeted, read-only on sources. Use when asked to collect/import/mine session history into memory, build memory from past sessions, or as a scheduled task. Composes with memory-gardener, which tends what this skill plants.
---

# Memory collector

Your richest memory source is sitting untouched on disk: every coding-agent
session ever run on this machine. Transcripts full of decisions, gotchas, open
questions, people, and the occasional quotable outburst — none of it queryable,
all of it rotting in JSONL.

This skill is the collector: a budgeted, cursor-tracked harvest that mines those
transcripts and plants durable knowledge into whatever memory stores the current
environment exposes. It is **storage-agnostic** (capabilities discovered at run
time, like [memory-gardener](../memory-gardener/SKILL.md)) and **source-aware**
(it knows where coding tools keep their sessions). The extraction prompts ship in
[`prompts/`](prompts/README.md), carried from EI's extraction pipeline by Jeremy
Scherer (MIT).

**The composition**: the collector plants; the gardener prunes. Collection
deliberately tolerates near-duplicates and overgrowth — the gardener's validate
gate, dedup curator, and bloat-split exist precisely to tend what collection
produces. Don't make the collector perfect; make the pair converge.

## Ground rules — the safety contract

1. **Sources are read-only.** Never modify, move, or delete a transcript file.
2. **Stores are additive.** The collector creates and updates memory items; it
   never deletes. Anything that looks delete-worthy is the gardener's job.
3. **Budget every run.** Default: **3 sessions** (or ~150 messages) per run,
   **newest eligible first across all supported sources on this host**, ordered
   by `lastMessageAt` descending, then tool and session ID ascending (code-point
   order; path breaks duplicate-ID ties). Filter live, completed and trivial
   sessions **before** spending budget. Stop at the budget; retain the backlog.
4. **Skip live sessions.** A transcript modified in the last ~30 minutes (or
   whose tool is plainly mid-session) gets skipped — half-written sessions
   extract badly. It will be there next run.
5. **Never store secrets.** Coding transcripts contain tokens, connection
   strings, ARNs, and keys. If an extracted value is shaped like a credential,
   drop it. The shipped prompts already exclude these from quotes; apply the
   same bar to every field you store.
6. **Conservative is the law.** The shipped prompts are tuned so that *empty
   results are the most common response*. Honor that — noise is worse than gaps.
7. **Provenance is mandatory.** Every stored item carries its source id (see
   Phase 4). An item you can't trace back to a session is a rumor.

## Phase 0 — survey

**Transcript sources.** The skill bundles dependency-free Node readers
([`readers/`](readers/README.md)). Use the read-only cross-source selector:
`node readers/select.mjs --cursor <local-cursor-snapshot.json> --host <host> --budget 3`.
Omit `--cursor` on the first run. Copy the **entire**, paged host cursor to a
private local snapshot; never substitute a truncated response. For source
inspection use `node readers/<tool>.mjs --list --limit 100 --offset 0` and page
as needed. **Do not use `--since highWater` for collection**: it excludes older
unresolved holes as well as the backlog. The selector inventories all history
internally but returns bounded metadata, not transcript text. **Do not parse session stores by hand**: the readers already
encode the format traps (sidechain files, tool-result records masquerading as
user messages, lossy cwd encodings).

| Tool | Reader | Where sessions live |
|---|---|---|
| Claude Code | `readers/claude_code.mjs` | `~/.claude/projects/<encoded>/<uuid>.jsonl` |
| Pi / OMP | `readers/pi.mjs` | `~/.pi/agent/sessions/` (and `~/.omp/…`) |
| Codex | `readers/codex.mjs` | `~/.codex/state_<N>.sqlite` + rollout JSONL |
| OpenCode, Cursor | none yet — see [`readers/README.md`](readers/README.md) to add one | local app data |

**Memory stores.** Discover capabilities from the tool surface exactly as the
gardener's Phase 0 does — memory search/mutation, knowledge graph, diary, stats.
Don't assume tool names.

**The cursor.** Find the previous collection state: a memory item or artifact
tagged `collector-cursor`. Preserve every existing field, processed/skipped ID,
timestamp, stored-item reference, provenance and unknown source. Both nested
Mac `sources` maps and flat dev maps/`skipped_trivial` arrays are supported by
`readers/collector-state.mjs`. Legacy `highWater`/`high_water_mark` values are
**historical only**: leave them unchanged, never use them as traversal fences.
New per-session revisions and partial progress live in the additive
`collectorV2.sources.<tool>.sessions.<id>` sidecar; the sidecar plus legacy
resolved IDs (not a global timestamp) determine completion.
No cursor → first run: select the most recent eligible few; all older sessions
remain discoverable. Every future run starts discovery at the newest arrivals
and descends unresolved history. Under sustained new input, latest-first can
still **starve history**; no fairness quota or different policy is implied.

## Phase 1 — select

Use `readers/select.mjs` to merge sources before taking the budget, not a
separate budget or source-order loop per tool. It applies the 30-minute mtime
and message-time guard, resolved-revision check and known trivial filters.
Pass `--live-id <tool>:<id>` for any session known to be active (repeatable);
the current `PI_SESSION_ID` is automatically excluded. A live or unstable
session is never marked trivial/completed. Unreadable or malformed sources
remain unresolved and are reported, not silently classified as empty.

The returned `selected` entries are candidates, not spent budget. Confirm real
human conversation with the bundled `--session` reader before extraction;
unknown automation templates require this check. Check the converted revision
and fileVersion against the selected entry. If plainly machine-generated,
record an honest stable `skipTrivial` transition and refill from the selector
using the updated snapshot and remaining budget. Never replace a failed or
partially analyzed session with extra sessions beyond the run budget.

**Prefer real conversations.** Agent automation produces sessions too — a Pi
store can hold a thousand mechanical runner-job sessions for every human one.
Skip sessions that are tiny (fewer than ~4 messages) or whose opening message
is plainly a machine-generated job prompt with no substantive human follow-up,
and record them in the cursor as `skipped-trivial` for that revision. A changed
or reopened session must be reconsidered after it settles. Spending the budget on noise is
how a collector starves.

## Phase 2 — convert

`node readers/<tool>.mjs --session <id>` returns the session already reduced
to a clean conversation — human text and assistant text only; thinking blocks,
tool calls/results, system noise, and sub-agent chatter are stripped by the
reader. From that output:

- Build fully qualified message ids: `<tool>:<machine>:<session>:<reader msg id>`
  (e.g., `claudecode:mbp:0a1f…:42`). Quotes and provenance point at these.
- Process the session in **windows** (~20–40 messages). For each window, the
  window itself is the "Most Recent Messages" and a compact tail of what came
  before is the "Earlier Conversation" — the shipped prompts are built around
  exactly this split and only ever analyze the recent window.
- Use `pendingMessages(cursor, session)` from `readers/collector-state.mjs` to
  exclude acknowledged message fingerprints on retries/reopens. Preserve the
  full conversation for context, not for replanting. Legacy processed records
  lack fingerprints: only analyze the suffix beyond their recorded last-message
  timestamp (or resolution time if that is all they retained). Reconcile
  existing source-tagged items before any legacy replay. Unknown legacy times
  are reported as `legacy-review`, never guessed. The first stable V2 transition
  fingerprints the already-resolved legacy prefix (`legacyBaseline:true`) without
  replanting it; subsequent edits use hashes, not the old timestamp cutoff.
  Equal-timestamp rewrites **before that baseline** cannot be detected reliably;
  this is a legacy limitation, not permission to re-ingest everything.

## Phase 3 — extract

Run the shipped pipelines over each window, with `technical_context: true` for
coding-tool sessions (it makes Technical a priority category):

1. **Topics** — [`prompts/topics.md`](prompts/topics.md): scan flags candidate
   topics → match checks each against existing memory (conservative: unsure ⇒
   "new") → update writes the record under the right discipline (Event
   narratives; Technical *accumulate, don't synthesize*; everything else
   *synthesize, don't accumulate*). Quotes ride along.
2. **People** — [`prompts/people.md`](prompts/people.md): scan flags people
   (confidence 1–5, identifier capture, self/hypothetical guards) → match by
   identifiers first, then name → update under the person disciplines. For
   coding sessions most windows yield nobody; that's correct.
3. **Events** — [`prompts/events.md`](prompts/events.md): once per session, the
   campaign-recap test ("The Night We Debugged the CPU"). Empty is the norm.
4. **Facts** — [`prompts/facts.md`](prompts/facts.md): only if you maintain a
   missing-facts list (kept beside the cursor). No list, no run.

## Phase 4 — store

Write extractions into the discovered stores, mapping fields onto the store's
schema (confidence/exposure-impact → importance-like fields; categories →
tags/containers; drop fields the store can't hold rather than inventing
homes). Tag everything `source:<tool>:<machine>:<session>` plus
`collected:<ISO date>`.

Where the store distinguishes recent/unreviewed items, leave new items visibly
new — the gardener's validate gate ([its Phase 1](../memory-gardener/SKILL.md))
is the door these newcomers are supposed to walk through. If both a fast store
and a structured knowledge store exist, put summaries where retrieval happens
and structure (entities, links) where the graph lives.

**Retry safety is distinct from semantic deduplication.** Before any window's
writes, persist/read back its sanitized extraction plan, stable
`windowKey(host, session, messages, cursor)` and per-store operation keys/targets in a
pending artifact beside the cursor. Reuse that plan on retry. Tag each operation
with its key and reconcile it via exact search/readback before creating again;
`plantOnce` documents the required store-adapter contract. A write timeout is
not proof that nothing was written. If a store cannot reconcile an uncertain
write, leave it pending and report failure rather than blindly retrying.
Checkpoint a window only after **all** its pipelines and required store writes
(including empty results) are verified; retain receipt IDs and fingerprints.
Track the **current** acknowledged fingerprint per message identity, separately
from historical receipts. A source revision generation in the window key makes
an A→B→A restoration new work, not a retry of the original A. Within a revision,
keys stay stable across checkpoints/retries. New or restored messages update the
same matched item when appropriate; a new operation key does not justify a new
entity. Reconcile every retained pending plan, even if the source changed while
a write was uncertain, before completing a reopened session.

## Phase 5 — checkpoint the cursor & report

Use the pure helpers in `readers/collector-state.mjs` to build a new cursor
snapshot; they never write production state themselves. Re-read the session
through its reader before each checkpoint/completion and use `assertStable`
(via the transition helpers) to reject a changed or live source. Persist and
read back `checkpointWindow` progress after each verified window. A partial
session is **not completed**; it retains receipts and resumes on its next
eligible selection. Mark `completeSession` only after all pending messages and
the session event scan are verified; `skipTrivial` requires an honest reason.
Never blanket-mark deferred IDs or remove old map entries. Leave all legacy
high-water fields unchanged; newer completion cannot conceal older work.

Allow only one collector per host cursor. Re-read the production cursor just
before persistence and compare it with the snapshot you started from; on a
concurrent change stop and reconcile rather than overwrite. Page and verify the
whole saved cursor and report, including preserved maps/provenance. Then report:

```
# Collection report — <ISO timestamp>
Sources: <tool: sessions found / processed / skipped-live>
Windows analyzed: N · budget used: <sessions>/<max>
Planted: topics N (new X, updated Y) · people N · events N · facts N · quotes N
Dropped: secrets-shaped values N · low-confidence extractions N
Cursor: resolved <IDs/revisions>; partial <IDs>; legacy high-water unchanged
Backlog: <eligible deferred count>; oldest discoverable <ID/date>; blocked <IDs/reasons>
Handoff: <n> new items awaiting the gardener's validate gate
```

### Substrate semantic completion

When this skill runs as a Substrate runner or workflow job, keep the collection
report as the human-readable output, then make the final non-empty assistant line
exactly one `SUBSTRATE_OUTCOME_V1=` declaration. Lifecycle completion is not the
success signal.

Declare `outcome: "succeeded"` only when every counted session was fully
processed or honestly skipped, only resolved revisions were marked complete,
planted items retain provenance, and the report and cursor were persisted and
read back through the available store. A partial session is allowed only when
its verified progress and pending writes are retained and reported as a resume
point; lost provenance, hiding unresolved work behind a timestamp, secret persistence, or
failure to persist the required report is `outcome: "failed"`. Memory-store
writes are not Git changes, so use `changes.status: "notApplicable"`.

Example success line (replace placeholders with real evidence):

```text
SUBSTRATE_OUTCOME_V1={"version":1,"outcome":"succeeded","summary":"Collected <n> sessions and persisted report <artifact-id>","evidence":{"changes":{"status":"notApplicable","reason":"Memory-store mutations are not Git changes"},"verification":{"status":"passed","commands":["read back collector cursor","read back report artifact <artifact-id>"]}}}
```

Emit no second declaration and nothing after it. Outside a Substrate job, do not
add this platform-specific line.

## Running periodically

Same hosting story as the gardener: any scheduler that can invoke an agent with
this skill. A good rhythm — **collector daily, gardener nightly after it** — so
each harvest is tended within a day. Both are budget-capped; worst case is a
report that says "nothing new."

## Provenance & credit

The extraction pipeline (scan → match → update), its conservative defaults, the
three description disciplines, the quote bar-test, and the prompts in
[`prompts/`](prompts/README.md) come from [Flare576/ei](https://github.com/Flare576/ei)
by **Jeremy Scherer** (MIT, © 2026 Jeremy Scherer) — EI runs this pipeline
against five coding tools as its importer layer. This skill generalizes the
storage side and pairs it with [memory-gardener](../memory-gardener/SKILL.md).
