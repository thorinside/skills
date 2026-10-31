import 'dart:convert';
import 'dart:io';

import 'package:args/args.dart';
import 'package:mcp_dart/mcp_dart.dart';
import 'package:path/path.dart' as p;

import 'test_quality_audit/audit.dart';
import 'test_quality_audit/extractor.dart';

Future<void> main(List<String> arguments) async {
  silenceMcpLogs();
  final parser = ArgParser()
    ..addMultiOption('file', help: 'Exact Dart test files; repeatable.')
    ..addMultiOption(
      'name',
      help: 'Only titles containing one of these strings.',
    )
    ..addOption('out', defaultsTo: '.dart_tool/test-quality-audit')
    ..addOption('max-bytes', defaultsTo: '1048576')
    ..addOption(
      'max-tokens',
      defaultsTo: '32768',
      help: 'Context ceiling, including criteria; at most 32768.',
    )
    ..addOption(
      'concurrency',
      defaultsTo: '1',
      help: 'Bounded warm classifier calls in flight.',
    )
    ..addOption(
      'limit',
      help: 'Maximum new classifier calls in this invocation.',
    )
    ..addOption(
      'mcp-config',
      help: 'MCP JSON config containing the registered Substrate HTTP server.',
    )
    ..addOption('server', defaultsTo: 'substrate')
    ..addOption(
      'cold-timeout',
      defaultsTo: '120',
      help:
          'First classification deadline in seconds, including model loading.',
    )
    ..addOption(
      'timeout',
      defaultsTo: '30',
      help: 'Subsequent classification deadlines in seconds.',
    )
    ..addFlag(
      'verdict-only',
      negatable: false,
      help:
          'Screen with keep/remove/tighten only; removals still need full verification.',
    )
    ..addFlag(
      'verify-removals',
      negatable: false,
      help: 'Run full categorical checks only for screened remove candidates.',
    )
    ..addFlag(
      'dry-run',
      negatable: false,
      help: 'Write proposals/reports only (the default).',
    )
    ..addFlag(
      'apply-removals',
      negatable: false,
      help: 'Unsupported: this skill is review-only and never edits tests.',
    )
    ..addFlag('help', abbr: 'h', negatable: false);
  try {
    if (arguments.isEmpty ||
        arguments.contains('--help') ||
        arguments.contains('-h')) {
      stdout.writeln(
        'dart tool/test_quality_audit.dart build|run|report [options]\n${parser.usage}',
      );
      return;
    }
    final command = arguments.first;
    if (!{'build', 'run', 'report'}.contains(command)) {
      throw const FormatException('Expected build, run or report');
    }
    final options = parser.parse(arguments.skip(1).toList());
    if (options.flag('verdict-only') && options.flag('verify-removals')) {
      throw const FormatException('Choose screening or verification, not both');
    }
    if (options.flag('apply-removals')) {
      throw const FormatException(
        'This skill is review-only; classifier labels never authorize test deletion',
      );
    }
    int positive(String key) {
      final value = int.tryParse(options.option(key) ?? '');
      if (value == null || value <= 0) {
        throw FormatException('--$key must be positive');
      }
      return value;
    }

    final output = Directory(p.absolute(options.option('out')!))
      ..createSync(recursive: true);
    final manifestFile = File(p.join(output.path, 'manifest.json'));
    late Map<String, dynamic> manifest;
    if (command == 'build' ||
        (command == 'run' && options.multiOption('file').isNotEmpty)) {
      if (options.multiOption('file').isEmpty) {
        throw const FormatException(
          'Specify at least one --file; the tool never silently audits the whole repository',
        );
      }
      final questionsFile = File.fromUri(
        Platform.script.resolve('test_quality_audit/questions.json'),
      );
      manifest = buildAudit(
        root: Directory.current.path,
        files: options.multiOption('file').toSet().toList(),
        names: options.multiOption('name'),
        questions:
            jsonDecode(questionsFile.readAsStringSync())
                as Map<String, dynamic>,
        maxBytes: positive('max-bytes'),
      );
      final rawFile = File(p.join(output.path, 'unbudgeted.json'));
      final budgetedFile = File(p.join(output.path, 'budgeted.json'));
      saveJson(rawFile, manifest);
      final budgetScript = File.fromUri(
        Platform.script.resolve('test_quality_audit/budget.py'),
      );
      ProcessResult budgetResult;
      try {
        budgetResult = await Process.run('uv', [
          'run',
          '--with',
          'tiktoken',
          'python',
          budgetScript.path,
          rawFile.path,
          budgetedFile.path,
          '--max-tokens',
          positive('max-tokens').toString(),
        ]);
      } on ProcessException {
        budgetResult = await Process.run('python3', [
          budgetScript.path,
          rawFile.path,
          budgetedFile.path,
          '--max-tokens',
          positive('max-tokens').toString(),
        ]);
      }
      if (budgetResult.exitCode != 0) {
        throw const FormatException(
          'Token budgeting failed; no classification attempted',
        );
      }
      stdout.write(budgetResult.stdout);
      manifest =
          jsonDecode(budgetedFile.readAsStringSync()) as Map<String, dynamic>;
      for (final row in manifest['tests'] as List) {
        row['requestHash'] = digest(jsonEncode(row['request']));
      }
      saveJson(manifestFile, manifest);
      rawFile.deleteSync();
      budgetedFile.deleteSync();
    } else {
      manifest =
          jsonDecode(manifestFile.readAsStringSync()) as Map<String, dynamic>;
    }
    if (options.flag('verdict-only')) {
      for (final row in manifest['tests'] as List) {
        final previous = readResult(output, row['id'] as String);
        if (previous != null &&
            verdict(
                  row as Map<String, dynamic>,
                  previous,
                )['contextProbability'] !=
                null) {
          continue;
        }
        final request = row['request'] as Map<String, dynamic>;
        final questions = request['questions'] as Map;
        request['questions'] = {'disposition': questions['disposition']};
        row['requestHash'] = digest(jsonEncode(request));
      }
      manifest['verdictOnly'] = true;
      saveJson(manifestFile, manifest);
    }
    if (options.flag('verify-removals')) {
      final fullQuestions =
          jsonDecode(
                File.fromUri(
                  Platform.script.resolve('test_quality_audit/questions.json'),
                ).readAsStringSync(),
              )
              as Map<String, dynamic>;
      for (final raw in manifest['tests'] as List) {
        final row = raw as Map<String, dynamic>;
        final previous = readResult(output, row['id'] as String);
        final result = verdict(row, previous);
        if (result['screenOnly'] == true && result['verdict'] == 'remove') {
          saveJson(
            File(p.join(output.path, 'screen-results', '${row['id']}.json')),
            previous!,
          );
          row['screenDisposition'] = result['verdict'];
          (row['request'] as Map)['questions'] = fullQuestions;
          row['requestHash'] = digest(jsonEncode(row['request']));
        }
      }
      saveJson(manifestFile, manifest);
    }
    if (command == 'run') {
      final configPath = options.option('mcp-config');
      if (configPath == null) {
        throw const FormatException(
          '--mcp-config is required for run; no classifier endpoint or credentials are embedded',
        );
      }
      final config = jsonDecode(File(configPath).readAsStringSync()) as Map;
      final server =
          (config['mcpServers'] as Map)[options.option('server')] as Map?;
      if (server == null || server['url'] is! String) {
        throw const FormatException(
          'Configured Substrate server must provide an HTTP MCP url',
        );
      }
      final uri = Uri.parse(server['url'] as String);
      if (!{'http', 'https'}.contains(uri.scheme)) {
        throw const FormatException('Unsupported MCP transport');
      }
      final headers = <String, String>{};
      for (final entry in (server['headers'] as Map? ?? {}).entries) {
        headers[entry.key as String] = (entry.value as String).replaceAllMapped(
          RegExp(r'\$\{([^}]+)\}'),
          (match) {
            final value = Platform.environment[match[1]];
            if (value == null) {
              throw const FormatException(
                'A configured authentication environment variable is missing',
              );
            }
            return value;
          },
        );
      }
      final client = McpClient(
        const Implementation(name: 'test-quality-review', version: '1.0.0'),
        options: const McpClientOptions(protocol: McpProtocol.legacy),
      );
      final transport = StreamableHttpClientTransport(
        uri,
        opts: StreamableHttpClientTransportOptions(
          requestInit: {'headers': headers},
        ),
      );
      try {
        await client.connect(transport).timeout(const Duration(seconds: 30));
        Future<Map<String, dynamic>> call(
          String name,
          Map<String, dynamic> args,
          Duration timeout,
        ) async {
          final result = await client.callTool(
            CallToolRequest(name: name, arguments: args),
            options: RequestOptions(timeout: timeout, maxTotalTimeout: timeout),
          );
          final structured = result.structuredContentJson?.toJson();
          final value =
              structured ??
              jsonDecode(result.content.whereType<TextContent>().first.text);
          if (value is! Map<String, dynamic>) {
            throw const FormatException('Unexpected Substrate response');
          }
          return value;
        }

        await call('get_tool', {
          'name': 'get_service',
        }, const Duration(seconds: 30));
        final service = await call('get_service', {
          'name': 'classifier',
        }, const Duration(seconds: 30));
        validateLocalService(service);
        final schema = await call('get_tool', {
          'name': 'create_classification',
        }, const Duration(seconds: 30));
        if (schema['success'] != true) {
          throw const FormatException(
            'Substrate classification tool is unavailable',
          );
        }
        await classifyAudit(
          manifest: manifest,
          output: output,
          limit: options.option('limit') == null ? null : positive('limit'),
          concurrency: positive('concurrency'),
          coldTimeout: Duration(seconds: positive('cold-timeout')),
          timeout: Duration(seconds: positive('timeout')),
          classify: (request, timeout) => call('create_classification', {
            'service': 'classifier',
            'request': request,
            'timeoutMs': timeout.inMilliseconds,
          }, timeout + const Duration(seconds: 10)),
          progress: stdout.writeln,
        );
      } finally {
        await client.close();
      }
    }
    writeReport(
      manifest,
      output,
      applyRemovals: options.flag('apply-removals'),
    );
    final results =
        (jsonDecode(File(p.join(output.path, 'report.json')).readAsStringSync())
                as Map)['tests']
            as List;
    final counts = <String, int>{};
    for (final result in results) {
      final verdict = result['verdict'] as String;
      counts[verdict] = (counts[verdict] ?? 0) + 1;
    }
    stdout.writeln(
      jsonEncode({
        'mode': options.flag('apply-removals') ? 'applied' : 'dry-run',
        'counts': counts,
        'report': p.join(output.path, 'report.md'),
      }),
    );
  } on FormatException catch (error) {
    stderr.writeln(error.message);
    exitCode = 1;
  } on McpError catch (error) {
    stderr.writeln(
      'Audit MCP failure (code ${error.code}); no source files changed.',
    );
    exitCode = 1;
  } catch (error) {
    // Do not echo transport/config errors that could contain auth metadata.
    stderr.writeln(
      'Audit failed (${error.runtimeType}); source files were not automatically committed or merged.',
    );
    exitCode = 1;
  }
}

void validateLocalService(Map<String, dynamic> service) {
  final data = service['data'] as Map?;
  final config = data?['classifierConfig'] as Map?;
  if (service['success'] != true ||
      data?['enabled'] != true ||
      data?['serviceType'] != 'classifier' ||
      config?['provider'] != 'vllmDecision' ||
      config?['model'] != 'qwen3.8-sw') {
    throw const FormatException(
      'Refusing inference: classifier must be enabled local vllmDecision/qwen3.8-sw; no paid fallback',
    );
  }
}
