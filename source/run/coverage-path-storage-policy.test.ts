import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { coveragePathStorage, coveragePaths } from '../test-support/coverage-path-storage.ts';

export const testNode = suite('coverage directory ownership', [
    ...([ 'ancestor', 'pass' ] as const).map(function (scenario) {
        return test(`creates coverage inside the project using ${scenario} paths`, async function (scope: TestScope) {
            const fixture = coveragePathStorage(scenario);
            scope.assert.deepEqual(await fixture.create(), coveragePaths);
            scope.assert.includes(fixture.calls.join(','), 'create:/project/coverage/raw');
            return scope.assert.collect();
        });
    }),
    ...([ 'escape', 'linked-ancestor', 'linked-created' ] as const).map(function (scenario) {
        return test(`rejects ${scenario} output directories`, async function (scope: TestScope) {
            const fixture = coveragePathStorage(scenario);
            await scope.assert.rejects(fixture.create, {
                message: scenario === 'linked-created'
                    ? 'Coverage output directory resolves outside the project root.'
                    : 'Coverage output directory must remain inside the project root.'
            });
            scope.assert.equal(
                fixture.calls.some(function (call) {
                    return call.startsWith('create:');
                }),
                scenario === 'linked-created'
            );
            return scope.assert.collect();
        });
    }),
    ...([ 'creation-error', 'root-error' ] as const).map(function (scenario) {
        return test(`preserves ${scenario} failures`, async function (scope: TestScope) {
            const fixture = coveragePathStorage(scenario);
            await scope.assert.rejects(fixture.create, { exact: fixture.failure });
            return scope.assert.collect();
        });
    })
]);
await runIfMain(import.meta, testNode);
