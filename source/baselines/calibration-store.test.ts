import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
    test('rejects references outside the project root', async function (scope: TestScope) {
        const fixture = await calibrationStore(scope);
        await scope.assert.rejects(async function () {
            return await createCalibrationReferenceStore({
                projectRoot: fixture.root,
                directory: '../outside',
                maxBytes: 65_536
            });
        }, { message: 'Calibration reference directory must remain inside the project root.' });
        return scope.assert.collect();
    }),
    test('treats a missing project root as an empty inventory', async function (scope: TestScope) {
        const fixture = await calibrationStore(scope);
        const store = await createCalibrationReferenceStore({
            projectRoot: path.join(fixture.root, 'missing'),
            directory: 'references',
            maxBytes: 65_536
        });
        scope.assert.deepEqual(await store.list(), []);
        return scope.assert.collect();
    }),
    test('surfaces unexpected project root read failures', async function (scope: TestScope) {
        const fixture = await calibrationStore(scope);
        await writeFile(path.join(fixture.root, 'project-file'), 'not a directory');
        const store = await createCalibrationReferenceStore({
            projectRoot: path.join(fixture.root, 'project-file', 'child'),
            directory: 'references',
            maxBytes: 65_536
        });
        await scope.assert.rejects(async function () {
            return await store.list();
        }, { code: 'ENOTDIR' });
        return scope.assert.collect();
    }),
    test('surfaces unexpected reference directory read failures', async function (scope: TestScope) {
        const fixture = await calibrationStore(scope);
        await mkdir(path.join(fixture.root, 'references'));
        await writeFile(path.join(fixture.root, 'references', 'calibration'), 'not a directory');
        await scope.assert.rejects(async function () {
            return await fixture.store.list();
        }, { code: 'ENOTDIR' });
        return scope.assert.collect();
    }),
    test('rejects directories pretending to be reference files', async function (scope: TestScope) {
        const fixture = await calibrationStore(scope);
        await mkdir(path.join(fixture.root, referencePath(fixture, fixture.first)), { recursive: true });
        await scope.assert.rejects(async function () {
            return await fixture.store.list();
        }, {
            message: 'Calibration reference is not a bounded regular file.'
        });
        return scope.assert.collect();
    }),
    test('rejects oversized stored references without removing them', async function (scope: TestScope) {
        const fixture = await calibrationStore(scope);
        await fixture.store.write('bench', [ fixture.first ], function () {
            return [];
        });
        const limited = await createCalibrationReferenceStore({
            projectRoot: fixture.root,
            directory: 'references',
            maxBytes: 1
        });
        await scope.assert.rejects(async function () {
            return await limited.list();
        }, {
            message: 'Calibration reference is not a bounded regular file.'
        });
        const references = await fixture.store.list();
        scope.assert.equal(references.length, 1);
        return scope.assert.collect();
    }),
    test('rejects reference filenames that disagree with their stored identity', async function (scope: TestScope) {
        const fixture = await calibrationStore(scope);
        await fixture.store.write('bench', [ fixture.first ], function () {
            return [];
        });
        const content = await readFile(path.join(fixture.root, referencePath(fixture, fixture.first)), 'utf8');
        await writeFile(path.join(fixture.root, 'references/calibration/wrong.calibration.json'), content);
        await scope.assert.rejects(async function () {
            return await fixture.store.list();
        }, {
            message: 'Calibration reference filename does not match its identity.'
        });
        return scope.assert.collect();
    }),
    test('validates the whole publication batch before writing any reference', async function (scope: TestScope) {
        const fixture = await calibrationStore(scope);
        const bounded = await createCalibrationReferenceStore({
            projectRoot: fixture.root,
            directory: 'references',
            maxBytes: 1024
        });
        await bounded.write('bench', [ fixture.first ], function () {
            return [];
        });
        await bounded.remove(await bounded.list());
        await scope.assert.rejects(async function () {
            return await bounded.write('bench', [ fixture.first, {
                ...fixture.second,
                metadata: { payload: 'x'.repeat(2048) }
            } ], function () {
                return [];
            });
        }, { message: 'Calibration reference exceeds the configured artifact byte limit.' });
        scope.assert.deepEqual(await fixture.store.list(), []);
        return scope.assert.collect();
    }),
    test('rejects reference directories that resolve outside the project', async function (scope: TestScope) {
        const fixture = await calibrationStore(scope);
        const outside = await mkdtemp(path.join(tmpdir(), 'overkill-calibration-outside-'));
        scope.cleanup(async function () {
            await rm(outside, { recursive: true, force: true });
        });
        await symlink(outside, path.join(fixture.root, 'references'), 'dir');
        await scope.assert.rejects(async function () {
            return await fixture.store.list();
        }, {
            message: 'Calibration reference directory must remain inside the project root.'
        });
        await scope.assert.rejects(async function () {
            return await fixture.store.write('bench', [ fixture.first ], function () {
                return [];
            });
        }, {
            message: 'Calibration reference directory must remain inside the project root.'
        });
        return scope.assert.collect();
    }),
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
