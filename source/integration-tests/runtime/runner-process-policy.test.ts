import { execFile } from 'node:child_process';
import { table, suite, test } from '@overkill-dev/test';

import { z } from 'zod/v4';

import { parseRunnerResult } from '../../packages/run/run.entry-point.ts';

const processTimeoutMilliseconds = 15_000;
type ProcessResult = {
    readonly code: number | string | null;
    readonly signal: string | null;
    readonly stderr: string;
    readonly stdout: string;
};
async function runProcess(
    operation: string,
    processModel: 'in-process' | 'supervised-process'
): Promise<ProcessResult> {
    return new Promise(function waitForProcess(resolve) {
        execFile(
            process.execPath,
            [
                '--disable-warning=PERM0004',
                'source/integration-tests/runtime/fixtures/process-policy-launcher.test.ts',
                operation,
                processModel
            ],
            { timeout: processTimeoutMilliseconds },
            function completed(error, stdout, stderr) {
                resolve({ code: error?.code ?? 0, signal: error?.signal ?? null, stderr, stdout });
            }
        );
    });
}
const fatalOperations = [ 'exit', 'exit-nonzero', 'abort', 'signal' ];
const ipcOperations = [ 'send', 'forged-result', 'load-send' ];
export const testNode = suite('process policy without monkey patches', [
    table({
        title: 'survives native process termination and crashes interrupted work',
        cases: fatalOperations,
        caseTitle(operation) {
            return operation;
        },
        async test(scope) {
            const operation = scope.parameters;

            const processResult = await runProcess(operation, 'supervised-process');
            scope.assert.equal(processResult.code, 0, { message: processResult.stderr });
            const result = parseRunnerResult(JSON.parse(processResult.stdout));
            scope.assert.equal(result.status, 'failed');
            scope.assert.equal(result.summary.crashed, 1);
            scope.assert.true(result.runnerErrors.some(function reportsCrash(error) {
                return error.subtype === 'crash';
            }));
            return scope.assert.collect();
        }
    }),
    table({
        title: 'survives native process termination before collection',
        cases: [ 'load-exit', 'load-abort' ],
        caseTitle(operation) {
            return operation;
        },
        async test(scope) {
            const operation = scope.parameters;

            const processResult = await runProcess(operation, 'supervised-process');
            scope.assert.equal(processResult.code, 0, { message: processResult.stderr });
            const result = parseRunnerResult(JSON.parse(processResult.stdout));
            scope.assert.equal(result.status, 'failed');
            scope.assert.true(result.runnerErrors.some(function reportsCrash(error) {
                return error.subtype === 'crash';
            }));
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects malformed child operations without sender attribution',
        cases: ipcOperations,
        caseTitle(operation) {
            return operation;
        },
        async test(scope) {
            const require: typeof scope.require = scope.require;

            const processResult = await runProcess(scope.parameters, 'supervised-process');
            scope.assert.equal(processResult.code, 0, { message: processResult.stderr });
            const result = parseRunnerResult(JSON.parse(processResult.stdout));
            const error = result.runnerErrors.find(function reportsPolicy(candidate) {
                return candidate.subtype === 'runtime-policy';
            });
            require.defined(error);
            scope.assert.deepEqual([ error.attributedTo, error.attributedToWork, error.attributedToAttempt ], [
                null,
                null,
                null
            ]);
            scope.assert.equal(result.status, 'failed');
            scope.assert.true(
                z
                    .strictObject({
                        activeAttempts: z.array(z.unknown()),
                        capability: z.literal('child-process'),
                        reason: z.string(),
                        strictness: z.literal('observed')
                    })
                    .safeParse(error.cause)
                    .success
            );
            return scope.assert.collect();
        }
    }),
    test(
        'native process execution remains denied even when user code catches the error',
        async function (scope) {
            const processResult = await runProcess('caught-execution', 'supervised-process');
            scope.assert.equal(processResult.code, 0, { message: processResult.stderr });
            const result = parseRunnerResult(JSON.parse(processResult.stdout));
            scope.assert.equal(result.summary.runtimePolicy, 1);
            return scope.assert.collect();
        }
    ),
    table({
        title: 'writes a diagnostic before terminating in-process execution',
        cases: [ { operation: 'exit', code: 1 }, { operation: 'exit-nonzero', code: 7 }, {
            operation: 'load-exit',
            code: 1
        } ],
        caseTitle(scenario) {
            return `${scenario.operation}, ${scenario.code}`;
        },
        async test(scope) {
            const scenario = scope.parameters;

            const result = await runProcess(scenario.operation, 'in-process');
            scope.assert.equal(result.code, scenario.code);
            scope.assert.includes(result.stderr, 'process exited before restricted execution completed');
            scope.assert.equal(result.stdout, '');
            return scope.assert.collect();
        }
    })
]);
