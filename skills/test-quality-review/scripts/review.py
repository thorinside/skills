#!/usr/bin/env python3
"""Build language-neutral test packets and report saved system-one decisions."""
import argparse
import hashlib
import json
import math
import os
import sys
from pathlib import Path
import tempfile

from budget import budget_row, token_counter


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


class Store:
    """Keep artifacts inside one repository; reject all descendant symlinks."""
    def __init__(self, project, output):
        self.root = Path(project).resolve(strict=True)
        self.path = Path(os.path.abspath(self.root / output))
        if not self.path.is_relative_to(self.root) or self.path == self.root:
            raise ValueError('Review output must be inside the target repository')
        self._check(self.path)

    def _check(self, path):
        current = self.root
        for part in path.relative_to(self.root).parts:
            current /= part
            if current.is_symlink():
                raise ValueError('Review artifact paths must not contain symlinks')
        return path

    def file(self, relative):
        path = Path(os.path.abspath(self.path / relative))
        if not path.is_relative_to(self.path) or path == self.path:
            raise ValueError('Artifacts must stay inside the review directory')
        return self._check(path)

    def read(self, relative):
        return json.loads(self.file(relative).read_bytes())

    def write(self, relative, text):
        destination = self.file(relative)
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.review-', dir=destination.parent) as temporary:
            staged = Path(temporary) / 'artifact'
            staged.write_bytes(text.encode('utf-8'))
            self.file(relative)
            os.replace(staged, destination)

    def save(self, relative, value):
        self.write(relative, json.dumps(value, ensure_ascii=False, indent=2) + '\n')

    def manifest(self):
        manifest = self.read('manifest.json')
        if manifest.get('root') != str(self.root):
            raise ValueError('Review state belongs to a different repository')
        if manifest.get('version') != 'source-ranges-v1':
            raise ValueError('Incompatible review state; use a fresh output directory')
        return manifest


def source_file(store, relative):
    path = (store.root / relative).resolve(strict=True)
    if not path.is_relative_to(store.root) or path == store.root:
        raise ValueError('Test source must be inside the target repository')
    if path.is_relative_to(store.path):
        raise ValueError('Test source must be outside the review output directory')
    return path


def build(store, selection, *, decision_api=None, explain=False, max_tokens=32768,
          allow_multiple_files=False):
    if not 2048 < max_tokens <= 32768:
        raise ValueError('max-tokens must be greater than 2048 and at most 32768')
    if store.file('manifest.json').exists():
        store.manifest()
    questions = json.loads(Path(__file__).with_name('questions.json').read_bytes())
    if not explain:
        questions = {'disposition': questions['disposition']}
    if not isinstance(selection, list) or not selection:
        raise ValueError('Select at least one complete test source range')
    count, estimator = token_counter()
    rows, files, identifiers = [], set(), set()
    for target in selection:
        path = source_file(store, target['file'])
        relative = path.relative_to(store.root).as_posix()
        files.add(relative)
        if len(files) > 1 and not allow_multiple_files:
            raise ValueError('Multiple files require explicit --allow-multiple-files')
        source = path.read_bytes().decode('utf-8')
        lines = source.splitlines(keepends=True)
        start, end = target['startLine'], target['endLine']
        if (type(start) is not int or type(end) is not int
                or not 1 <= start <= end <= len(lines)):
            raise ValueError('Test source range must contain valid inclusive line numbers')
        title = target['title']
        bindings = target.get('loopBindings', [])
        if not isinstance(title, str) or not title.strip():
            raise ValueError('Each selected test requires a title')
        if not isinstance(bindings, list) or any(not isinstance(x, str) for x in bindings):
            raise ValueError('loopBindings must contain source strings')
        body = ''.join(lines[start - 1:end])
        source_hash = digest(source)
        identifier = digest(f'{relative}:{start}:{end}:{source_hash}')[:20]
        if identifier in identifiers:
            raise ValueError('Duplicate selected test source range')
        identifiers.add(identifier)
        request = {
            'input': {
                'file': relative, 'testFile': source,
                'target': {'title': title, 'startLine': start, 'endLine': end,
                           'source': body, 'loopBindings': bindings},
            },
            'questions': questions,
        }
        row = {'id': identifier, 'file': relative, 'title': title,
               'line': start, 'endLine': end, 'source': body,
               'sourceHash': source_hash, 'request': request}
        budget_row(row, count, estimator, max_tokens)
        row['requestHash'] = digest(encode(request))
        rows.append(row)
    manifest = {'version': 'source-ranges-v1', 'root': str(store.root),
                'decisionApi': decision_api, 'contextLimit': max_tokens, 'tests': rows}
    store.save('manifest.json', manifest)
    return manifest


def probability(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1


def judge(store, manifest, row, saved):
    result = {key: row[key] for key in ('id', 'file', 'title', 'line')}
    result.update(verdict='unresolved', status='Missing or stale decision')
    try:
        source = source_file(store, row['file']).read_bytes().decode('utf-8')
    except (OSError, ValueError):
        source = None
    if source is None or digest(source) != row['sourceHash']:
        return dict(result, status='Test source changed since selection')
    if row.get('blocked'):
        return dict(result, status=row['blocked'])
    if digest(encode(row['request'])) != row['requestHash']:
        return dict(result, status='Request changed since selection')
    expected = manifest.get('decisionApi')
    if (not isinstance(saved, dict) or not expected or saved.get('root') != str(store.root)
            or saved.get('requestHash') != row['requestHash']
            or saved.get('decisionApi') != expected):
        return result
    try:
        answers = saved['decision']
        questions = row['request']['questions']
        for key in ('disposition', 'protection', 'weakness'):
            if key in questions and answers[key] not in questions[key]['criteria']:
                raise ValueError('Invalid categorical answer')
        choice = answers['disposition']
        result.update(rawDisposition=choice)
        scores = answers.get('scores')
        if scores is not None:
            if (set(scores) != set(questions['disposition']['criteria'])
                    or not all(probability(x) for x in scores.values())
                    or abs(sum(scores.values()) - 1) > 0.001):
                raise ValueError('Invalid scores')
            result['dispositionScore'] = scores[choice]
        if len(questions) == 1:
            return dict(result, verdict=choice, screenOnly=True, status='Screened')
        context = answers['contextAdequate']
        if type(context) is not bool:
            raise ValueError('Invalid context answer')
        result.update(protection=answers['protection'], weakness=answers['weakness'],
                      contextAdequate=context)
        if (not context or result['protection'] == 'unclear'
                or result['weakness'] == 'insufficient_context'):
            return dict(result, status='Insufficient context')
        flags = (['remove_without_identified_weakness']
                 if choice == 'remove' and result['weakness'] == 'none' else [])
        return dict(result, verdict=choice, status='Classified', reviewFlags=flags)
    except (KeyError, TypeError, ValueError, AttributeError):
        return dict(result, status='Malformed decision')


def report(store, manifest):
    rows = []
    for row in manifest['tests']:
        path = store.file(f"results/{row['id']}.json")
        try:
            saved = json.loads(path.read_bytes()) if path.exists() else None
        except (ValueError, OSError):
            saved = None
        rows.append(judge(store, manifest, row, saved))
    candidates = {row['id'] for row in rows if row['verdict'] == 'remove'}
    proposals = [row for row in manifest['tests'] if row['id'] in candidates]
    store.save('proposed-removals.json', {'tests': proposals,
               'files': sorted({row['file'] for row in proposals})})
    store.save('report.json', {'tests': rows})
    def cell(value):
        return str(value).replace('|', '\\|').replace('\n', ' ')
    lines = ['# Test quality review', '',
             'System-one decisions; the agent supplies source-grounded reasons.',
             'Scores are uncalibrated. Selected source ranges are not a runtime inventory.', '',
             '| Test | Location | Verdict | Status |', '|---|---|---|---|']
    for row in rows:
        lines.append(f"| {cell(row['title'])} | {cell(row['file'])}:{row['line']} | "
                     f"{row['verdict']} | {cell(row['status'])} |")
    store.write('report.md', '\n'.join(lines) + '\n')
    return rows


def record(store, manifest, identifier, decision, request_hash, decision_api):
    row = next((row for row in manifest['tests'] if row['id'] == identifier), None)
    if row is None or request_hash != row['requestHash']:
        raise ValueError('Decision must name a selected test and its exact request hash')
    if not decision_api or decision_api != manifest.get('decisionApi'):
        raise ValueError('Decision API must match the packet identity')
    saved = {'root': str(store.root), 'requestHash': request_hash,
             'decisionApi': decision_api, 'decision': decision}
    result = judge(store, manifest, row, saved)
    if result['status'] not in ('Screened', 'Classified', 'Insufficient context'):
        raise ValueError(result['status'])
    store.save(f'results/{identifier}.json', saved)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('build', 'record', 'report'))
    parser.add_argument('--project', type=Path, default=Path.cwd())
    parser.add_argument('--out', type=Path, default=Path('.test-quality-review'))
    parser.add_argument('--selection', type=Path)
    parser.add_argument('--explain', action='store_true')
    parser.add_argument('--allow-multiple-files', action='store_true')
    parser.add_argument('--max-tokens', type=int, default=32768)
    for key in ('decision-api', 'id', 'request-hash'):
        parser.add_argument('--' + key)
    parser.add_argument('--response', type=Path)
    args = parser.parse_args(argv)
    try:
        store = Store(args.project, args.out)
        if args.command == 'build':
            if not args.selection:
                raise ValueError('build requires --selection')
            selection = json.loads((store.root / args.selection).read_bytes())
            manifest = build(store, selection, decision_api=args.decision_api,
                             explain=args.explain, max_tokens=args.max_tokens,
                             allow_multiple_files=args.allow_multiple_files)
        else:
            manifest = store.manifest()
        if args.command == 'record':
            if not args.id or not args.response or not args.request_hash or not args.decision_api:
                raise ValueError('record requires --id, --response, --request-hash and --decision-api')
            record(store, manifest, args.id,
                   json.loads((store.root / args.response).read_bytes()),
                   args.request_hash, args.decision_api)
        rows = report(store, manifest)
        print(encode({'report': str(store.file('report.md')), 'tests': len(rows),
                      'counts': {key: sum(row['verdict'] == key for row in rows)
                                 for key in ('keep', 'tighten', 'remove', 'unresolved')}}))
        return 0
    except (OSError, ValueError, KeyError, TypeError):
        # Avoid echoing source/response/config contents through parser exceptions.
        print('Review failed; check selection, artifact paths and decision API identity.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
