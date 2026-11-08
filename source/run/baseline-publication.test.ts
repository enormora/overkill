import path from 'node:path';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { storedBaseline } from '../test-support/baseline-case-fixture.ts';
import { createOrdinaryBaselineFixture } from '../test-support/ordinary-baseline-fixture.ts';
import { createBaselineStorage } from './baseline-storage.ts';
import { createBaselinePublication } from './baseline-publication.ts';
import type { OrdinaryBaselineStore } from './baseline-store.ts';

async function assertCompletedWrite(scope: TestScope, store: OrdinaryBaselineStore): Promise<void> {
    const entries = await store.list();
    scope.assert.deepEqual(
        entries.map(function (entry) {
            return entry.baseline;
        }),
        [ storedBaseline ]
    );
}

export const testNode = suite('ordinary baseline batch publication', [
    test(
        'retains completed writes and the original error after a later write fails',
        async function (scope: TestScope) {
            const fixture = await createOrdinaryBaselineFixture(scope, 'in-process', 'text');
            const store = await fixture.store();
            const storage = createBaselineStorage({
                root: process.cwd(),
                directory: path.resolve(fixture.directory),
                maxBytes: 1024
            });
            const error = new Error('Storage became unavailable.');
            const publish = createBaselinePublication({
                directory: fixture.directory,
                checkDirectory: storage.checkDirectory,
                validate: store.validate,
                async apply(change) {
                    if (change.baseline.adapter === 'second') {
                        throw error;
                    }
                    await store.apply(change);
                }
            });
            const first = { kind: 'create' as const, baseline: storedBaseline };
            const committed = await publish([ first, {
                kind: 'create',
                baseline: { ...storedBaseline, adapter: 'second' }
            } ]);
            scope.assert.deepEqual(committed, {
                outcome: { kind: 'failed', writtenChanges: [ first ] },
                errors: [ error ]
            });
            await assertCompletedWrite(scope, store);
            return scope.assert.collect();
        }
    )
]);
