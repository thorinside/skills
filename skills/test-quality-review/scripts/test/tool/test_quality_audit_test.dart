import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:test/test.dart';
import 'package:path/path.dart' as p;

import '../../tool/test_quality_audit.dart' show validateClassifierService;
import '../../tool/test_quality_audit/artifacts.dart';
import '../../tool/test_quality_audit/audit.dart';
import '../../tool/test_quality_audit/extractor.dart';

const fixture = r'''
import '../lib/contract.dart';
void main() {
  group('group', () {
    setUp(() => prepare());
    for (final value in ['a', 'b']) {
      test('contract $value', () {
        expect(contract(value), isTrue);
        // Not another test: test('fake', () {});
        final braces = '{ escaped }';
      });
    }
    testWidgets('vacuous', (tester) async { expect(true, isTrue); });
    blocTest<Object, Object>('errors', build: () => Object(), expect: () => []);
  });
}
''';

void main() {
  late Directory root;
  late ReviewArtifacts output;
  late Map<String, dynamic> questions;
  late Map<String, dynamic> manifest;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('test-quality-audit-');
    root = Directory(root.resolveSymbolicLinksSync());
    output = ReviewArtifacts(root: root.path, path: p.join(root.path, 'audit'));
    Directory(output.path).createSync();
    Directory(p.join(root.path, 'test')).createSync();
    Directory(p.join(root.path, 'lib')).createSync();
    File(
      p.join(root.path, 'test/example_test.dart'),
    ).writeAsStringSync(fixture);
    File(
      p.join(root.path, 'lib/contract.dart'),
    ).writeAsStringSync('bool contract(String value) => value.isNotEmpty;');
    questions =
        jsonDecode(
              File('tool/test_quality_audit/questions.json').readAsStringSync(),
            )
            as Map<String, dynamic>;
    manifest = buildAudit(
      root: root.path,
      files: ['test/example_test.dart'],
      contexts: [],
      questions: questions,
    );
    output.writeJson('manifest.json', manifest);
  });
  tearDown(() => root.delete(recursive: true));

  Map<String, dynamic> response(String decision, {double context = 0.99}) {
    final selections = {
      'disposition': decision,
      'protection': 'contract',
      'weakness': decision == 'remove' ? 'vacuous_assertion' : 'none',
    };
    return {
      'success': true,
      'data': {
        'model': 'fixture-model',
        'provider': 'fixture-provider',
        'answers': {
          for (final entry in selections.entries)
            entry.key: {
              'kind': 'choice',
              'choice': entry.value,
              'probabilities': {
                for (final key
                    in (questions[entry.key]['criteria'] as Map).keys)
                  key: key == entry.value ? 1.0 : 0.0,
              },
            },
          'contextAdequate': {'kind': 'boolean', 'probability': context},
        },
      },
    };
  }

  void saveDecision(int index, String decision, {double context = 0.99}) {
    final row = manifest['tests'][index] as Map;
    output.writeJson('results/${row['id']}.json', {
      'requestHash': row['requestHash'],
      'response': response(decision, context: context),
    });
  }

  test('extracts real AST declarations, group names and loop bindings', () {
    final rows = manifest['tests'] as List;
    expect(rows, hasLength(3));
    expect(rows.first['title'], contains('group > contract'));
    expect(rows.first['loopBindings'], [contains("['a', 'b']")]);
    expect(rows[1]['kind'], 'testWidgets');
    expect(rows[2]['kind'], 'blocTest');
    expect(
      rows[1]['source'],
      "testWidgets('vacuous', (tester) async { expect(true, isTrue); });",
    );
    expect(rows.every((row) => row['removable'] == true), isTrue);
  });

  test(
    'sends only the test file and indicated test, without production source',
    () {
      final row = manifest['tests'][1];
      final input = row['request']['input'];
      expect(input['testFile'], fixture);
      expect(input.containsKey('contexts'), isFalse);
      expect(jsonEncode(input), isNot(contains('bool contract(String value)')));
      expect(input['target']['source'], contains("testWidgets('vacuous'"));
      expect(input['includedLines'], [1, '\n'.allMatches(fixture).length + 1]);
      expect(row['sourceHash'], digest(fixture));
    },
  );

  test('invalid Dart is rejected rather than partially scanned', () {
    expect(
      () => extractTests('bad.dart', 'void main() { test('),
      throwsFormatException,
    );
  });

  test(
    'oversized full files are unresolved and never truncated or sent',
    () async {
      final small = buildAudit(
        root: root.path,
        files: ['test/example_test.dart'],
        contexts: [],
        questions: questions,
        maxBytes: 100,
      );
      var calls = 0;
      await classifyAudit(
        manifest: small,
        output: output,
        classify: (_, _) async {
          calls++;
          return response('remove');
        },
      );
      expect(calls, 0);
      expect(
        auditResults(
          small,
          output,
        ).every((row) => row['verdict'] == 'unresolved'),
        isTrue,
      );
      expect(
        small['tests'][0]['request']['input']['testFile'],
        contains("blocTest<Object, Object>"),
      );
    },
  );

  test(
    'first model call gets cold deadline, warm calls are bounded, cache resumes',
    () async {
      final timeouts = <Duration>[];
      Future<Map<String, dynamic>> classify(
        Map<String, dynamic> request,
        Duration timeout,
      ) async {
        timeouts.add(timeout);
        return response('keep');
      }

      await classifyAudit(
        manifest: manifest,
        output: output,
        classify: classify,
        limit: 2,
      );
      expect(timeouts, [
        const Duration(seconds: 120),
        const Duration(seconds: 30),
      ]);
      timeouts.clear();
      await classifyAudit(
        manifest: manifest,
        output: output,
        classify: classify,
      );
      expect(timeouts, [const Duration(seconds: 120)]);
    },
  );

  test(
    'valid insufficient-context results are cached, not endlessly retried',
    () async {
      saveDecision(1, 'remove', context: 0.2);
      var calls = 0;
      await classifyAudit(
        manifest: {
          ...manifest,
          'tests': [manifest['tests'][1]],
        },
        output: output,
        classify: (_, _) async {
          calls++;
          return response('keep');
        },
      );
      expect(calls, 0);
    },
  );

  test(
    'warm classification concurrency is bounded after the cold call',
    () async {
      var active = 0;
      var peak = 0;
      var calls = 0;
      final release = Completer<void>();
      await classifyAudit(
        manifest: manifest,
        output: output,
        concurrency: 2,
        classify: (_, deadline) async {
          calls++;
          if (calls == 1) {
            expect(deadline, const Duration(seconds: 120));
            return response('keep');
          }
          active++;
          if (active > peak) {
            peak = active;
          }
          if (active == 2) {
            release.complete();
          }
          await release.future;
          active--;
          return response('keep');
        },
      );
      expect(calls, 3);
      expect(peak, 2);
    },
  );

  test('verdict-only screens are visible but cannot apply removals', () {
    final row = manifest['tests'][1] as Map<String, dynamic>;
    (row['request'] as Map)['questions'] = {
      'disposition': questions['disposition'],
    };
    row['requestHash'] = digest(jsonEncode(row['request']));
    saveDecision(1, 'remove');
    final result = auditResults(manifest, output)[1];
    expect(result['verdict'], 'remove');
    expect(result['screenOnly'], isTrue);
    writeReport(manifest, output);
    expect(
      () => writeReport(manifest, output, applyRemovals: true),
      throwsFormatException,
    );
    expect(
      File(p.join(root.path, 'test/example_test.dart')).readAsStringSync(),
      fixture,
    );
  });

  test(
    'repeated transport failures stop the batch instead of flooding failures',
    () async {
      final row = manifest['tests'][0] as Map<String, dynamic>;
      final many = {
        ...manifest,
        'tests': [
          for (var i = 0; i < 20; i++) {...row, 'id': '${row['id']}-$i'},
        ],
      };
      var calls = 0;
      await classifyAudit(
        manifest: many,
        output: output,
        concurrency: 4,
        classify: (_, _) async {
          calls++;
          throw const SocketException('transport unavailable');
        },
      );
      // Three failures may already have up to concurrency - 1 peers in flight.
      expect(calls, lessThanOrEqualTo(3 + 4 - 1));
      expect(calls, greaterThanOrEqualTo(3));
    },
  );

  test('failed calls are saved unresolved without immediate retry', () async {
    var calls = 0;
    await classifyAudit(
      manifest: manifest,
      output: output,
      limit: 1,
      classify: (_, _) async {
        calls++;
        throw TimeoutException('cold load');
      },
    );
    expect(calls, 1);
    expect(auditResults(manifest, output).first['verdict'], 'unresolved');
    expect(
      readResult(output, manifest['tests'][0]['id'])!['response']['error'],
      'TimeoutException',
    );
  });

  test('insufficient context overrides a raw remove choice', () {
    saveDecision(1, 'remove', context: 0.2);
    final result = auditResults(manifest, output)[1];
    expect(result['rawDisposition'], 'remove');
    expect(result['verdict'], 'unresolved');
    writeReport(manifest, output);
    final proposals = jsonDecode(
      File(p.join(output.path, 'proposed-removals.json')).readAsStringSync(),
    );
    expect(proposals['tests'], isEmpty);
    expect(proposals['files'], isEmpty);
  });

  test(
    'malformed probabilities and stale hashes cannot authorize deletion',
    () {
      final row = manifest['tests'][1] as Map<String, dynamic>;
      final malformed = response('remove');
      malformed['data']['answers']['disposition']['probabilities']['remove'] =
          double.nan;
      expect(
        verdict(row, {
          'requestHash': row['requestHash'],
          'response': malformed,
        })['verdict'],
        'unresolved',
      );
      expect(
        verdict(row, {
          'requestHash': 'old',
          'response': response('remove'),
        })['verdict'],
        'unresolved',
      );
    },
  );

  test(
    'production is not an input, but changed test source invalidates results',
    () {
      saveDecision(1, 'remove');
      File(
        p.join(root.path, 'lib/contract.dart'),
      ).writeAsStringSync('bool contract(String value) => false;');
      expect(auditResults(manifest, output)[1]['verdict'], 'remove');
      File(
        p.join(root.path, 'test/example_test.dart'),
      ).writeAsStringSync('$fixture\n// changed');
      final changed = auditResults(manifest, output)[1];
      expect(changed['verdict'], 'unresolved');
      expect(changed['status'], 'Test source changed since extraction');
      writeReport(manifest, output);
      final proposals = jsonDecode(
        File(p.join(output.path, 'proposed-removals.json')).readAsStringSync(),
      );
      expect(proposals['tests'], isEmpty);
      expect(proposals['files'], isEmpty);
    },
  );

  test(
    'dry run archives proposals and contradictory labels cannot authorize changes',
    () {
      saveDecision(0, 'keep');
      saveDecision(1, 'remove');
      saveDecision(2, 'tighten');
      writeReport(manifest, output);
      expect(
        File(p.join(root.path, 'test/example_test.dart')).readAsStringSync(),
        fixture,
      );
      final proposed = jsonDecode(
        File(p.join(output.path, 'proposed-removals.json')).readAsStringSync(),
      );
      expect(proposed['tests'], hasLength(1));
      expect(proposed['tests'][0]['source'], contains("testWidgets('vacuous'"));
      final report = File(p.join(output.path, 'report.md')).readAsStringSync();
      expect(report, contains('dry run'));
      expect(report, contains('no generated reasons'));
      expect(report, contains('remove'));

      final row = manifest['tests'][1] as Map<String, dynamic>;
      final contradictory = response('remove');
      contradictory['data']['answers']['weakness'] = response(
        'keep',
      )['data']['answers']['weakness'];
      output.writeJson('results/${row['id']}.json', {
        'requestHash': row['requestHash'],
        'response': contradictory,
      });
      expect(auditResults(manifest, output)[1]['reviewFlags'], [
        'remove_without_identified_weakness',
      ]);
      expect(
        () => writeReport(manifest, output, applyRemovals: true),
        throwsFormatException,
      );
      expect(
        File(p.join(root.path, 'test/example_test.dart')).readAsStringSync(),
        fixture,
      );
    },
  );

  test(
    'review-only requirement: even an explicit apply preserves the classified test and siblings',
    () {
      saveDecision(1, 'remove');
      // Upstream deletion coverage did not protect this skill's read-only boundary.
      expect(
        () => writeReport(manifest, output, applyRemovals: true),
        throwsFormatException,
      );
      final updated = File(
        p.join(root.path, 'test/example_test.dart'),
      ).readAsStringSync();
      final remaining = extractTests('test/example_test.dart', updated);
      expect(remaining, hasLength(3));
      expect(updated, contains('setUp(() => prepare())'));
      expect(updated, contains("test('contract"));
      expect(updated, contains("blocTest<Object, Object>('errors'"));
      expect(updated, fixture);
    },
  );

  test(
    'review-only regression: unanimous remove labels still cannot delete a test file',
    () {
      for (var index = 0; index < 3; index++) {
        saveDecision(index, 'remove');
      }
      // Single-candidate refusal alone does not protect whole-file removal paths.
      expect(
        () => writeReport(manifest, output, applyRemovals: true),
        throwsFormatException,
      );
      expect(
        File(p.join(root.path, 'test/example_test.dart')).readAsStringSync(),
        fixture,
      );
      writeReport(manifest, output);
      expect(
        (jsonDecode(
              File(
                p.join(output.path, 'proposed-removals.json'),
              ).readAsStringSync(),
            )['tests']
            as List),
        hasLength(3),
      );
      expect(
        (jsonDecode(
              File(p.join(output.path, 'manifest.json')).readAsStringSync(),
            )['originals']
            as Map)['test/example_test.dart'],
        fixture,
      );
    },
  );

  test(
    'advisory reporting regression: an unbraced removal candidate still produces reports',
    () {
      // Extractor-only coverage did not exercise the deletion planner in reporting.
      const source =
          "void main() { for (final n in [1,2]) test('case', () {}); }";
      File(
        p.join(root.path, 'test/example_test.dart'),
      ).writeAsStringSync(source);
      manifest = buildAudit(
        root: root.path,
        files: ['test/example_test.dart'],
        questions: questions,
      );
      final row = manifest['tests'][0] as Map<String, dynamic>;
      expect(row['removable'], isFalse);
      (row['request'] as Map)['questions'] = {
        'disposition': questions['disposition'],
      };
      row['requestHash'] = digest(jsonEncode(row['request']));
      saveDecision(0, 'remove');
      writeReport(manifest, output);
      final report = jsonDecode(
        File(p.join(output.path, 'report.json')).readAsStringSync(),
      );
      expect(report['tests'].single['verdict'], 'remove');
      expect(report['proposedFiles'], ['test/example_test.dart']);
      final proposals = jsonDecode(
        File(p.join(output.path, 'proposed-removals.json')).readAsStringSync(),
      );
      expect(proposals['tests'].single['source'], row['source']);
      expect(
        File(p.join(output.path, 'report.md')).readAsStringSync(),
        contains('case'),
      );
      expect(
        () => writeReport(manifest, output, applyRemovals: true),
        throwsFormatException,
      );
      expect(
        File(p.join(root.path, 'test/example_test.dart')).readAsStringSync(),
        source,
      );
    },
  );

  test(
    'artifact containment regression: a report symlink cannot overwrite target source',
    () {
      // Output-directory escape checks did not cover links beneath a valid output.
      Link(
        p.join(output.path, 'report.md'),
      ).createSync(p.join(root.path, 'test/example_test.dart'));
      expect(() => writeReport(manifest, output), throwsFormatException);
      expect(
        File(p.join(root.path, 'test/example_test.dart')).readAsStringSync(),
        fixture,
      );
    },
  );

  for (final cache in ['results', 'screen-results']) {
    test(
      'artifact containment requirement: $cache links cannot reuse or overwrite foreign state',
      () async {
        // Leaf report checks do not cover directory links in cached/archived results.
        final foreign = Directory.systemTemp.createTempSync('foreign-review-');
        addTearDown(() => foreign.deleteSync(recursive: true));
        final sentinel = File(p.join(foreign.path, 'sentinel.json'))
          ..writeAsStringSync('{"private":true}');
        Link(p.join(output.path, cache)).createSync(foreign.path);
        expect(
          () => output.file('$cache/sentinel.json'),
          throwsFormatException,
        );
        expect(
          () => output.writeJson('$cache/sentinel.json', {'private': false}),
          throwsFormatException,
        );
        if (cache == 'results') {
          var calls = 0;
          await expectLater(
            classifyAudit(
              manifest: manifest,
              output: output,
              classify: (_, _) async {
                calls++;
                return response('keep');
              },
            ),
            throwsFormatException,
          );
          expect(calls, 0);
        }
        expect(sentinel.readAsStringSync(), '{"private":true}');
        expect(foreign.listSync(), hasLength(1));
      },
    );
  }

  test(
    'artifact containment regression: legacy temporary links cannot overwrite source',
    () {
      // Final-path checks alone miss the old writer's fixed filename.tmp staging path.
      Link(
        p.join(output.path, 'report.json.tmp'),
      ).createSync(p.join(root.path, 'test/example_test.dart'));
      output.writeJson('report.json', {'review': 'complete'});
      expect(jsonDecode(output.file('report.json').readAsStringSync()), {
        'review': 'complete',
      });
      expect(
        File(p.join(root.path, 'test/example_test.dart')).readAsStringSync(),
        fixture,
      );
    },
  );

  test(
    'artifact containment requirement: dangling links cannot create foreign files',
    () {
      // Existing-file escape coverage misses links whose destination is absent.
      final foreign = Directory.systemTemp.createTempSync('missing-review-');
      addTearDown(() => foreign.deleteSync(recursive: true));
      final missing = File(p.join(foreign.path, 'missing.json'));
      output.file('manifest.json').deleteSync();
      Link(p.join(output.path, 'manifest.json')).createSync(missing.path);
      expect(
        () => output.writeJson('manifest.json', {'review': 'complete'}),
        throwsFormatException,
      );
      expect(missing.existsSync(), isFalse);
    },
  );

  test('production files cannot become removal targets', () {
    expect(
      () => checkedTestPath(root.path, 'lib/contract.dart'),
      throwsFormatException,
    );
  });

  test('source paths cannot escape through traversal or symlinks', () {
    expect(() => checkedPath(root.path, '../outside.dart'), throwsA(anything));
    Link(
      p.join(root.path, 'test/link.dart'),
    ).createSync(Directory.systemTemp.path);
    expect(() => checkedPath(root.path, 'test/link.dart'), throwsA(anything));
  });

  // Existing cache tests bind request hashes only; caller-selected classifier
  // identity must also prevent reusing a result from another service.
  test(
    'configured classifier identity isolates cached review judgments',
    () async {
      final row = (manifest['tests'] as List).first as Map<String, dynamic>;
      row['expectedClassifier'] = {
        'service': 'fixture-service',
        'provider': 'fixture-provider',
        'model': 'fixture-model',
      };
      await classifyAudit(
        manifest: manifest,
        output: output,
        classify: (_, _) async => response('keep'),
      );
      final saved = readResult(output, row['id'] as String)!;
      expect(verdict(row, saved)['verdict'], 'keep');
      (row['expectedClassifier'] as Map)['service'] = 'another-service';
      expect(verdict(row, saved)['verdict'], 'unresolved');
      (row['expectedClassifier'] as Map)['service'] = 'fixture-service';
      (row['expectedClassifier'] as Map)['provider'] = 'another-provider';
      expect(verdict(row, saved)['verdict'], 'unresolved');
      (row['expectedClassifier'] as Map)['provider'] = 'fixture-provider';
      (row['expectedClassifier'] as Map)['model'] = 'another-model';
      expect(verdict(row, saved)['verdict'], 'unresolved');
    },
  );

  test(
    'inference requires the caller-selected provider/model without fallback',
    () {
      expect(
        () => validateClassifierService(
          {
            'success': true,
            'data': {
              'enabled': true,
              'serviceType': 'classifier',
              'classifierConfig': {
                'provider': 'other-provider',
                'model': 'fixture-model',
              },
            },
          },
          provider: 'fixture-provider',
          model: 'fixture-model',
        ),
        throwsFormatException,
      );
      expect(
        () => validateClassifierService(
          {
            'success': true,
            'data': {
              'enabled': true,
              'serviceType': 'classifier',
              'classifierConfig': {
                'provider': 'fixture-provider',
                'model': 'fixture-model',
              },
            },
          },
          provider: 'fixture-provider',
          model: 'fixture-model',
        ),
        returnsNormally,
      );
    },
  );
}
