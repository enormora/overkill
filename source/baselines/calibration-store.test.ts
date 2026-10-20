import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import type { CalibrationSnapshot } from '../engine/benchmark-result.ts';
import { calibrationSnapshot } from '../test-support/calibration-fixture.ts';
import { storedCalibrationSchema, type StoredCalibration } from './calibration-reference.ts';
import {
    createCalibrationReferenceStore,
    CalibrationPublicationError,
    type CalibrationReferenceStore
} from './calibration-store.ts';

type CalibrationStoreFixture = {
    readonly root: string;
    readonly store: CalibrationReferenceStore;
    readonly first: CalibrationSnapshot;
    readonly second: CalibrationSnapshot;
};
async function calibrationStore(scope: TestScope): Promise<CalibrationStoreFixture> {
    const root = await mkdtemp(path.join(tmpdir(), 'overkill-calibration-'));
    scope.cleanup(async function removeReferences() {
        await rm(root, { recursive: true, force: true });
    });
    const store = await createCalibrationReferenceStore({
        projectRoot: root,
        directory: 'references',
        maxBytes: 65_536
    });
    const first = calibrationSnapshot([ 100, 100 ]);
    const second = {
        ...first,
        identity: { ...first.identity, workload: { ...first.identity.workload, name: 'second' } }
    };
    return { root, store, first, second };
}
function referencePath(fixture: CalibrationStoreFixture, snapshot: CalibrationSnapshot): string {
    return fixture.store.pathOf({ profile: 'bench', snapshot, owners: [], version: 1 });
}
async function publicationFailure(
    store: CalibrationReferenceStore,
    snapshots: readonly CalibrationSnapshot[]
): Promise<CalibrationPublicationError> {
    try {
        await store.write('bench', snapshots, function owners() {
            return [];
        });
    } catch (error: unknown) {
        if (error instanceof CalibrationPublicationError) {
            return error;
        }
        throw error;
    }
    throw new Error('Expected calibration publication to fail.');
}
async function removalFailure(
    store: CalibrationReferenceStore,
    references: readonly StoredCalibration[]
): Promise<Error> {
    try {
        await store.remove(references);
    } catch (error: unknown) {
        if (error instanceof Error) {
            return error;
        }
        throw error;
    }
    throw new Error('Expected calibration removal to fail.');
}
export const testNode = suite('calibration reference persistence', [
    test('reports completed files when a later publication fails', async function (scope: TestScope) {
        const fixture = await calibrationStore(scope);
        await mkdir(path.join(fixture.root, referencePath(fixture, fixture.second)), { recursive: true });
        const error = await publicationFailure(fixture.store, [ fixture.first, fixture.second ]);
        const completed = referencePath(fixture, fixture.first);
        scope.assert.deepEqual(error.completed(), [ completed ]);
        const stored = storedCalibrationSchema.parse(
            JSON.parse(await readFile(path.join(fixture.root, completed), 'utf8'))
        );
        scope.assert.deepEqual(stored.snapshot, fixture.first);
        return scope.assert.collect();
    }),
    test('validates every removal before deleting any reference', async function (scope: TestScope) {
        const fixture = await calibrationStore(scope);
        await fixture.store.write('bench', [ fixture.first, fixture.second ], function owners() {
            return [];
        });
        const references = await fixture.store.list();
        await fixture.store.write('bench', [ { ...fixture.second, metadata: { changed: true } } ], function owners() {
            return [];
        });
        const error = await removalFailure(fixture.store, references);
        scope.assert.equal(error.message, 'Calibration reference changed during execution.');
        const retained = await fixture.store.list();
        scope.assert.equal(retained.length, 2);
        return scope.assert.collect();
    })
]);
