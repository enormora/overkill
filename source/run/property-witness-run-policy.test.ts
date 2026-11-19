import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { propertyWitnessRun } from '../test-support/property-witness-run.ts';
import { executePropertyWitnessRun } from './property-witness-storage.ts';

export const testNode = authoredSuite('property witness run storage ownership', [
    test(
        'creates storage only for confirmed witnesses and completes an owned record',
        async function (scope: TestScope) {
            const fixture = await propertyWitnessRun(scope, 'none', true, true);
            const result = await executePropertyWitnessRun(fixture.input, fixture.storage);
            scope.assert.deepEqual(fixture.events, [ 'storage', 'finish', 'settle', 'complete' ]);
            scope.assert.deepEqual(result.runnerErrors, []);
            return scope.assert.collect();
        }
    ),
    test('does not open storage for unconfirmed results', async function (scope: TestScope) {
        const fixture = await propertyWitnessRun(scope, 'none', false, true);
        const result = await executePropertyWitnessRun(fixture.input, fixture.storage);
        scope.assert.deepEqual(fixture.events, []);
        scope.assert.deepEqual(result.runnerErrors, []);
        return scope.assert.collect();
    }),
    test('leaves completion to the caller that supplied the record session', async function (scope: TestScope) {
        const fixture = await propertyWitnessRun(scope, 'none', true, false);
        const result = await executePropertyWitnessRun(fixture.input, fixture.storage);
        scope.assert.deepEqual(fixture.events, [ 'storage', 'finish', 'settle' ]);
        scope.assert.deepEqual(result.runnerErrors, []);
        return scope.assert.collect();
    }),
    test('reports storage initialization failures as artifact errors', async function (scope: TestScope) {
        const fixture = await propertyWitnessRun(scope, 'storage', true, true);
        const result = await executePropertyWitnessRun(fixture.input, fixture.storage);
        scope.assert.equal(result.runnerErrors[0]?.message, 'Failed to retain property witnesses.');
        scope.assert.deepEqual(fixture.events, [ 'storage' ]);
        return scope.assert.collect();
    }),
    test('finishes the attachment execution when witness writes fail', async function (scope: TestScope) {
        const fixture = await propertyWitnessRun(scope, 'exchange', true, true);
        const result = await executePropertyWitnessRun(fixture.input, fixture.storage);
        scope.assert.equal(result.runnerErrors[0]?.message, 'Failed to retain property witnesses.');
        scope.assert.deepEqual(fixture.events, [ 'storage', 'finish', 'settle', 'complete' ]);
        return scope.assert.collect();
    }),
    test('retains store finalization failures and completes the record', async function (scope: TestScope) {
        const fixture = await propertyWitnessRun(scope, 'finish', true, true);
        const result = await executePropertyWitnessRun(fixture.input, fixture.storage);
        scope.assert.equal(result.runnerErrors[0]?.message, 'Failed to retain property witnesses.');
        scope.assert.deepEqual(fixture.events, [ 'storage', 'finish', 'complete' ]);
        return scope.assert.collect();
    }),
    test('interrupts an owned record when completion fails', async function (scope: TestScope) {
        const fixture = await propertyWitnessRun(scope, 'complete', true, true);
        await scope.assert.rejects(async function () {
            return await executePropertyWitnessRun(fixture.input, fixture.storage);
        }, { exact: fixture.failure });
        scope.assert.deepEqual(fixture.events, [ 'storage', 'finish', 'settle', 'complete', 'interrupt' ]);
        return scope.assert.collect();
    }),
    test('does not interrupt a caller-owned record when the run fails', async function (scope: TestScope) {
        const fixture = await propertyWitnessRun(scope, 'run', true, false);
        await scope.assert.rejects(async function () {
            return await executePropertyWitnessRun(fixture.input, fixture.storage);
        }, { exact: fixture.failure });
        scope.assert.deepEqual(fixture.events, [ 'storage', 'finish', 'settle' ]);
        return scope.assert.collect();
    })
]);
