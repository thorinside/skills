---
name: memory-gardener
description: Run a periodic hygiene ceremony over whatever persistent memory the agent can reach — vector memory stores, knowledge graphs, diaries. Dedup near-duplicates, decay stale items, split bloated ones, invalidate superseded facts, reconnect orphans, write an interval summary, and report. Use when asked to garden/tend/clean agent memory, run memory hygiene, or as a scheduled unattended task. Storage-agnostic: discovers capabilities from the tool surface, never assumes specific tool names.
---

# Memory gardener

Persistent agent memory rots by default. Duplicates accumulate, facts go stale
without anyone noticing, single items bloat into junk drawers, graph nodes orphan,
and nothing ever gets summarized. Most memory systems ship the *primitives* for
hygiene (duplicate checks, invalidation, re-linking) but nothing *runs* them.

This skill is the gardener: a budgeted, idempotent ceremony you run periodically
over whatever memory stores the current environment exposes. It is deliberately
**storage-agnostic** — you discover capabilities from the tool surface at the start
of every run, tend what exists, skip what doesn't, and report everything.

## Ground rules — the safety contract

These override anything else in this document.

1. **Never hard-delete unattended.** Deletions and uncertain merges are *proposed*
   in the report, not executed. Where the store distinguishes invalidate / archive /
   expire from delete, prefer those — they preserve history.
2. **Budget every run.** Defaults: **25 mutations** and **50 judgment comparisons**
   per run. When the budget is spent, stop mid-phase, record the resume point in
   the report, and let the next run continue. Working oldest-or-dirtiest-first
   makes this naturally resumable.
3. **Idempotent.** Re-running immediately after a clean run should find almost
   nothing to do. If a second pass keeps finding the same "problem", the fix is
   wrong — stop and propose instead.
4. **Snapshot before the first run.** If the environment offers a backup
   capability and there is no evidence of a prior gardening run, take a backup
   before mutating anything.
5. **Missing capability ⇒ skip the phase and log it.** Never approximate a missing
   primitive with a destructive workaround (e.g., delete-and-recreate to fake an
   update).

## Phase 0 — survey

Do not assume tool names; environments differ. Scan the available tools and map
them to capabilities:

| Capability | Look for tools that… |
|---|---|
| Memory search | search or list stored memories by similarity, text, or tag |
| Memory mutation | create / update memories (delete may exist; you won't call it) |
| Duplicate check | given text, return near-duplicates — or emulate via similarity search with scores |
| Knowledge graph | add / query facts; invalidate; timeline or history views |
| Graph structure | list containers (collections, rooms, drawers), links/edges, traverse, reconnect |
| Diary / journal | append a dated free-text entry |
| Stats | item counts, graph stats — take these before and after |
| Backup | snapshot the store |
| Artifact / report storage | persist a text document |

Note which **stores** exist. Many environments run a two-tier stack — a fast
vector store *and* a structured knowledge graph; tend both. Take baseline stats.
Establish "since when": look for the previous gardening report or diary entry and
garden the interval since it; on a first run, limit yourself to the most recent
~200 items rather than all of history.

## Phase 1 — dedup

For items added or updated since the last run, find near-duplicates using the
duplicate-check capability (or similarity search). A hit at **≥ 0.85 similarity**
is a candidate pair.

- **Auto-merge only the plain cases**: same fact, one version strictly richer.
  Keep the richer text, union tags/sources/links onto the survivor, then **propose**
  the loser's deletion in the report — do not delete it.
- Both versions contribute unique content → merge the texts carefully into the
  survivor, same proposal for the loser.
- Any doubt at all → no mutation; list the pair under *Proposed* with one line of
  reasoning.

## Phase 2 — decay

Stale means not mentioned, retrieved, or updated in **30 days** (adjust to the
store's tempo). For stale items: lower importance/priority/exposure by one notch,
never below the floor. If the store supports expiry, set an expiry on trivia-grade
items instead of proposing deletion. Never decay items the store marks pinned,
critical, or protected.

## Phase 3 — split bloat

An item whose text exceeds **~750 characters** is usually several facts wearing
one id. Worst offenders first, **max 5 splits per run**:

1. Extract the distinct facts into new focused items.
2. Link children to the parent using whatever the store has — edges, tunnels,
   tags, or a `parent:` reference in metadata.
3. Rewrite the parent down to its actual core.

This is the most expensive phase; it is always acceptable to do fewer, better
splits.

## Phase 4 — invalidate the superseded

Knowledge-graph stores only. Query facts touched since the last run and look for
contradictions: same subject and predicate, different object, different times. The
older fact is superseded — **invalidate** it (which preserves the timeline), never
delete it. If the store has no invalidation, add the correction as a new fact and
list the stale one under *Proposed*.

## Phase 5 — reconnect orphans

Graph stores: find nodes with no links, or items filed in an obviously wrong
container. Re-file them, add the one missing link that's unambiguous, and use the
store's reconnect helper if it has one. **Max 10 reconnects per run.** If the right
home for an item isn't obvious, leave it and note it — a wrong link is worse than
a missing one.

## Phase 6 — summarize the interval

Write one diary/journal entry: 2–6 sentences on notable knowledge added since the
last run, plus one line on garden health (e.g., "dup pressure rising in topic X").
No diary capability → write a memory item tagged `garden-summary` instead.

## Phase 7 — report (never skipped)

Even when every other phase was skipped, produce the report. Persist it via the
artifact/report capability if one exists; always also emit it as your final output.

```
# Gardening report — <ISO timestamp>
Stores tended: <store: capability summary, per store>
Stats: <counts before → after, per store>
Actions: merges N · decays N · splits N · invalidations N · reconnects N
Proposed for human review:
  - DELETE <id> "<short preview>" — duplicate of <id>, merged <date>
  - MERGE? <id> + <id> — overlapping but both carry unique content
Skipped: <phase> — <missing capability>
Budget: <used>/<max> mutations · resume point: <store / cursor or "clean">
```

The *Proposed* section is the human review queue. That is the division of labor
this whole skill is built on: **the gardener tends; the human prunes.**

## Running periodically

Designed for daily-ish unattended runs by any host that can invoke an agent with
this skill — a scheduler that launches an agent job, an agent harness's own cron,
or a plain crontab entry. Daily suits active stores; weekly suits quiet ones.
Every run is budget-capped, so an aggressive cadence is safe — the worst case is a
report that says "clean".

## Provenance

The ceremony structure (dedup → decay → rewrite → reflect) and the working
thresholds (0.85 duplicate similarity, ~750-character bloat line) are adapted from
the nightly ceremony in [Flare576/ei](https://github.com/Flare576/ei) (MIT,
© Jeremy Scherer), generalized here to be storage-agnostic.
