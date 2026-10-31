#!/usr/bin/env python3
"""Budget test-file-only requests; preserve the indicated test in full."""
import argparse
import json
from pathlib import Path


def token_counter():
    try:
        import tiktoken
        encoders = [tiktoken.get_encoding(name) for name in ('cl100k_base', 'o200k_base')]
        def count(value):
            text = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
            return max(len(encoder.encode(text, disallowed_special=())) for encoder in encoders)
        return count, "max(cl100k_base,o200k_base); not the selected model\'s exact tokenizer"
    except ImportError:
        def count(value):
            return len(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
        return count, 'conservative UTF-8 byte upper bound; tokenizer unavailable'


def budget_row(row, count, estimator, max_tokens):
    request = row['request']
    state = request['input']
    source = state['testFile']
    lines = source.splitlines(keepends=True)
    # Count all four questions/criteria and metadata, leaving native prompt
    # framing/output headroom. Provider limits remain authoritative.
    budget = max_tokens - 2048
    state['budget'] = {'contextLimit': max_tokens, 'requestBudget': budget,
                       'estimator': estimator, 'estimatedRequestTokens': 0}
    row['blocked'] = None

    def include(n):
        state['testFile'] = ''.join(lines[:n])
        state['includedLines'] = [1, n]
        state['omissions'] = ([] if n == len(lines) else
                              [f'Test-file lines {n + 1}-{len(lines)} omitted for the request budget; indicated target source remains complete.'])
        return count(request)

    estimate = include(len(lines))
    if estimate + 16 > budget:
        if include(0) + 16 > budget:
            row['blocked'] = 'Indicated test plus criteria exceeds 32K context; target was not chopped'
        else:
            lo, hi = 0, len(lines)
            while lo < hi:
                middle = (lo + hi + 1) // 2
                if include(middle) + 16 <= budget:
                    lo = middle
                else:
                    hi = middle - 1
            include(lo)
    # The estimate itself occupies a few tokens, so settle that metadata too.
    for _ in range(3):
        state['budget']['estimatedRequestTokens'] = count(request)
    if count(request) > budget:
        row['blocked'] = 'Indicated test plus criteria exceeds request budget'
    row['estimatedRequestTokens'] = count(request)
    row['chopped'] = bool(state['omissions'])
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--max-tokens', type=int, default=32768)
    args = parser.parse_args()
    if args.max_tokens <= 2048 or args.max_tokens > 32768:
        parser.error('--max-tokens must be greater than 2048 and at most 32768')
    manifest = json.loads(args.input.read_text())
    count, estimator = token_counter()
    for row in manifest['tests']:
        budget_row(row, count, estimator, args.max_tokens)
    manifest['contextLimit'] = args.max_tokens
    manifest['estimator'] = estimator
    args.output.write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')))
    rows = manifest['tests']
    print(json.dumps({'tests': len(rows), 'blocked': sum(bool(row['blocked']) for row in rows),
                      'chopped': sum(row['chopped'] for row in rows), 'contextLimit': args.max_tokens,
                      'maxEstimatedRequestTokens': max(row['estimatedRequestTokens'] for row in rows),
                      'estimator': estimator}))


if __name__ == '__main__':
    main()
