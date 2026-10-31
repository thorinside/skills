# Source and adaptation

## Identified source (unfinished)

- Repository: `git@github.com:No-Such-Device/nt_helper.git`
- Checkout: `/Users/nealsanche/nosuch/nt_helper`
- Branch: `feat/test-quality-audit`
- HEAD: `ef82eb450426dd0b102469db0394acc48125e142`
- Snapshot time, original paths and SHA-256 values: [`source.json`](source.json).
- **All copied audit files were uncommitted/untracked**, not part of that HEAD.
  `pubspec.yaml`/`pubspec.lock` were also modified; the source adds analyzer
  `^10.2.0` and args `^2.7.0`. Its existing crypto, path and mcp_dart declarations
  informed the standalone package. The application's pubspec/lock were not copied.

The exact copied bytes are retained in destination snapshot commit
`404e77ec91c085a486588b96b3765a55d2171a8f`
(`chore(test-quality-review): snapshot in-progress nt_helper audit source`).
Use the full commit ID in the local Git history to retrieve original
`skills/test-quality-review/scripts/...` files; `source.json` verifies their hashes.
Later commits contain the explicit adaptation. No live follow/sync is implied.

Discovery inspected local branch/worktree lists, recent nt_helper commits, the
uncommitted audit directory, CLI, rubric, budgeter, extractor and associated tests.
The canonical checkout's branch and matching untracked files identify the actual
work; this is not a replacement based on the separate installed TypeScript
`test-packet-auditing` skill. No other matching audit branch was identified.
GitHub listed no open PRs in either repository at packaging time.

## Destination isolation

Verified origin: `git@github.com:thorinside/skills.git`. Its expected canonical
checkout at `/Users/nealsanche/nosuch/skills` was in an in-progress rebase with a
clean tracked working tree at detached `7111cfe`. That rebase was left alone.
Adaptation uses branch `feat/test-quality-review` in
`/Users/nealsanche/nosuch/skills-test-quality-review`, based on that same HEAD.
No source branch switch, stash, reset, source edit, push or publication occurred.

## Deliberate changes

- Added the reusable scoped review workflow, including source-grounded reasons,
  retained-coverage comparisons, explicit unresolved evidence and Neal's test rules.
- Preserved the categorical prompt JSON, AST extractor, budgeter, hash-bound cache,
  local-provider checks and bounded classifier orchestration.
- Packaged dependencies independently of the reviewed application, porting the
  existing test harness from `flutter_test` to `test` (no Flutter runtime needed).
  `pubspec.lock` records resolved standalone versions.
- Changed the client identity to `test-quality-review`.
- Rejected `--apply-removals` before artifact creation and rejected direct apply
  calls to `writeReport`; removed its target-write/delete implementation. Retained
  source-hash-checked proposal planning as review evidence only.
- Adapted the two upstream successful-deletion scenarios to protect explicit apply
  refusal and unanimous whole-file remove refusal. Comments name why existing
  single-path coverage is insufficient. No additional test scenarios were added.
- Replaced the upstream README with installation-independent invocation and honest
  integration/coverage limits; added repository/plugin discovery descriptions.

## Validation and remaining limits

Packaging checks passed:

- `dart pub get` in the standalone scripts package.
- `dart format tool test`; `dart analyze` (no issues).
- `dart test test/tool/test_quality_audit_test.dart`: 20 passed. These exercise
  injected classifier callbacks/completers, not network services or real-time waits.
- `python3 -B -m unittest test_budget.py`: 3 passed.
- Absolute-path CLI help/build/report from a separate temporary project: 20
  declarations extracted, budgeted, hash-bound and correctly unresolved without
  classifier replies. Target bytes unchanged. Explicit apply rejected before output
  directory creation.
- Source snapshot hash readback, local Markdown links, manifest JSON and
  `git diff --check` validated during final review.

No nt_helper tests were modified, deleted, or executed. No full project suite or
live classifier inference was run. Upstream work remains unfinished; classification
precision/calibration and current service integration are not established here.
At initial packaging the adapter depended on a particular local service. The
portability follow-up removed that dependency: current usage takes explicit
caller-selected MCP server/service/provider/model settings. Historical source
identities above are provenance only, not reusable defaults or prerequisites.
The tool supports Dart AST declarations only, not exhaustive runtime inventory;
external helpers, chopped setup, custom wrappers and unsupported removal-plan
shapes may require manual review. See the adapter README for operational details.
