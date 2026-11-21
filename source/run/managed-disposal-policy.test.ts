import { table, suite } from '@overkill-dev/test';

import { managedDisposal } from '../test-support/managed-disposal.ts';
import {
    disposeBoundary,
    prepareManagedResources,
    finalizeManagedChecks,
    freshDisposalSignal
} from './resource-lifecycle-disposal.ts';

export const testNode = suite('managed resource cleanup policy', [
    table({
        title: 'releases owners after disposal failures',
        cases: [ false, true ].flatMap(function (observed) {
            return [ false, true ].map(function (fails) {
                return { observed, fails };
            });
        }),
        caseTitle({ observed, fails }) {
            return [ observed, fails ].map(String).join(', ');
        },
        async test(scope) {
            const { observed, fails } = scope.parameters;

            const fixture = managedDisposal(fails ? 'dispose-error' : 'clean', observed);
            const request = { signal: freshDisposalSignal(), timing: null, testCases: [ fixture.testCase ] };
            if (fails) {
                await scope.assert.rejects(async function () {
                    await disposeBoundary(fixture.stores, fixture.record.boundary.key, request);
                }, { message: 'dispose failed' });
            } else {
                await disposeBoundary(fixture.stores, fixture.record.boundary.key, request);
            }
            scope.assert.deepEqual(
                fixture.calls,
                observed ? [ 'close', 'dispose', 'release' ] : [ 'dispose', 'release' ]
            );
            scope.assert.equal(fixture.stores.existingRecord(fixture.record.boundary.key), undefined);
            await disposeBoundary(fixture.stores, fixture.record.boundary.key, request);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'attributes disposal observations to the owning attempt',
        cases: [ 'clean', 'prepare-error', 'finalize-error' ] as const,
        caseTitle(scenario) {
            return scenario;
        },
        async test(scope) {
            const scenario = scope.parameters;

            const fixture = managedDisposal(scenario, true);
            await prepareManagedResources(fixture.stores, fixture.testCase, { index: 0 });
            await finalizeManagedChecks(fixture.stores, fixture.testCase, { index: 0 });
            scope.assert.deepEqual(fixture.calls, [ 'prepare', 'finalize' ]);
            const errors = fixture.stores.takeAttemptErrors(fixture.testCase, { index: 0 });
            scope.assert.equal(errors.length, scenario === 'clean' ? 0 : 1);
            scope.assert.equal(
                errors[0]?.attributedTo?.title ?? null,
                scenario === 'clean' ? null : fixture.testCase.id.title
            );
            return scope.assert.collect();
        }
    })
]);
