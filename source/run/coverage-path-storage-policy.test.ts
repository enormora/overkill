import { type TestNode, table, suite } from '@overkill-dev/test';

import { coveragePathStorage, coveragePaths } from '../test-support/coverage-path-storage.ts';

export const testNode: TestNode = suite('coverage directory ownership', [
    table({
        title: 'creates coverage within the project',
        cases: [ 'ancestor', 'pass' ] as const,
        caseTitle(scenario) {
            return scenario;
        },
        async test(scope) {
            const scenario = scope.parameters;

            const fixture = coveragePathStorage(scenario);
            scope.assert.deepEqual(await fixture.create(), coveragePaths);
            scope.assert.includes(fixture.calls.join(','), 'create:/project/coverage/raw');
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects invalid coverage output directories',
        cases: [ 'escape', 'linked-ancestor', 'linked-created' ] as const,
        caseTitle(scenario) {
            return scenario;
        },
        async test(scope) {
            const scenario = scope.parameters;

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
        }
    }),
    table({
        title: 'preserves coverage storage failures',
        cases: [ 'creation-error', 'root-error' ] as const,
        caseTitle(scenario) {
            return scenario;
        },
        async test(scope) {
            const scenario = scope.parameters;

            const fixture = coveragePathStorage(scenario);
            await scope.assert.rejects(fixture.create, { exact: fixture.failure });
            return scope.assert.collect();
        }
    })
]);
