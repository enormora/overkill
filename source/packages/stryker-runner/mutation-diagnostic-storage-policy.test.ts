import { type TestNode, table, type TestScope, suite, test } from '@overkill-dev/test';

import { mutationDiagnosticStorage } from '../../test-support/mutation-diagnostic-storage.ts';

export const testNode: TestNode = suite('mutation diagnostic file retention', [
    test('retains inline evidence without file operations', async function (scope) {
        const fixture = mutationDiagnosticStorage('pass');
        await fixture.save(false);
        scope.assert.deepEqual(fixture.calls, [ 'write:/project/diagnostics/campaign/invocation/diagnostics.json' ]);
        scope.assert.equal(fixture.writes.length, 1);
        return scope.assert.collect();
    }),
    test('copies file evidence and rewrites the portable document path', async function (scope: TestScope) {
        const fixture = mutationDiagnosticStorage('pass');
        await fixture.save(true);
        scope.assert.deepEqual(fixture.calls, [
            'size:/project/evidence.bin',
            'directory:/project/diagnostics/campaign/invocation/files',
            'copy:/project/evidence.bin:/project/diagnostics/campaign/invocation/files/0.bin',
            'size:/project/diagnostics/campaign/invocation/files/0.bin',
            'write:/project/diagnostics/campaign/invocation/diagnostics.json'
        ]);
        scope.require.defined(fixture.writes[0]);
        scope.assert.includes(fixture.writes[0].content, '"path": "files/0.bin"');
        return scope.assert.collect();
    }),
    table({
        title: 'rejects mismatches before publishing diagnostics',
        cases: [ 'source-size', 'destination-size' ] as const,
        caseTitle(scenario) {
            return `${scenario}`;
        },
        async test(scope) {
            const scenario = scope.parameters;

            const fixture = mutationDiagnosticStorage(scenario);
            await scope.assert.rejects(async function () {
                await fixture.save(true);
            }, { message: 'Diagnostic attachment size differs from its delivered metadata.' });
            scope.assert.deepEqual(fixture.writes, []);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'preserves diagnostic storage failures',
        cases: [ 'copy-error', 'write-error' ] as const,
        caseTitle(scenario) {
            return `${scenario}`;
        },
        async test(scope) {
            const scenario = scope.parameters;

            const fixture = mutationDiagnosticStorage(scenario);
            await scope.assert.rejects(async function () {
                await fixture.save(true);
            }, { exact: fixture.failure });
            scope.assert.deepEqual(fixture.writes, []);
            return scope.assert.collect();
        }
    })
]);
