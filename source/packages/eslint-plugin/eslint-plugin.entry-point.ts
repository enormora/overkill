import type { TSESLint } from '@typescript-eslint/utils';
import type { ESLint } from 'eslint';
import { noScopeEscape } from '../../eslint-plugin/no-scope-escape.ts';

const plugin: {
    readonly meta: NonNullable<ESLint.Plugin['meta']>;
    readonly rules: { readonly 'no-scope-escape': typeof noScopeEscape; };
} = {
    meta: { name: '@overkill-dev/eslint-plugin' },
    rules: { 'no-scope-escape': noScopeEscape }
} satisfies TSESLint.FlatConfig.Plugin;

export default plugin;
