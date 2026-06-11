# thorinside/skills

Agent skills, packaged both as a **Claude Code plugin** and in the standard
**[agent skills](https://agentskills.io) layout** consumed by `npx skills`.

## Skills

| Skill | What it does |
|---|---|
| [`decision-free-specs`](skills/decision-free-specs/SKILL.md) | Write refactor specs/plans a local ~27B model (e.g. Qwen3.6-27B) can execute with zero architectural decisions. A TypeScript-AST inventory script replaces the expensive read-the-codebase step; the planning model spends tokens only on judgment. |

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
    SKILL.md           the workflow
    scripts/inventory.mjs   deterministic AST inventory (no token cost)
    templates/         example program README + conventions to bootstrap a new repo
```

## License

MIT
