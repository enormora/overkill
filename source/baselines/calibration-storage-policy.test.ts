import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { calibrationStorage, calibrationStorageScenario } from '../test-support/calibration-storage.ts';
import { calibrationSnapshot } from '../test-support/calibration-fixture.ts';
import { CalibrationPublicationError, openCalibrationReferenceStore } from './calibration-store.ts';
import type { StoredCalibration } from './calibration-reference.ts';

function owners(): StoredCalibration['owners'] {
    return [];
}
const first = calibrationSnapshot([ 100, 100 ]);
const second = { ...first, identity: { ...first.identity, version: 'second' } };
async function failedPublication(operation: () => Promise<readonly string[]>): Promise<CalibrationPublicationError> {
    try {
        await operation();
    } catch (error: unknown) {
        if (error instanceof CalibrationPublicationError) {
            return error;
        }
        throw error;
    }
    throw new Error('Expected publication failure.');
}
export const testNode = suite('calibration storage policy', [
    test('round trips and removes references by stable relative identity', async function (scope: TestScope) {
        const fixture = await calibrationStorage(calibrationStorageScenario);
        const written = await fixture.store.write('bench', [ first, second ], owners);
        const references = await fixture.store.list();
        scope.assert.equal(references.length, 2);
        scope.assert.deepEqual(
            references
                .map(function (reference) {
                    return fixture.store.pathOf(reference);
                })
                .toSorted(function alphabetical(left, right) {
                    return left.localeCompare(right);
                }),
            written.toSorted(function alphabetical(left, right) {
                return left.localeCompare(right);
            })
        );
        const removed = await fixture.store.remove(references);
        scope.assert.deepEqual(
            removed.toSorted(function alphabetical(left, right) {
                return left.localeCompare(right);
            }),
            written.toSorted(function alphabetical(left, right) {
                return left.localeCompare(right);
            })
        );
        scope.assert.deepEqual(await fixture.store.list(), []);
        return scope.assert.collect();
    }),
    test('returns an empty inventory when the project disappeared', async function (scope: TestScope) {
        const fixture = await calibrationStorage({ ...calibrationStorageScenario, missingRoot: true });
        scope.assert.deepEqual(await fixture.store.list(), []);
        return scope.assert.collect();
    }),
    test('rejects lexical and physical directory escapes', async function (scope: TestScope) {
        const fixture = await calibrationStorage({ ...calibrationStorageScenario, ancestor: '/outside' });
        const message = 'Calibration reference directory must remain inside the project root.';
        await scope.assert.rejects(async function () {
            return fixture.store.list();
        }, { message });
        await scope.assert.rejects(async function () {
            return fixture.store.write('bench', [ first ], owners);
        }, { message });
        await scope.assert.rejects(
            async function () {
                return openCalibrationReferenceStore(
                    { projectRoot: '/project', directory: '../outside', maxBytes: 1000 },
                    fixture.access
                );
            },
            { message }
        );
        return scope.assert.collect();
    }),
    test('validates the entire encoded batch before preparing storage', async function (scope: TestScope) {
        const fixture = await calibrationStorage({ ...calibrationStorageScenario, maxBytes: 1024 });
        await scope.assert.rejects(
            async function () {
                return fixture.store.write(
                    'bench',
                    [ first, { ...second, metadata: { payload: 'x'.repeat(2048) } } ],
                    owners
                );
            },
            { message: 'Calibration reference exceeds the configured artifact byte limit.' }
        );
        scope.assert.deepEqual(fixture.events, []);
        scope.assert.deepEqual(await fixture.store.list(), []);
        return scope.assert.collect();
    }),
    test('rejects nonregular stored references', async function (scope: TestScope) {
        const fixture = await calibrationStorage({ ...calibrationStorageScenario, regular: false });
        await fixture.store.write('bench', [ first ], owners);
        await scope.assert.rejects(async function () {
            return fixture.store.list();
        }, {
            message: 'Calibration reference is not a bounded regular file.'
        });
        return scope.assert.collect();
    }),
    test('bounds stored references before decoding', async function (scope: TestScope) {
        const fixture = await calibrationStorage({ ...calibrationStorageScenario, maxBytes: 1 });
        fixture.seed('references/calibration/large.calibration.json', 'large');
        await scope.assert.rejects(async function () {
            return fixture.store.list();
        }, {
            message: 'Calibration reference is not a bounded regular file.'
        });
        return scope.assert.collect();
    }),
    test('ignores unrelated files and rejects mismatched reference identities', async function (scope: TestScope) {
        const fixture = await calibrationStorage(calibrationStorageScenario);
        fixture.seed('references/calibration/notes.txt', 'ignored');
        scope.assert.deepEqual(await fixture.store.list(), []);
        fixture.seed(
            'references/calibration/wrong.calibration.json',
            JSON.stringify({ version: 1, profile: 'bench', snapshot: first, owners: [] })
        );
        await scope.assert.rejects(async function () {
            return fixture.store.list();
        }, {
            message: 'Calibration reference filename does not match its identity.'
        });
        return scope.assert.collect();
    }),
    test('preserves completed writes when the next file fails', async function (scope: TestScope) {
        const fixture = await calibrationStorage({ ...calibrationStorageScenario, writeFailure: 2 });
        const error = await failedPublication(async function () {
            return fixture.store.write('bench', [ first, second ], owners);
        });
        const references = await fixture.store.list();
        scope.assert.equal(error.cause, fixture.failure);
        scope.assert.deepEqual(
            error.completed(),
            references.map(function (reference) {
                return fixture.store.pathOf(reference);
            })
        );
        scope.assert.equal(references.length, 1);
        return scope.assert.collect();
    }),
    test('checks every reference before removing any file', async function (scope: TestScope) {
        const fixture = await calibrationStorage(calibrationStorageScenario);
        await fixture.store.write('bench', [ first, second ], owners);
        const references = await fixture.store.list();
        await fixture.store.write('bench', [ { ...second, metadata: { changed: true } } ], owners);
        await scope.assert.rejects(async function () {
            return fixture.store.remove(references);
        }, {
            message: 'Calibration reference changed during execution.'
        });
        const retained = await fixture.store.list();
        scope.assert.equal(retained.length, 2);
        return scope.assert.collect();
    }),
    test('reports completed removals when a later deletion fails', async function (scope: TestScope) {
        const fixture = await calibrationStorage({ ...calibrationStorageScenario, removalFailure: 2 });
        await fixture.store.write('bench', [ first, second ], owners);
        const references = await fixture.store.list();
        const error = await failedPublication(async function () {
            return fixture.store.remove(references);
        });
        const [ completed ] = references;
        scope.require.defined(completed);
        const retained = await fixture.store.list();
        scope.assert.deepEqual({ cause: error.cause, completed: error.completed(), remaining: retained.length }, {
            cause: fixture.failure,
            completed: [ fixture.store.pathOf(completed) ],
            remaining: 1
        });
        return scope.assert.collect();
    })
]);
