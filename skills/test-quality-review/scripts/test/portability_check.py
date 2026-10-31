#!/usr/bin/env python3
"""Requirement: one global installation must isolate reviews across repositories.

Existing Dart unit coverage exercises the extractor and classifier in-process;
only this CLI check covers caller cwd/--project and persisted cross-root state.
Uses disposable Git repositories, no inference, sleeps, or timed waits.
"""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

SCRIPTS = Path(__file__).resolve().parents[1]
CLI = SCRIPTS / 'tool/test_quality_audit.dart'
PACKAGES = SCRIPTS / '.dart_tool/package_config.json'


def cli(cwd, *args, succeeds=True):
    result = subprocess.run(
        ['dart', f'--packages={PACKAGES}', str(CLI), *map(str, args)],
        cwd=cwd, capture_output=True, text=True,
    )
    assert (result.returncode == 0) == succeeds, result.stdout + result.stderr
    return result


with tempfile.TemporaryDirectory(prefix='quality-portability-') as temporary:
    base = Path(temporary).resolve()
    repos = [base / 'repo-a', base / 'repo-b']
    for repo in repos:
        (repo / 'test').mkdir(parents=True)
        subprocess.run(['git', 'init', '-q', str(repo)], check=True)
        (repo / 'test/example_test.dart').write_text(
            "void main() { test('distinct requirement', () { expect(1, 1); }); }\n"
        )
    a, b = repos
    # Default target must be caller cwd; explicit target overrides an unrelated cwd.
    cli(a, 'build', '--file', 'test/example_test.dart')
    cli(base, 'build', '--project', b, '--file', 'test/example_test.dart')
    state = Path('.dart_tool/test-quality-audit')
    for repo in repos:
        manifest = json.loads((repo / state / 'manifest.json').read_text())
        assert manifest['root'] == str(repo)
        assert len(manifest['tests']) == 1
    marker = a / state / 'results/private-marker.json'
    marker.parent.mkdir()
    marker.write_text('{"repository":"a"}')
    cli(base, 'report', '--project', b)
    assert not (b / state / 'results/private-marker.json').exists()
    assert marker.read_text() == '{"repository":"a"}'
    cli(b, 'report', '--project', a)
    # Copied state must fail even with identical source and request hashes.
    foreign = b / '.dart_tool/foreign'
    shutil.copytree(a / state, foreign)
    before = (foreign / 'manifest.json').read_bytes()
    result = cli(base, 'report', '--project', b, '--out', '.dart_tool/foreign', succeeds=False)
    assert 'different repository' in result.stderr
    assert (foreign / 'manifest.json').read_bytes() == before
    cli(base, 'report', '--project', b, '--out', a / state, succeeds=False)
    (b / 'escape').symlink_to(a, target_is_directory=True)
    cli(base, 'report', '--project', b, '--out', 'escape/review', succeeds=False)
    assert not (a / 'review').exists()
    assert not (base / state).exists()
print('PASS: global CLI targets two repositories; cwd/explicit paths, state isolation, foreign manifests and output escapes checked; no inference')
