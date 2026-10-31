import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

/// Repository-owned review state. Symlinks are forbidden at every artifact
/// component, even when they point inside the repository, to protect its source.
class ReviewArtifacts {
  ReviewArtifacts({required String root, required String path})
    : root = Directory(root).resolveSymbolicLinksSync(),
      path = p.normalize(p.absolute(path)) {
    if (!p.isWithin(this.root, this.path)) {
      throw const FormatException(
        'Review output must be inside the target repository',
      );
    }
    _checkPath(this.path);
  }

  final String root;
  final String path;

  void _checkPath(String target) {
    var current = root;
    for (final component in p.split(p.relative(target, from: root))) {
      current = p.join(current, component);
      if (FileSystemEntity.typeSync(current, followLinks: false) ==
          FileSystemEntityType.link) {
        throw const FormatException(
          'Review artifact paths must not contain symlinks',
        );
      }
    }
  }

  File file(String relative) {
    final target = p.normalize(p.join(path, relative));
    if (!p.isWithin(path, target)) {
      throw const FormatException(
        'Review artifacts must stay inside the review directory',
      );
    }
    _checkPath(target);
    return File(target);
  }

  void writeJson(String relative, Object value) => writeText(
    relative,
    '${const JsonEncoder.withIndent('  ').convert(value)}\n',
  );

  void writeText(String relative, String value) {
    final destination = file(relative);
    destination.parent.createSync(recursive: true);
    // A fresh private directory avoids following pre-existing fixed .tmp files.
    final temporary = destination.parent.createTempSync('.test-quality-');
    try {
      final staged = File(p.join(temporary.path, 'artifact'));
      staged.writeAsStringSync(value);
      file(
        relative,
      ); // Recheck the destination after staging, before replacement.
      staged.renameSync(destination.path);
    } finally {
      temporary.deleteSync(recursive: true);
    }
  }
}
