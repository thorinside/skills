import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'extractor.dart';

typedef Classify =
    Future<Map<String, dynamic>> Function(
      Map<String, dynamic> request,
      Duration timeout,
    );

Map<String, dynamic> verdict(
  Map<String, dynamic> row,
  Map<String, dynamic>? saved,
) {
  final result = <String, dynamic>{
    'id': row['id'],
    'file': row['file'],
    'line': row['line'],
    'title': row['title'],
    'verdict': 'unresolved',
    'protection': null,
    'weakness': null,
    'contextProbability': null,
    'dispositionScore': null,
  };
  if (row['blocked'] != null) {
    return {...result, 'status': row['blocked']};
  }
  if (digest(jsonEncode(row['request'])) != row['requestHash']) {
    return {...result, 'status': 'Request changed since extraction'};
  }
  if (saved == null || saved['requestHash'] != row['requestHash']) {
    return {...result, 'status': 'Missing or stale classifier result'};
  }
  try {
    final response = saved['response'] as Map<String, dynamic>;
    final data = response['data'] as Map<String, dynamic>;
    if (response['success'] != true ||
        data['model'] != 'qwen3.8-sw' ||
        data['provider'] != 'vllmDecision') {
      return {
        ...result,
        'status': 'Failed result or unexpected model/provider',
      };
    }
    final answers = data['answers'] as Map<String, dynamic>;
    final questions = (row['request'] as Map)['questions'] as Map;
    for (final key in [
      'disposition',
      'protection',
      'weakness',
    ].where(questions.containsKey)) {
      final answer = answers[key] as Map;
      final allowed = (questions[key] as Map)['criteria'] as Map;
      if (answer['kind'] != 'choice' ||
          !allowed.containsKey(answer['choice'])) {
        throw const FormatException('Invalid choice');
      }
      final probabilities = answer['probabilities'] as Map;
      if (probabilities.keys
              .toSet()
              .difference(allowed.keys.toSet())
              .isNotEmpty ||
          allowed.keys.any((key) => !validProbability(probabilities[key])) ||
          (probabilities.values.whereType<num>().fold<double>(
                        0,
                        (sum, value) => sum + value.toDouble(),
                      ) -
                      1)
                  .abs() >
              0.001) {
        throw const FormatException('Invalid probabilities');
      }
    }
    final choice = (answers['disposition'] as Map)['choice'] as String;
    result['rawDisposition'] = choice;
    result['dispositionScore'] =
        (answers['disposition']['probabilities'] as Map)[choice];
    if (questions.length == 1 && questions.containsKey('disposition')) {
      return {
        ...result,
        'verdict': choice,
        'screenOnly': true,
        'status': 'Screened: disposition only, not removal approval',
      };
    }
    final context = answers['contextAdequate'] as Map;
    if (context['kind'] != 'boolean' ||
        !validProbability(context['probability'])) {
      throw const FormatException('Invalid context answer');
    }
    result['protection'] = (answers['protection'] as Map)['choice'];
    result['weakness'] = (answers['weakness'] as Map)['choice'];
    result['contextProbability'] = context['probability'];
    result['dispositionScore'] =
        (answers['disposition']['probabilities'] as Map)[choice];
    if ((context['probability'] as num) < 0.5 ||
        result['weakness'] == 'insufficient_context' ||
        result['protection'] == 'unclear') {
      return {
        ...result,
        'status': 'Insufficient context; not a deletion verdict',
      };
    }
    return {
      ...result,
      'verdict': choice,
      'status': 'Classified',
      'reviewFlags': [
        if (choice == 'remove' && result['weakness'] == 'none')
          'remove_without_identified_weakness',
      ],
    };
  } catch (_) {
    return {...result, 'status': 'Malformed or failed classifier result'};
  }
}

bool validProbability(dynamic value) =>
    value is num && value.isFinite && value >= 0 && value <= 1;

Map<String, dynamic>? readResult(Directory output, String id) {
  final file = File(p.join(output.path, 'results', '$id.json'));
  if (!file.existsSync()) {
    return null;
  }
  try {
    return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
  } catch (_) {
    return null;
  }
}

void saveJson(File file, Object value) {
  file.parent.createSync(recursive: true);
  final temporary = File('${file.path}.tmp');
  temporary.writeAsStringSync(
    '${const JsonEncoder.withIndent('  ').convert(value)}\n',
  );
  temporary.renameSync(file.path);
}

Future<void> classifyAudit({
  required Map<String, dynamic> manifest,
  required Directory output,
  required Classify classify,
  int? limit,
  int concurrency = 1,
  Duration coldTimeout = const Duration(seconds: 120),
  Duration timeout = const Duration(seconds: 30),
  void Function(String)? progress,
}) async {
  if (concurrency < 1 || concurrency > 8) {
    throw const FormatException('Concurrency must be between 1 and 8');
  }
  final pending = <Map<String, dynamic>>[];
  for (final raw in manifest['tests'] as List) {
    final row = raw as Map<String, dynamic>;
    if (row['blocked'] != null || (limit != null && pending.length >= limit)) {
      continue;
    }
    final previous = readResult(output, row['id'] as String);
    // A valid context-inadequate answer is a completed judgment, not a reason
    // to reclassify the same packet on every resume.
    if (previous != null &&
        (verdict(row, previous)['contextProbability'] != null ||
            verdict(row, previous)['screenOnly'] == true)) {
      continue;
    }
    pending.add(row);
  }
  if (pending.isEmpty) {
    return;
  }
  var completed = 0;
  var consecutiveFailures = 0;
  var stopped = false;
  Future<void> runOne(Map<String, dynamic> row, Duration deadline) async {
    final watch = Stopwatch()..start();
    Map<String, dynamic> response;
    try {
      response = await classify(
        row['request'] as Map<String, dynamic>,
        deadline,
      );
    } catch (error) {
      response = {'success': false, 'error': error.runtimeType.toString()};
    }
    consecutiveFailures = response['success'] == true
        ? 0
        : consecutiveFailures + 1;
    if (consecutiveFailures >= 3) {
      stopped = true;
    }
    saveJson(File(p.join(output.path, 'results', '${row['id']}.json')), {
      'requestHash': row['requestHash'],
      'response': response,
      'elapsedMs': watch.elapsedMilliseconds,
    });
    completed++;
    progress?.call(
      '[$completed/${pending.length}] ${row['file']}:${row['line']} ${watch.elapsedMilliseconds}ms ${response['success'] == true ? 'answered' : 'failed'}',
    );
  }

  // Only one request pays the cold-model deadline before concurrent warm work.
  await runOne(pending.first, coldTimeout);
  var cursor = 1;
  await Future.wait([
    for (var worker = 0; worker < concurrency; worker++)
      () async {
        while (!stopped && cursor < pending.length) {
          final row = pending[cursor++];
          await runOne(row, timeout);
        }
      }(),
  ]);
}

List<Map<String, dynamic>> auditResults(
  Map<String, dynamic> manifest,
  Directory output,
) {
  final hashes = <String, String?>{};
  String? currentHash(String path) => hashes.putIfAbsent(path, () {
    try {
      return digest(
        File(checkedPath(manifest['root'] as String, path)).readAsStringSync(),
      );
    } catch (_) {
      return null;
    }
  });
  return [
    for (final raw in manifest['tests'] as List)
      () {
        final row = raw as Map<String, dynamic>;
        final result = verdict(row, readResult(output, row['id'] as String));
        if (currentHash(row['file'] as String) != row['sourceHash']) {
          return {
            ...result,
            'verdict': 'unresolved',
            'status': 'Test source changed since extraction',
          };
        }
        return result;
      }(),
  ];
}

/// Return an exact, source-hash-checked deletion plan before writing any source.
Map<String, String> removalPlan(
  Map<String, dynamic> manifest,
  List<Map<String, dynamic>> results,
) {
  final root = manifest['root'] as String;
  final remove = {
    for (final result in results)
      if (result['verdict'] == 'remove') result['id'],
  };
  final grouped = <String, List<Map<String, dynamic>>>{};
  for (final raw in manifest['tests'] as List) {
    final row = raw as Map<String, dynamic>;
    if (!remove.contains(row['id'])) {
      continue;
    }
    if (row['removable'] != true) {
      throw FormatException(
        'Cannot safely remove unbraced/embedded test: ${row['file']}:${row['line']}',
      );
    }
    (grouped[row['file'] as String] ??= []).add(row);
  }
  final planned = <String, String>{};
  for (final entry in grouped.entries) {
    final file = checkedTestPath(root, entry.key);
    final source = File(file).readAsStringSync();
    final rows = entry.value
      ..sort((a, b) => (b['start'] as int).compareTo(a['start'] as int));
    if (rows.any((row) => digest(source) != row['sourceHash'])) {
      throw FormatException(
        'Source changed since classification: ${entry.key}',
      );
    }
    var updated = source;
    var previousStart = source.length;
    for (final row in rows) {
      final start = row['start'] as int;
      final end = row['end'] as int;
      if (start < 0 ||
          end > previousStart ||
          source.substring(start, end) != row['source']) {
        throw const FormatException('Overlapping or invalid deletion ranges');
      }
      updated = updated.replaceRange(start, end, '');
      previousStart = start;
    }
    // Parse the resulting Dart before any file is changed.
    extractTests(entry.key, updated);
    planned[entry.key] = updated;
  }
  return planned;
}

void writeReport(
  Map<String, dynamic> manifest,
  Directory output, {
  bool applyRemovals = false,
}) {
  if (applyRemovals) {
    throw const FormatException(
      'This skill is review-only; classifier labels never authorize test deletion',
    );
  }
  final results = auditResults(manifest, output);
  final plan = removalPlan(manifest, results);
  final removed = (manifest['tests'] as List)
      .where(
        (row) => results.any(
          (r) => r['id'] == row['id'] && r['verdict'] == 'remove',
        ),
      )
      .toList();
  saveJson(File(p.join(output.path, 'proposed-removals.json')), {
    'tests': removed,
    'files': plan.keys.toList(),
  });
  // Review artifacts only. The skill never writes or deletes target tests.
  saveJson(File(p.join(output.path, 'report.json')), {
    'mode': 'dry-run',
    'tests': results,
    'proposedFiles': plan.keys.toList(),
  });
  String cell(Object? value) =>
      (value ?? '—').toString().replaceAll('|', '\\|').replaceAll('\n', ' ');
  final lines = [
    '# Test quality audit (dry run)',
    '',
    'Classifier: local qwen3.8-sw via Substrate. Labels only; no generated reasons.',
    'Scores are uncalibrated model output, not measured correctness probabilities.',
    'Remove-with-no-weakness contradictions are flagged and cannot be bulk-applied.',
    'Missing context, malformed/failed calls and stale results are unresolved, never removals.',
    '',
    '| Test | Location | Verdict | Model choice | Protection | Weakness | Raw selected score | Status | Review flags |',
    '|---|---|---|---|---|---|---:|---|---|',
    for (final row in results)
      '| ${cell(row['title'])} | ${cell(row['file'])}:${row['line']} | ${row['verdict']} | ${cell(row['rawDisposition'])} | ${cell(row['protection'])} | ${cell(row['weakness'])} | ${cell(row['dispositionScore'])} | ${cell(row['status'])} | ${cell((row['reviewFlags'] as List? ?? []).join(', '))} |',
    '',
    'Source snapshots and exact proposed deleted bodies are preserved in manifest.json and proposed-removals.json.',
    'Advisory review only: no target tests, commits or merges are changed. Verify each candidate against distinct requirements and retained coverage.',
    '',
  ];
  File(p.join(output.path, 'report.md')).writeAsStringSync(lines.join('\n'));
}
