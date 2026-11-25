import type { ESLint } from 'eslint';
import { noSingleUseTrivialAssertion } from '../../eslint-plugin/no-single-use-trivial-assertion.ts';
import { noScopeEscape } from '../../eslint-plugin/no-scope-escape.ts';

export const overkillPlugin: {
    readonly meta: NonNullable<ESLint.Plugin['meta']>;
    readonly rules: {
        readonly 'no-scope-escape': typeof noScopeEscape;
        readonly 'no-single-use-trivial-assertion': typeof noSingleUseTrivialAssertion;
    };
} = {
    meta: { name: '@overkill-dev/eslint-plugin' },
    rules: {
        'no-scope-escape': noScopeEscape,
        'no-single-use-trivial-assertion': noSingleUseTrivialAssertion
    }
};
