import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import properLockfile from 'proper-lockfile';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import { createOrdinaryBaselineStore, type OrdinaryBaselineStore } from './baseline-store.ts';
import type { OrdinaryBaselineChange } from './baseline-record.ts';

type StoreFixture = {
    readonly directory: string;
    readonly store: OrdinaryBaselineStore;
    readonly changes: readonly OrdinaryBaselineChange[];
};
async function storeFixture(scope: TestScope): Promise<StoreFixture> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp('target/baseline-lock-');
    scope.cleanup(async function () {
        await rm(directory, { recursive: true, force: true });
    });
    const store = await createOrdinaryBaselineStore({ directory, projectRoot: process.cwd(), maxBytes: 65_536 });
    const changes: readonly OrdinaryBaselineChange[] = [ {
        kind: 'create',
        baseline: {
            version: 1,
            adapter: 'output',
            profile: 'unit',
            subtype: 'content-snapshot',
            comparisonContext: {},
            work: createDefaultWorkId(createCaseId('output.test.ts', [], 'output', null)),
            payload: { kind: 'text', text: 'output' }
        }
    } ];
    return { directory, store, changes };
}
async function assertHeldLock(scope: TestScope, fixture: StoreFixture): Promise<void> {
    const release = await properLockfile.lock(fixture.directory, { realpath: false });
    try {
        await scope.assert.rejects(async function () {
            return await fixture.store.publish(fixture.changes);
        }, { type: Error });
        scope.assert.deepEqual(await fixture.store.list(), []);
    } finally {
        await release();
    }
}
export const testNode = suite('ordinary baseline storage', [
    test('coordinates publication with other writers and releases its lock', async function (scope: TestScope) {
        const fixture = await storeFixture(scope);
        await assertHeldLock(scope, fixture);
        const result = await fixture.store.publish(fixture.changes);
        scope.assert.equal(result.outcome.kind, 'written');
        scope.assert.deepEqual(result.errors, []);
        const release = await properLockfile.lock(fixture.directory, { realpath: false });
        await release();
        const entries = await fixture.store.list();
        scope.assert.equal(entries.length, 1);
        return scope.assert.collect();
    })
]);
