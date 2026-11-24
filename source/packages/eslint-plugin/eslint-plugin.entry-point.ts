import type { ESLint } from 'eslint';
import { noScopeEscape } from '../../eslint-plugin/no-scope-escape.ts';

export const overkillPlugin: {
    readonly meta: NonNullable<ESLint.Plugin['meta']>;
    readonly rules: { readonly 'no-scope-escape': typeof noScopeEscape; };
} = {
    meta: { name: '@overkill-dev/eslint-plugin' },
    rules: { 'no-scope-escape': noScopeEscape }
};
