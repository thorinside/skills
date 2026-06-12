# thorinside/skills

Agent skills, packaged both as a **Claude Code plugin** and in the standard
**[agent skills](https://agentskills.io) layout** consumed by `npx skills`.

## Skills

| Skill | What it does |
|---|---|
| [`decision-free-specs`](skills/decision-free-specs/SKILL.md) | Write refactor specs/plans a local ~27B model (e.g. Qwen3.6-27B) can execute with zero architectural decisions. Language-agnostic workflow; per-language AST inventory tools replace the expensive read-the-codebase step (TypeScript, Python, Rust, and Flutter/Dart included, each behind a documented contract). |
| [`memory-gardener`](skills/memory-gardener/SKILL.md) | Periodic hygiene ceremony over whatever persistent memory the agent can reach (vector stores, knowledge graphs, diaries): dedup, decay, split bloat, invalidate superseded facts, reconnect orphans, summarize, report. Storage-agnostic — discovers capabilities from the tool surface; safe ops auto-applied, destructive ops only proposed. Ships Jeremy Scherer's battle-tested ceremony prompts (dedup curator, validate gate, confirmed merge, bloat scan/split) from [Flare576/ei](https://github.com/Flare576/ei) (MIT). |

## Install

### As a Claude Code plugin

```
/plugin marketplace add thorinside/skills
/plugin install thorinside-skills@thorinside-skills
```

### With the skills CLI

```bash
npx skills add thorinside/skills
```

Both consume the same `skills/<name>/SKILL.md` files.

## Layout

```
.claude-plugin/
  plugin.json          Claude Code plugin manifest
  marketplace.json     lets the repo be added directly as a marketplace
skills/
  decision-free-specs/
    SKILL.md           the language-agnostic workflow
    languages/         per-language plug-ins (inventory tool + NOTES.md)
      README.md        the inventory output contract + how to add a language
      typescript/      inventory.mjs + NOTES.md (TS compiler AST)
      python/          inventory.py + NOTES.md (stdlib ast)
      rust/            inventory.py + NOTES.md (structural scanner)
      dart/            inventory.py + NOTES.md (structural scanner, Flutter-aware)
    templates/         example program README + conventions to bootstrap a new repo
  memory-gardener/
    SKILL.md           the storage-agnostic memory hygiene ceremony
    prompts/           EI's ceremony prompts, © Jeremy Scherer (MIT) — dedup
                       curator/gate/confirmed-merge, bloat scan/split
```

## License

MIT
