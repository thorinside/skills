#!/usr/bin/env python3
"""Budget test-file-only requests; preserve the indicated test in full."""
import json


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
    # Count the selected questions/criteria and metadata, leaving native prompt
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
