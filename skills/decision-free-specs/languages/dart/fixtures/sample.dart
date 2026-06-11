// Fixture with a known inventory — used to validate inventory.py.

import 'dart:async';

import 'package:flutter/material.dart';

const int pageSize = 50;
final String _cacheDir = '/tmp/widgets';

typedef WidgetId = String;

enum WidgetKind { round, square }

mixin Sizable {
  int get size;
  int area() => size * size;
}

class WidgetModel with Sizable {
  WidgetModel(this.name, this.size);

  final String name;
  @override
  final int size;

  String describe() => '$name ($size)';
  void _validate() {
    if (size < 0) throw ArgumentError(name);
  }
}

class GalleryCard extends StatelessWidget {
  const GalleryCard({super.key, required this.model});

  final WidgetModel model;

  @override
  Widget build(BuildContext context) {
    return Text(model.describe());
  }
}

class GalleryPage extends StatefulWidget {
  const GalleryPage({super.key});

  @override
  State<GalleryPage> createState() => _GalleryPageState();
}

class _GalleryPageState extends State<GalleryPage> {
  int _count = 0;

  void _increment() {
    setState(() => _count++);
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(onTap: _increment, child: Text('$_count'));
  }
}

Future<WidgetModel> loadWidget(WidgetId id) async {
  return WidgetModel(id, pageSize);
}

String _normalize(String name) => name.trim().toLowerCase();
