import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { orchestrator, type BaselineRunResult } from '../../packages/run/run.entry-point.ts';
import {
    createOrdinaryBaselineFixture,
    ordinaryBaselineFixtureFile as fixture,
    type OrdinaryBaselineFixture
} from '../../test-support/ordinary-baseline-fixture.ts';
import type { OrdinaryBaselineStore } from '../../run/baseline-store.ts';

type BaselineEntries = Awaited<ReturnType<OrdinaryBaselineFixture['entries']>>;
function assertWritten(scope: TestScope, result: BaselineRunResult, changes: number): void {
    scope.assert.equal(result.result.status, 'passed');
    scope.assert.deepEqual(result.result.runnerErrors, []);
    scope.assert.equal(result.writeOutcome.kind, 'written');
    scope.assert.equal(result.changes.length, changes);
}
async function assertDiskOnlyList(scope: TestScope, data: OrdinaryBaselineFixture): Promise<BaselineEntries> {
    const observed = data.observations();
    const entries = await data.entries();
    scope.assert.equal(entries.length, 2);
    scope.assert.equal(data.observations(), observed);
    return entries;
}
async function establishBaselines(scope: TestScope, data: OrdinaryBaselineFixture): Promise<BaselineEntries> {
    const missing = await orchestrator.run(data.command, { timing: null });
    scope.assert.equal(missing.summary.failed, 2);
    assertWritten(scope, await orchestrator.baseline.bootstrap(data.command, { timing: null }), 2);
    const compared = await orchestrator.run(data.command, { timing: null });
    scope.assert.equal(compared.status, 'passed');
    return await assertDiskOnlyList(scope, data);
}
async function assertReadOnlyChanges(
    scope: TestScope,
    data: OrdinaryBaselineFixture,
    original: BaselineEntries
): Promise<void> {
    data.setActual(43);
    const changed = await orchestrator.run(data.command, { timing: null });
    scope.assert.equal(changed.summary.failed, 2);
    const preview = await orchestrator.baseline.diff(data.command, { timing: null });
    scope.assert.equal(preview.writeOutcome.kind, 'read-only');
    scope.assert.equal(preview.changes.length, 2);
    scope.assert.deepEqual(await data.entries(), original);
    const bootstrap = await orchestrator.baseline.bootstrap(data.command, { timing: null });
    scope.assert.equal(bootstrap.writeOutcome.kind, 'blocked');
    scope.assert.deepEqual(await data.entries(), original);
}
async function seedStaleEntries(scope: TestScope, data: OrdinaryBaselineFixture): Promise<OrdinaryBaselineStore> {
    const store = await data.store();
    const entries = await store.list();
    const [ entry ] = entries;
    scope.require.defined(entry);
    for (
        const identity of [
            { title: 'removed', profile: 'unit', adapter: 'output' },
            { title: 'unavailable', profile: 'unit', adapter: 'output' },
            { title: 'removed', profile: 'other', adapter: 'output' },
            { title: 'removed', profile: 'unit', adapter: 'retired' }
        ]
    ) {
        await store.apply({
            kind: 'create',
            baseline: {
                ...entry.baseline,
                profile: identity.profile,
                adapter: identity.adapter,
                work: {
                    ...entry
                        .baseline
                        .work,
                    case: { ...entry.baseline.work.case, title: identity.title }
                }
            }
        });
    }
    return store;
}
async function assertCleanupPreview(
    scope: TestScope,
    data: OrdinaryBaselineFixture,
    store: OrdinaryBaselineStore
): Promise<void> {
    const compared = await orchestrator.run(data.command, { timing: null });
    scope.assert.equal(compared.status, 'failed');
    const filtered = { ...data.command, request: { ...data.command.request, paths: [ fixture ] } };
    assertWritten(scope, await orchestrator.baseline.apply(filtered, { timing: null }), 0);
    const preview = await orchestrator.baseline.diff(data.command, { timing: null });
    scope.assert.equal(preview.changes.length, 1);
    const entries = await store.list();
    scope.assert.equal(entries.length, 6);
}
async function assertEntryCount(scope: TestScope, store: OrdinaryBaselineStore, expected: number): Promise<void> {
    const entries = await store.list();
    scope.assert.equal(entries.length, expected);
}
export const testNode = suite('ordinary baseline workflows', [
    ...([ 'in-process', 'supervised-process', 'worker-pool' ] as const).map(function executionCase(execution) {
        return test(`reconciles ordinary baselines with ${execution}`, async function (scope: TestScope) {
            const data = await createOrdinaryBaselineFixture(
                scope,
                execution,
                execution === 'in-process' ? 'text' : 'binary'
            );
            const original = await establishBaselines(scope, data);
            await assertReadOnlyChanges(scope, data, original);
            assertWritten(scope, await orchestrator.baseline.update(data.command, { timing: null }), 2);
            const compared = await orchestrator.run(data.command, { timing: null });
            scope.assert.equal(compared.status, 'passed');
            return scope.assert.collect();
        });
    }),
    test(
        'cleans only complete selected inventories and preserves skipped and foreign entries',
        async function (scope: TestScope) {
            const data = await createOrdinaryBaselineFixture(scope, 'in-process', 'text');
            assertWritten(scope, await orchestrator.baseline.update(data.command, { timing: null }), 2);
            const store = await seedStaleEntries(scope, data);
            await assertCleanupPreview(scope, data, store);
            assertWritten(scope, await orchestrator.baseline.update(data.command, { timing: null }), 0);
            await assertEntryCount(scope, store, 6);
            assertWritten(scope, await orchestrator.baseline.apply(data.command, { timing: null }), 1);
            await assertEntryCount(scope, store, 5);
            return scope.assert.collect();
        }
    )
]);
await runIfMain(import.meta, testNode);
