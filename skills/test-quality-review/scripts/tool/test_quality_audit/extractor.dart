import 'dart:convert';
import 'dart:io';

import 'package:analyzer/dart/analysis/utilities.dart';
import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/visitor.dart';
import 'package:crypto/crypto.dart';
import 'package:path/path.dart' as p;

String digest(String value) => sha256.convert(utf8.encode(value)).toString();

/// Parse source without registering or executing any tests.
List<Map<String, dynamic>> extractTests(String file, String source) {
  final parsed = parseString(
    content: source,
    path: file,
    throwIfDiagnostics: false,
  );
  if (parsed.errors.isNotEmpty) {
    throw FormatException('Cannot audit invalid Dart: $file');
  }
  final visitor = _Tests(source, file);
  parsed.unit.accept(visitor);
  return visitor.tests;
}

class _Tests extends RecursiveAstVisitor<void> {
  _Tests(this.source, this.file);
  final String source;
  final String file;
  final tests = <Map<String, dynamic>>[];

  @override
  void visitMethodInvocation(MethodInvocation node) {
    if (const {
      'test',
      'testWidgets',
      'blocTest',
    }.contains(node.methodName.name)) {
      final args = node.argumentList.arguments;
      if (args.isEmpty) {
        throw FormatException('Unsupported test registration in $file');
      }
      final title = args.first is StringInterpolation
          ? (args.first as StringInterpolation).elements.map((element) {
              return element is InterpolationString
                  ? element.value
                  : '\${${(element as InterpolationExpression).expression.toSource()}}';
            }).join()
          : args.first is StringLiteral
          ? (args.first as StringLiteral).stringValue ?? args.first.toSource()
          : args.first.toSource();
      final groups = <String>[];
      final loops = <String>[];
      for (
        AstNode? parent = node.parent;
        parent != null;
        parent = parent.parent
      ) {
        if (parent is MethodInvocation &&
            parent.methodName.name == 'group' &&
            parent.argumentList.arguments.isNotEmpty) {
          final name = parent.argumentList.arguments.first;
          groups.insert(
            0,
            name is StringLiteral
                ? name.stringValue ?? name.toSource()
                : name.toSource(),
          );
        }
        if (parent is ForStatement) {
          loops.insert(0, source.substring(parent.offset, parent.body.offset));
        }
      }
      final statement = node.parent;
      final start = statement is ExpressionStatement
          ? statement.offset
          : node.offset;
      final end = statement is ExpressionStatement ? statement.end : node.end;
      tests.add({
        'id': digest('$file:$start:${digest(source)}').substring(0, 20),
        'file': file,
        'title': [...groups, title].join(' > '),
        'kind': node.methodName.name,
        'line': '\n'.allMatches(source.substring(0, start)).length + 1,
        'start': start,
        'end': end,
        'source': source.substring(start, end),
        'sourceHash': digest(source),
        'loopBindings': loops,
        // Deleting an unbraced loop/if body could change another test's scope.
        'removable':
            statement is ExpressionStatement && statement.parent is Block,
      });
    }
    super.visitMethodInvocation(node);
  }
}

String checkedPath(String root, String relative) {
  final candidate = p.normalize(p.join(root, relative));
  final resolved = File(candidate).resolveSymbolicLinksSync();
  if (!p.isWithin(root, resolved)) {
    throw FormatException('Source must be inside repository: $relative');
  }
  return resolved;
}

String checkedTestPath(String root, String relative) {
  final path = checkedPath(root, relative);
  if (!p.isWithin(p.join(root, 'test'), path) || !path.endsWith('_test.dart')) {
    throw FormatException(
      'Only test/**/*_test.dart may be removal targets: $relative',
    );
  }
  return path;
}

/// Build test-only packets. Shared file text precedes the varying target to
/// permit prefix reuse; no production imports are expanded.
Map<String, dynamic> buildAudit({
  required String root,
  required List<String> files,
  required Map<String, dynamic> questions,
  List<String> contexts = const [],
  List<String> names = const [],
  int maxBytes = 1048576,
  String? model,
}) {
  if (contexts.isNotEmpty) {
    throw const FormatException('Audit packets accept test files only');
  }
  root = Directory(root).resolveSymbolicLinksSync();
  final rows = <Map<String, dynamic>>[];
  final originals = <String, String>{};
  for (final file in files) {
    final relative = p.relative(checkedTestPath(root, file), from: root);
    final source = File(p.join(root, relative)).readAsStringSync();
    originals[relative] = source;
    for (final test in extractTests(relative, source)) {
      if (names.isNotEmpty &&
          !names.any((name) => (test['title'] as String).contains(name))) {
        continue;
      }
      final request = <String, dynamic>{
        if (model != null) 'model': model,
        'input': {
          'testFile': source,
          'file': relative,
          'includedLines': [1, '\n'.allMatches(source).length + 1],
          'omissions': <String>[],
          'target': {
            'title': test['title'],
            'line': test['line'],
            'start': test['start'],
            'end': test['end'],
            'source': test['source'],
            'loopBindings': test['loopBindings'],
          },
        },
        'questions': questions,
      };
      rows.add({
        ...test,
        'request': request,
        'requestHash': digest(jsonEncode(request)),
        'blocked': utf8.encode(jsonEncode(request)).length <= maxBytes
            ? null
            : 'Unbudgeted packet exceeds byte safety limit',
      });
    }
  }
  if (rows.isEmpty) {
    throw const FormatException('No matching supported tests found');
  }
  return {
    'version': 2,
    'root': root,
    if (model != null) 'model': model,
    'maxBytes': maxBytes,
    'originals': originals,
    'tests': rows,
  };
}
