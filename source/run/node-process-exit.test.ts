import { execFile } from 'node:child_process';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
type ExitResult = { readonly code: number | string; readonly stderr: string; };
const deadlineMilliseconds = 5000;
async function runExitProbe(operation: string): Promise<ExitResult> {
    return new Promise(function awaitExit(resolve) {
        execFile(
            process.execPath,
            [
                'source/integration-tests/run/fixtures/process-exit-observer-probe.test.ts',
                operation
            ],
            { timeout: deadlineMilliseconds },
            function completed(error, _stdout, stderr) {
                resolve({ code: error?.code ?? 0, stderr });
            }
        );
    });
}
const observedExits = [ { operation: 'zero', code: 1 }, { operation: 'nonzero', code: 7 }, {
    operation: 'natural',
    code: 13
} ];
export const testNode = createSuite({
    title: 'native process exit observation',
    ...metadata,
    children: [
        createTestCase({
            title: 'exit diagnostics retain available attempt attribution',
            ...metadata,
            async body(scope) {
                const result = await runExitProbe('attributed');
                scope.assert.equal(result.code, 1);
                scope.assert.includes(result.stderr, 'Attempt: 3.');
                return scope.assert.collect();
            }
        }),

        ...observedExits.map(function observedExit(scenario) {
            return createTestCase({
                title: `${scenario.operation} exit reports unfinished restricted execution`,
                ...metadata,
                async body(scope) {
                    const result = await runExitProbe(scenario.operation);
                    scope.assert.equal(result.code, scenario.code);
                    scope.assert.includes(result.stderr, 'process exited before restricted execution completed');
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            title: 'completed execution removes the native exit observer',
            ...metadata,
            async body(scope) {
                scope.assert.deepEqual(await runExitProbe('completed'), { code: 0, stderr: '' });
                return scope.assert.collect();
            }
        }),
        ...[ 'record-failure', 'stderr-failure' ].map(function reportingFailure(operation) {
            return createTestCase({
                title: `${operation} still makes premature zero exit unsuccessful`,
                ...metadata,
                async body(scope) {
                    scope.assert.deepEqual(await runExitProbe(operation), { code: 1, stderr: '' });
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            title: 'exit attribution cannot create an unbounded stderr diagnostic',
            ...metadata,
            async body(scope) {
                const result = await runExitProbe('bounded');
                scope.assert.equal(result.code, 1);
                scope.assert.equal(Buffer.byteLength(result.stderr), 4096);
                scope.assert.includes(result.stderr, 'fixture.test.ts');
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
