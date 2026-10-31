import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from review import Store, build, digest, encode, judge, record, report


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.root = self.base / 'project'
        self.root.mkdir()
        self.source = self.root / 'checks/spec.txt'
        self.source.parent.mkdir()
        self.source.write_bytes(b'setup\ncheck requirement\n')
        self.store = Store(self.root, Path('.review'))
        self.selection = [{'file': 'checks/spec.txt', 'title': 'requirement',
                           'startLine': 2, 'endLine': 2}]
        self.manifest = build(self.store, self.selection, decision_api='fixture-api')
        self.row = self.manifest['tests'][0]

    def save(self, decision, manifest=None):
        manifest = manifest or self.manifest
        row = manifest['tests'][0]
        record(self.store, manifest, row['id'], decision,
               row['requestHash'], 'fixture-api')

    def test_any_language_source_ranges_preserve_exact_text(self):
        """Requirement: no framework/runtime assumption; old single-parser coverage cannot establish portability."""
        fixtures = {
            'tests/test_example.py': 'def test_contract():\n    assert value == expected\n',
            'checks/example.spec.ts': "it('contract', () => { expect(value).toBe(expected); });\n",
            'src/lib.rs': '#[test]\nfn contract() { assert_eq!(value, expected); }\n',
            'spec/contract_spec.rb': "it 'contract' do\n  expect(value).to eq(expected)\nend\n",
            'custom/requirements': 'contract: café\r\n  observed = expected\r\n',
        }
        for filename, source in fixtures.items():
            with self.subTest(filename=filename):
                path = self.root / filename
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(source.encode())
                selection = [{'file': filename, 'title': 'contract', 'startLine': 1,
                              'endLine': len(source.splitlines())}]
                manifest = build(self.store, selection, decision_api='fixture-api')
                row = manifest['tests'][0]
                self.assertEqual(row['source'], source)
                self.assertEqual(row['request']['input']['testFile'], source)
                self.assertEqual(row['request']['input']['target']['source'], source)
                self.assertEqual(row['sourceHash'], digest(source))

    def test_first_pass_and_requested_detail_use_existing_rubric(self):
        """Requirement: explanatory questions are opt-in; budget unit tests do not select question sets."""
        self.assertEqual(set(self.row['request']['questions']), {'disposition'})
        detailed = build(self.store, self.selection, decision_api='fixture-api', explain=True)
        self.assertEqual(set(detailed['tests'][0]['request']['questions']),
                         {'disposition', 'protection', 'weakness', 'contextAdequate'})

    def test_selection_requires_valid_ranges_and_explicit_broader_scope(self):
        """Requirement: explicit complete ranges and single-file default; content preservation alone misses scope errors."""
        for start, end in [(0, 1), (1, 99), (2, 1), (True, 2)]:
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                build(self.store, [dict(self.selection[0], startLine=start, endLine=end)])
        other = self.root / 'other.any'
        other.write_text('another check\n')
        selected = self.selection + [dict(self.selection[0], file='other.any', startLine=1, endLine=1)]
        with self.assertRaises(ValueError):
            build(self.store, selected)
        self.assertEqual(len(build(self.store, selected, allow_multiple_files=True)['tests']), 2)

    def test_line_selected_candidates_report_without_source_edit_planning(self):
        """Regression: unbraced/embedded registration aborted reports; selection-only tests never generate proposals."""
        self.source.write_text('for case in cases: register_check(case)\n')
        selected = [dict(self.selection[0], startLine=1, endLine=1,
                         loopBindings=['case in cases'])]
        manifest = build(self.store, selected, decision_api='fixture-api')
        original = self.source.read_bytes()
        self.save({'disposition': 'remove'}, manifest)
        rows = report(self.store, manifest)
        self.assertEqual(rows[0]['verdict'], 'remove')
        self.assertEqual(self.store.read('proposed-removals.json')['tests'][0]['source'],
                         original.decode())
        self.assertEqual(self.source.read_bytes(), original)
        self.assertTrue(self.store.file('report.md').is_file())

    def test_stale_source_request_hash_and_api_identity_remain_unresolved(self):
        """Requirement: cached decisions bind source and API; successful recording does not cover changed inputs."""
        self.save({'disposition': 'keep'})
        saved = self.store.read(f"results/{self.row['id']}.json")
        for field in ('root', 'requestHash', 'decisionApi'):
            with self.subTest(field=field):
                changed = dict(saved, **{field: 'other'})
                self.assertEqual(judge(self.store, self.manifest, self.row, changed)['verdict'],
                                 'unresolved')
        with self.assertRaises(ValueError):
            record(self.store, self.manifest, self.row['id'], {'disposition': 'keep'},
                   'old-hash', 'fixture-api')
        changed_row = copy.deepcopy(self.row)
        changed_row['request']['input']['target']['source'] = 'changed'
        self.assertEqual(judge(self.store, self.manifest, changed_row, saved)['verdict'], 'unresolved')
        self.source.write_text('changed source\n')
        self.assertEqual(report(self.store, self.manifest)[0]['verdict'], 'unresolved')
        self.assertFalse(self.store.read('proposed-removals.json')['tests'])

    def test_malformed_decisions_cannot_be_recorded_or_promoted(self):
        """Requirement: API schema normalization fails closed; stale-identity checks do not validate answer content."""
        invalid = [None, {'disposition': 'invented'}, {'disposition': 'remove', 'scores': {}},
                   {'disposition': 'remove', 'scores': {'keep': 0, 'remove': float('nan'), 'tighten': 0}}]
        for decision in invalid:
            with self.subTest(decision=decision), self.assertRaises(ValueError):
                self.save(decision)
        self.store.save(f"results/{self.row['id']}.json", ['malformed cache'])
        self.assertEqual(report(self.store, self.manifest)[0]['verdict'], 'unresolved')

    def test_context_gaps_and_contradictions_remain_visible(self):
        """Requirement: full-question decisions preserve uncertainty; disposition-only tests have no context fields."""
        manifest = build(self.store, self.selection, decision_api='fixture-api', explain=True)
        decision = {'disposition': 'remove', 'protection': 'contract',
                    'weakness': 'none', 'contextAdequate': False}
        self.save(decision, manifest)
        self.assertEqual(report(self.store, manifest)[0]['verdict'], 'unresolved')
        decision['contextAdequate'] = True
        self.save(decision, manifest)
        self.assertEqual(report(self.store, manifest)[0]['reviewFlags'],
                         ['remove_without_identified_weakness'])

    def test_artifact_and_cache_symlinks_cannot_modify_foreign_files(self):
        """Regression: valid output roots hid descendant links; source-snapshot checks do not guard artifact IO."""
        foreign = self.base / 'foreign'
        foreign.mkdir()
        sentinel = foreign / 'sentinel'
        sentinel.write_text('private')
        for artifact in ('manifest.json', 'report.md', 'report.json', 'results'):
            with self.subTest(artifact=artifact):
                path = self.store.path / artifact
                if path.exists():
                    path.unlink()
                path.symlink_to(foreign if artifact == 'results' else sentinel,
                                target_is_directory=artifact == 'results')
                with self.assertRaises(ValueError):
                    if artifact == 'manifest.json':
                        self.store.manifest()
                    else:
                        report(self.store, self.manifest)
                self.assertEqual(sentinel.read_text(), 'private')
                self.assertEqual(list(foreign.iterdir()), [sentinel])
                path.unlink()
        missing = foreign / 'missing'
        self.store.file('report.json').unlink(missing_ok=True)
        (self.store.path / 'report.json').symlink_to(missing)
        with self.assertRaises(ValueError):
            self.store.save('report.json', {})
        self.assertFalse(missing.exists())

    def test_private_staging_ignores_legacy_temporary_links(self):
        """Regression: fixed temporary links clobbered source; final-artifact checks do not exercise staging."""
        original = self.source.read_bytes()
        (self.store.path / 'report.json.tmp').symlink_to(self.source)
        self.store.save('report.json', {'complete': True})
        self.assertEqual(self.source.read_bytes(), original)
        self.assertEqual(self.store.read('report.json'), {'complete': True})

    def test_output_and_source_paths_cannot_escape_or_overlap(self):
        """Requirement: language-neutral paths retain containment; descendant-link checks miss root and source overlap."""
        with self.assertRaises(ValueError):
            Store(self.root, self.base / 'outside')
        (self.root / 'escape').symlink_to(self.base, target_is_directory=True)
        with self.assertRaises(ValueError):
            Store(self.root, Path('escape/review'))
        self.store.save('selected.any', {'test': True})
        with self.assertRaises(ValueError):
            build(self.store, [dict(self.selection[0], file='.review/selected.any', startLine=1, endLine=1)])
        (self.base / 'foreign').write_text('outside source\n')
        with self.assertRaises(ValueError):
            build(self.store, [dict(self.selection[0], file='../foreign', startLine=1, endLine=1)])

    def test_shared_installation_cli_isolates_project_roots_and_copied_results(self):
        """Requirement: one installation serves unrelated projects; in-process tests cannot establish caller-cwd behavior."""
        other = self.base / 'other-project'
        other.mkdir()
        (other / 'checks').mkdir()
        (other / 'checks/spec.txt').write_bytes(self.source.read_bytes())
        cli = Path(__file__).with_name('review.py')
        for root in (self.root, other):
            (root / 'selection.json').write_text(encode(self.selection))
            result = subprocess.run([sys.executable, '-B', str(cli), 'build',
                                     '--selection', 'selection.json', '--out', '.review',
                                     '--decision-api', 'fixture-api'], cwd=root,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
        other_store = Store(other, Path('.review'))
        other_manifest = other_store.manifest()
        self.assertEqual(other_manifest['root'], str(other))
        self.save({'disposition': 'remove'})
        saved = self.store.read(f"results/{self.row['id']}.json")
        other_store.save(f"results/{self.row['id']}.json", saved)
        self.assertEqual(report(other_store, other_manifest)[0]['verdict'], 'unresolved')
        other_store.save('manifest.json', self.manifest)
        with self.assertRaises(ValueError):
            other_store.manifest()


if __name__ == '__main__':
    unittest.main()
