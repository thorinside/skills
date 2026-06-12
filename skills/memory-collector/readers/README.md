# Session readers

Dependency-free Node scripts (Node ≥ 22; `codex.mjs` needs ≥ 22.13 for the
built-in `node:sqlite`) that turn each coding tool's on-disk session store into
one normalized JSON contract. The parsing logic is ported from EI's integration
readers ([Flare576/ei](https://github.com/Flare576/ei) `src/integrations/*/reader.ts`,
MIT, © 2026 Jeremy Scherer) and verified against live stores.

**Do not parse session stores by hand.** That recreates the cost these tools
exist to remove, and the formats have traps the readers already encode:

| Reader | Source | Traps handled |
|---|---|---|
| `claude_code.mjs` | `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` | skips `agent-*.jsonl` sidechain files; user records with *array* content are tool results, not human text; skips summary/system/progress records; text blocks only from assistant content |
| `pi.mjs` | `~/.pi/agent/sessions/<encoded-cwd>/<ts>_<uuid>.jsonl` (also `~/.omp/…`) | the directory-name cwd encoding is lossy — the `type:"session"` header entry's `cwd` is used as authoritative; only `type:"message"` entries with user/assistant roles are conversation |
| `codex.mjs` | `~/.codex/state_<N>.sqlite` (`threads` table, highest N) + per-thread rollout JSONL | only `event_msg` records with `payload.type` `user_message`/`agent_message` are conversation; DB opened read-only; `--since` pre-filters on DB timestamps before touching rollout files |

No reader yet: OpenCode, Cursor — add one by following the pattern below.

## Contract

```
node <reader>.mjs --list [--since <ISO>] [--root <path>]
node <reader>.mjs --session <id>       [--root <path>]
```

- `--list` → JSON array, sorted **oldest-first by `lastMessageAt`**, of:
  `{ tool, id, title, cwd, firstMessageAt, lastMessageAt, messageCount, path }`
- `--session <id>` → the same fields plus
  `messages: [{ id, role: "user"|"assistant", content, timestamp }]` —
  **text-only**: thinking, tool calls/results, and machinery are already stripped.
- `--since` compares `lastMessageAt`; pass the cursor's high-water mark for
  cheap incremental listing.
- Missing store → `[]` / `null` with exit 0 (absence is not an error).
  `--root` overrides the default location.

## Adding a tool

One self-contained `.mjs`, zero dependencies, the same flags, the same output
shape. Derive the parsing from the tool's real files and verify on live data
before trusting it — formats drift, and a silent misparse poisons memory at
the source.
