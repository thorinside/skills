# Portability follow-up

The extraction job succeeded; this follow-up stays in its destination worktree and
branch. Historical source paths and identities remain only in provenance records.

## Changes

- One global skill installation supports targets selected by `--project` or caller
  working directory. Installation-relative lookup is limited to bundled assets
  and dependency tooling. No per-repository skill copy is required.
- Relative configuration and output paths resolve from the target repository.
  Outputs must stay within it; foreign-root manifests and symlink escapes fail.
  Every artifact/cache path component rejects symlinks, including dangling links
  and links back into the target. Report/cache writes stage in private temporary
  directories before atomic replacement.
- MCP configuration, server entry, service, expected provider and model are explicit
  caller inputs. The existing compatible wire contract is retained, without
  default infrastructure or new integrations. Packet model selection is optional
  for offline review and required before inference.
- Results are bound to request hashes and selected server/endpoint/service/provider/
  model identity. Repository roots bind persisted review state. Credentials are
  not written into artifacts.
- Advisory reports archive candidates without constructing deletion plans;
  unbraced registrations cannot abort reporting. Stale source remains unresolved.
- All four testing rules and the review-only boundary remain intact.

## Verification

Run from `scripts/`:

```sh
dart analyze
dart test test/tool/test_quality_audit_test.dart
python3 -B test/portability_check.py
(cd tool/test_quality_audit && python3 -B -m unittest test_budget.py)
dart format --output=none --set-exit-if-changed tool test
```

Passed: static analysis, 26 Dart tests, 3 Python budget tests, formatting and
`git diff --check`. The portability check invokes the same absolute installed CLI
against two distinct disposable Git repositories (`repo-a`, `repo-b`) with
identical test source. It checks caller-cwd targeting, explicit targeting from a
third directory, independent output/cache state, successful repository-specific
reporting, copied foreign-state refusal, and absolute/symlink output escapes.
The CLI also checks descendant links for manifests, budgeter input/output,
reports and result caches. Focused Dart regressions protect target source,
foreign caches, legacy temporary links, dangling links and unbraced reporting.
No tests sleep or use bounded real-time waits. A source inspection found no
project names, local absolute paths, infrastructure names or model/provider
defaults in the reusable instructions/scripts; historical identifiers are isolated
in provenance.

No source application changes or live classifier inference were performed;
compatibility with a caller's service remains a runtime check.
