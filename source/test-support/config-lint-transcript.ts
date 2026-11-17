import type { ConfigSourceLint, ConfigSourceResult } from '../eslint-test/config-execution.ts';

type ConfigLintCall = { readonly mode: 'fix' | 'lint' | 'parse'; readonly code: string; };
type ConfigLintTranscript = { readonly lint: ConfigSourceLint; readonly calls: readonly ConfigLintCall[]; };
export function configLintTranscript(replies: readonly ConfigSourceResult[]): ConfigLintTranscript {
    const calls: ConfigLintCall[] = [];
    return {
        calls,
        async lint(_execution, input, mode) {
            const reply = replies[calls.length];
            calls.push({ mode, code: input.code });
            if (reply === undefined) {
                throw new Error('Unexpected lint operation.');
            }
            return reply;
        }
    };
}
