import { execFile } from 'node:child_process';
import { table, type TestNode, suite, test } from '@overkill-dev/test';

type ExitResult = { readonly code: number | string; readonly stderr: string; };
const deadlineMilliseconds = 5000;
async function runExitProbe(operation: string): Promise<ExitResult> {
    return new Promise(function awaitExit(resolve) {
        execFile(
            process.execPath,
            [
                'source/integration-tests/integration/fixtures/process-exit-observer-probe.test.ts',
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
export const testNode: TestNode = suite('native process exit observation', [
    test('exit diagnostics retain available attempt attribution', async function (scope) {
        const result = await runExitProbe('attributed');
        scope.assert.equal(result.code, 1);
        scope.assert.includes(result.stderr, 'Attempt: 3.');
        return scope.assert.collect();
    }),

    table({
        title: 'process exit reports unfinished restricted execution',
        cases: observedExits,
        caseTitle(scenario) {
            return scenario.operation;
        },
        async test(scope) {
            const scenario = scope.parameters;

            const result = await runExitProbe(scenario.operation);
            scope.assert.equal(result.code, scenario.code);
            scope.assert.includes(result.stderr, 'process exited before restricted execution completed');
            return scope.assert.collect();
        }
    }),
    test('completed execution removes the native exit observer', async function (scope) {
        scope.assert.deepEqual(await runExitProbe('completed'), { code: 0, stderr: '' });
        return scope.assert.collect();
    }),
    table({
        title: 'premature zero exit remains unsuccessful',
        cases: [ 'record-failure', 'stderr-failure' ],
        caseTitle(operation) {
            return operation;
        },
        async test(scope) {
            const operation = scope.parameters;

            scope.assert.deepEqual(await runExitProbe(operation), { code: 1, stderr: '' });
            return scope.assert.collect();
        }
    }),
    test('exit attribution cannot create an unbounded stderr diagnostic', async function (scope) {
        const result = await runExitProbe('bounded');
        scope.assert.equal(result.code, 1);
        scope.assert.equal(Buffer.byteLength(result.stderr), 4096);
        scope.assert.includes(result.stderr, 'fixture.test.ts');
        return scope.assert.collect();
    })
]);
