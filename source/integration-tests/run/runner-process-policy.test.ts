import { execFile } from 'node:child_process';
import { z } from 'zod/v4';
import { createSuite, createTestCase, type TestScope } from '../../packages/engine/engine.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { runResultSchema } from '../../run/run-result-schema.ts';
import { runIfMain } from '../direct-launcher.test.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
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
                'source/integration-tests/run/fixtures/process-policy-launcher.test.ts',
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
export const testNode = createSuite({
    title: 'process policy without monkey patches',
    ...metadata,
    children: [
        ...fatalOperations.map(function fatalSupervisedOperation(operation) {
            return createTestCase({
                title: `supervision survives native ${operation} and crashes interrupted work`,
                ...metadata,
                async body(scope: TestScope) {
                    const processResult = await runProcess(operation, 'supervised-process');
                    scope.assert.equal(processResult.code, 0, { message: processResult.stderr });
                    const result = runResultSchema.parse(JSON.parse(processResult.stdout));
                    scope.assert.equal(result.status, 'failed');
                    scope.assert.equal(result.summary.crashed, 1);
                    scope.assert.true(result.runnerErrors.some(function reportsCrash(error) {
                        return error.subtype === 'crash';
                    }));
                    return scope.assert.collect();
                }
            });
        }),
        ...[ 'load-exit', 'load-abort' ].map(function fatalLoadOperation(operation) {
            return createTestCase({
                title: `supervision survives native ${operation} before collection completes`,
                ...metadata,
                async body(scope: TestScope) {
                    const processResult = await runProcess(operation, 'supervised-process');
                    scope.assert.equal(processResult.code, 0, { message: processResult.stderr });
                    const result = runResultSchema.parse(JSON.parse(processResult.stdout));
                    scope.assert.equal(result.status, 'failed');
                    scope.assert.true(result.runnerErrors.some(function reportsCrash(error) {
                        return error.subtype === 'crash';
                    }));
                    return scope.assert.collect();
                }
            });
        }),
        ...ipcOperations.map(function unexpectedIpc(operation) {
            return createTestCase({
                title: `supervision rejects ${operation} without inventing sender attribution`,
                ...metadata,
                async body(scope: TestScope) {
                    const processResult = await runProcess(operation, 'supervised-process');
                    scope.assert.equal(processResult.code, 0, { message: processResult.stderr });
                    const result = runResultSchema.parse(JSON.parse(processResult.stdout));
                    const error = result.runnerErrors.find(function reportsPolicy(candidate) {
                        return candidate.subtype === 'runtime-policy';
                    });
                    scope.require.defined(error);
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
            });
        }),
        createTestCase({
            title: 'native process execution remains denied even when user code catches the error',
            ...metadata,
            async body(scope: TestScope) {
                const processResult = await runProcess('caught-execution', 'supervised-process');
                scope.assert.equal(processResult.code, 0, { message: processResult.stderr });
                const result = runResultSchema.parse(JSON.parse(processResult.stdout));
                scope.assert.equal(result.summary.runtimePolicy, 1);
                return scope.assert.collect();
            }
        }),
        ...[ { operation: 'exit', code: 1 }, { operation: 'exit-nonzero', code: 7 }, {
            operation: 'load-exit',
            code: 1
        } ]
            .map(function inProcessExit(scenario) {
                return createTestCase({
                    title: `in-process ${scenario.operation} writes a diagnostic and exits ${scenario.code}`,
                    ...metadata,
                    async body(scope: TestScope) {
                        const result = await runProcess(scenario.operation, 'in-process');
                        scope.assert.equal(result.code, scenario.code);
                        scope.assert.includes(result.stderr, 'process exited before restricted execution completed');
                        scope.assert.equal(result.stdout, '');
                        return scope.assert.collect();
                    }
                });
            })
    ]
});
await runIfMain(import.meta, testNode, [ createLineReporter() ]);
