import copy
import unittest

from budget import budget_row, token_counter


class BudgetTests(unittest.TestCase):
    def row(self, source, target="test('last', () { expect(1, 1); });"):
        return {'request': {'model': 'qwen3.8-sw', 'input': {
            'testFile': source, 'file': 'test/example_test.dart',
            'includedLines': [1, len(source.splitlines())], 'omissions': [],
            'target': {'source': target, 'line': 999}},
            'questions': {'disposition': {'kind': 'choice', 'criteria': {'keep': 'valuable', 'remove': 'vacuous', 'tighten': 'repairable'}}}}}

    def test_short_file_is_complete_and_criteria_are_counted(self):
        count, estimator = token_counter()
        row = self.row('void main() {}\n')
        budget_row(row, count, estimator, 32768)
        self.assertIsNone(row['blocked'])
        self.assertFalse(row['chopped'])
        self.assertEqual(row['request']['input']['testFile'], 'void main() {}\n')
        self.assertLessEqual(count(row['request']), 32768 - 2048)

    def test_oversized_file_is_chopped_but_target_remains_whole(self):
        count, estimator = token_counter()
        row = self.row('final value = 123;\n' * 10000)
        target = copy.deepcopy(row['request']['input']['target'])
        budget_row(row, count, estimator, 4096)
        self.assertIsNone(row['blocked'])
        self.assertTrue(row['chopped'])
        self.assertEqual(row['request']['input']['target'], target)
        self.assertTrue(row['request']['input']['omissions'])
        self.assertLessEqual(count(row['request']), 4096 - 2048)
        self.assertTrue(row['request']['input']['testFile'].endswith('\n'))

    def test_indicated_test_is_never_silently_cut(self):
        count, estimator = token_counter()
        target = 'expect(value, 123);\n' * 10000
        row = self.row('void main() {}\n', target)
        budget_row(row, count, estimator, 4096)
        self.assertTrue(row['blocked'])
        self.assertEqual(row['request']['input']['target']['source'], target)


if __name__ == '__main__':
    unittest.main()
