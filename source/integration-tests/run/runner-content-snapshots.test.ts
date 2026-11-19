import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { normalizeConfig, orchestrator, type RunCommand } from '../../packages/run/run.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { createOrdinaryBaselineStore, type OrdinaryBaselineStore } from '../../run/baseline-store.ts';

type SnapshotFixture = { readonly command: RunCommand; readonly store: OrdinaryBaselineStore; };
type SnapshotExecution = 'supervised-process' | 'worker-pool';
const fixtureFile = 'source/integration-tests/run/fixtures/content-snapshots.test.ts';

async function createSnapshotFixture(
    scope: TestScope,
    processModel: SnapshotExecution,
    file: string
): Promise<SnapshotFixture> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp('target/content-snapshots-');
    scope.cleanup(async function removeFixture() {
        await rm(directory, { recursive: true, force: true });
    });
    const config = normalizeConfig({
        runtimeStateDir: `${directory}/runtime`,
        profiles: {
            snapshots: {
                testFamily: 'integration',
                files: { include: [ file ] },
                baselines: { snapshots: true, directory },
                execution: { processModel },
                timeouts: { collectionMilliseconds: 120_000, softMilliseconds: 120_000, hardMilliseconds: 180_000 }
            }
        }
    });
    return {
        command: {
            config: { ...config, reporters: [] },
            cwd: process.cwd(),
            engine: { kind: 'default' },
            request: defaultRunRequest({ profile: 'snapshots' })
        },
        store: await createOrdinaryBaselineStore({ directory, projectRoot: process.cwd(), maxBytes: 1_048_576 })
    };
}

async function establishSnapshots(scope: TestScope, fixture: SnapshotFixture): Promise<void> {
    const missing = await orchestrator.run(fixture.command, { timing: null });
    scope.assert.equal(missing.status, 'failed');
    const bootstrap = await orchestrator.baseline.bootstrap(fixture.command, { timing: null });
    scope.assert.deepEqual(bootstrap.result.runnerErrors, []);
    scope.assert.equal(bootstrap.result.status, 'passed');
    scope.assert.equal(bootstrap.changes.length, 3);
    const matching = await orchestrator.run(fixture.command, { timing: null });
    scope.assert.deepEqual(matching.runnerErrors, []);
    scope.assert.equal(matching.status, 'passed');
}

async function verifyReadOnlyMismatch(scope: TestScope, fixture: SnapshotFixture): Promise<void> {
    const before = await fixture.store.list();
    const changed = await orchestrator.run(fixture.command, { timing: null });
    scope.assert.equal(changed.status, 'failed');
    const preview = await orchestrator.baseline.diff(fixture.command, { timing: null });
    scope.assert.equal(preview.writeOutcome.kind, 'read-only');
    scope.assert.equal(preview.changes.length, 1);
    const bootstrap = await orchestrator.baseline.bootstrap(fixture.command, { timing: null });
    scope.assert.equal(bootstrap.writeOutcome.kind, 'blocked');
    scope.assert.deepEqual(await fixture.store.list(), before);
}

async function updateChangedSnapshot(scope: TestScope, fixture: SnapshotFixture): Promise<void> {
    const entries = await fixture.store.list();
    const entry = entries.find(function textSnapshot(candidate) {
        return candidate.baseline.comparisonContext.name === 'response';
    });
    scope.require.defined(entry);
    await fixture.store.apply({
        kind: 'update',
        previous: entry.baseline,
        baseline: {
            ...entry.baseline,
            payload: { kind: 'text', text: 'changed expectation' }
        }
    });
    await verifyReadOnlyMismatch(scope, fixture);
    const updated = await orchestrator.baseline.update(fixture.command, { timing: null });
    scope.assert.equal(updated.result.status, 'passed');
    scope.assert.equal(updated.changes.length, 1);
}

async function reconcileSnapshotNames(scope: TestScope, fixture: SnapshotFixture): Promise<void> {
    const [ entry ] = await fixture.store.list();
    scope.require.defined(entry);
    await fixture.store.apply({
        kind: 'create',
        baseline: {
            ...entry.baseline,
            comparisonContext: { ...entry.baseline.comparisonContext, name: 'removed-name' }
        }
    });
    const filtered = { ...fixture.command, request: { ...fixture.command.request, paths: [ fixtureFile ] } };
    const preserved = await orchestrator.baseline.apply(filtered, { timing: null });
    scope.assert.equal(preserved.changes.length, 0);
    const preview = await orchestrator.baseline.diff(fixture.command, { timing: null });
    scope.assert.equal(preview.changes[0]?.kind, 'remove');
    const applied = await orchestrator.baseline.apply(fixture.command, { timing: null });
    scope.assert.equal(applied.changes.length, 1);
}

async function rejectInvalidSnapshot(scope: TestScope): Promise<void> {
    const fixture = await createSnapshotFixture(
        scope,
        'supervised-process',
        'source/integration-tests/run/fixtures/invalid-content-snapshot.test.ts'
    );
    const result = await orchestrator.baseline.update(fixture.command, { timing: null });
    scope.assert.equal(result.result.status, 'failed');
    scope.assert.equal(result.writeOutcome.kind, 'blocked');
    scope.assert.equal(result.changes.length, 1);
    scope.assert.true(result.result.runnerErrors.some(function artifactFailure(error) {
        return error.subtype === 'artifact' && error.attributedTo?.title === 'duplicate snapshot names';
    }));
    scope.assert.deepEqual(await fixture.store.list(), []);
}

export const testNode = suite('content snapshot workflow', [
    ...Array.from([ 'supervised-process', 'worker-pool' ] as const, function executionMode(processModel) {
        return test(`compares and updates snapshots with ${processModel}`, async function (scope) {
            const fixture = await createSnapshotFixture(scope, processModel, fixtureFile);
            await establishSnapshots(scope, fixture);
            await updateChangedSnapshot(scope, fixture);
            await reconcileSnapshotNames(scope, fixture);
            return scope.assert.collect();
        });
    }),
    test('blocks publication after a caught snapshot infrastructure failure', async function (scope) {
        await rejectInvalidSnapshot(scope);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
