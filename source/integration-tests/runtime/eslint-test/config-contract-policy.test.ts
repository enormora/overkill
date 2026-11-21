import { table, suite, test } from '@overkill-dev/test';

import type { Linter } from 'eslint';

import { configLintTranscript } from '../../../test-support/config-lint-transcript.ts';
import { evaluateConfigContract } from '../../../eslint-test/config-contracts.ts';
import {
    stableObservation,
    type ConfigExecution,
    type ConfigSourceResult
} from '../../../eslint-test/config-execution.ts';
import type { ConfigContract } from '../../../eslint-test/config-definition.ts';

const input = { filename: 'memory.js', code: 'old', files: {} };
const original: ConfigSourceResult = { output: 'old', messages: [] };
const fixed: ConfigSourceResult = { output: 'new', messages: [] };
const fatal: Linter.LintMessage = {
    ruleId: null,
    fatal: true,
    message: 'Unexpected token.',
    severity: 2,
    line: 1,
    column: 1
};
type ContractCase = {
    readonly contract: ConfigContract;
    readonly replies: readonly ConfigSourceResult[];
    readonly modes: readonly string[];
    readonly output: string;
};
const cases: readonly ContractCase[] = [
    { contract: { kind: 'crash-freedom' }, replies: [ original ], modes: [ 'lint' ], output: 'old' },
    { contract: { kind: 'suggestion-syntax' }, replies: [ original ], modes: [ 'lint' ], output: 'old' },
    { contract: { kind: 'repeatability' }, replies: [ original, fixed ], modes: [ 'lint', 'fix' ], output: 'new' },
    {
        contract: { kind: 'fix-syntax' },
        replies: [ original, fixed, fixed ],
        modes: [ 'lint', 'fix', 'parse' ],
        output: 'new'
    },
    {
        contract: { kind: 'fix-stability', maxRounds: 3 },
        replies: [ original, fixed, fixed, fixed, fixed ],
        modes: [ 'lint', 'fix', 'fix', 'parse', 'fix' ],
        output: 'new'
    }
];
function execution(signal: AbortSignal): ConfigExecution {
    return { context: { root: '/project', signal: signal }, materialized: false, configs: [] };
}
export const testNode = suite('ESLint config contract policy', [
    table({
        title: 'evaluates contracts through the lint backend',
        cases,
        caseTitle(entry) {
            return entry.contract.kind;
        },
        async test(scope) {
            const entry = scope.parameters;

            const fixture = configLintTranscript(entry.replies);
            const observation = await evaluateConfigContract(
                execution(scope.signal),
                input,
                entry.contract,
                fixture.lint
            );
            scope.assert.equal(observation.output, entry.output);
            scope.assert.deepEqual(
                fixture.calls.map(function (call) {
                    return call.mode;
                }),
                entry.modes
            );
            return scope.assert.collect();
        }
    }),
    test('parses each suggested edit against the original source', async function (scope) {
        const fixture = configLintTranscript([ {
            ...original,
            messages: [ {
                ruleId: 'suggestion',
                message: 'Replace source.',
                severity: 2,
                line: 1,
                column: 1,
                suggestions: [ { desc: 'Replace source', fix: { range: [ 0, 3 ], text: 'new' } } ]
            } ]
        }, fixed ]);
        await evaluateConfigContract(execution(scope.signal), input, { kind: 'suggestion-syntax' }, fixture.lint);
        scope.assert.deepEqual(fixture.calls, [ { mode: 'lint', code: 'old' }, { mode: 'parse', code: 'new' } ]);
        return scope.assert.collect();
    }),
    test('rejects fixes which produce invalid syntax', async function (scope) {
        const fixture = configLintTranscript([ original, fixed, { ...fixed, messages: [ fatal ] } ]);
        await scope.assert.rejects(async function () {
            await evaluateConfigContract(execution(scope.signal), input, { kind: 'fix-syntax' }, fixture.lint);
        }, { message: /An edit produced invalid syntax/u });
        scope.assert.deepEqual(
            fixture.calls.map(function (call) {
                return call.code;
            }),
            [ 'old', 'old', 'new' ]
        );
        return scope.assert.collect();
    }),
    test('rejects unexpected parser failures in original source', async function (scope) {
        const fixture = configLintTranscript([ { ...original, messages: [ fatal ] } ]);
        await scope.assert.rejects(async function () {
            await evaluateConfigContract(execution(scope.signal), input, { kind: 'crash-freedom' }, fixture.lint);
        }, { message: /Unexpected parser failure/u });
        scope.assert.equal(fixture.calls.length, 1);
        return scope.assert.collect();
    }),
    test(
        'rejects fixes which do not stabilize within the configured rounds',
        async function (scope) {
            const fixture = configLintTranscript([ original, fixed, fixed, fixed ]);
            await scope.assert.rejects(async function () {
                await evaluateConfigContract(
                    execution(scope.signal),
                    input,
                    { kind: 'fix-stability', maxRounds: 1 },
                    fixture.lint
                );
            }, { message: 'Autofixes did not stabilize within 1 complete ESLint fix runs.' });
            scope.assert.deepEqual(
                fixture.calls.map(function (call) {
                    return call.mode;
                }),
                [ 'lint', 'fix', 'fix', 'parse' ]
            );
            return scope.assert.collect();
        }
    ),
    test('normalizes project paths in backend error messages and stacks', async function (scope) {
        const failure = new Error('Failure in /project/source.js');
        await scope.assert.rejects(async function () {
            await evaluateConfigContract(execution(scope.signal), input, { kind: 'crash-freedom' }, async function () {
                throw failure;
            });
        }, { message: 'Failure in <project>/source.js' });
        return scope.assert.collect();
    }),
    test('normalizes original and fixed diagnostic paths', function (scope) {
        const observation = stableObservation({
            filename: input.filename,
            code: 'old',
            output: 'new',
            messages: [ { ...fatal, message: '/project/source.js' } ],
            fixedMessages: [ { ...fatal, message: '/project/fixed.js' } ]
        }, '/project');
        scope.assert.equal(observation.messages[0]?.message, '<project>/source.js');
        scope.assert.equal(observation.fixedMessages[0]?.message, '<project>/fixed.js');
        return scope.assert.collect();
    })
]);
