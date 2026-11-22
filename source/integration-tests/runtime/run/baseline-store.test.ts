import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';

import properLockfile from 'proper-lockfile';
import { createCaseId, createDefaultWorkId } from '../../../engine/identity.ts';
import { createOrdinaryBaselineStore, type OrdinaryBaselineStore } from '../../../run/baseline-store.ts';
import type { OrdinaryBaselineChange } from '../../../run/baseline-record.ts';

type StoreFixture = {
    readonly directory: string;
    readonly store: OrdinaryBaselineStore;
    readonly changes: readonly OrdinaryBaselineChange[];
};
async function storeFixture(cleanup: TestScope['cleanup']): Promise<StoreFixture> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp('target/baseline-lock-');
    cleanup(async function () {
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

const blockedPublication = defineCompositeAssertion({
    name: 'rejects a competing writer without publishing changes',
    async assert(check, fixture: StoreFixture) {
        const release = await properLockfile.lock(fixture.directory, { realpath: false });
        try {
            return check.group([
                await check.rejects(async function () {
                    return fixture.store.publish(fixture.changes);
                }, {
                    message: 'Lock file is already being held'
                }),
                check.deepEqual(await fixture.store.list(), [])
            ]);
        } finally {
            await release();
        }
    }
});
export const testNode = suite('ordinary baseline storage', [
    test('coordinates publication with other writers and releases its lock', async function (scope) {
        const fixture = await storeFixture(scope.cleanup);

        await scope.assert(blockedPublication, fixture);

        const result = await fixture.store.publish(fixture.changes);
        scope.assert(
            defineCompositeAssertion({
                name: 'coordinates publication with other writers and releases its lock',
                assert(check) {
                    return check.group([
                        check.equal(result.outcome.kind, 'written'),
                        check.deepEqual(result.errors, [])
                    ]);
                }
            })
        );
        const release = await properLockfile.lock(fixture.directory, { realpath: false });
        await release();
        const entries = await fixture.store.list();
        scope.assert.equal(entries.length, 1);
        return scope.assert.collect();
    })
]);
