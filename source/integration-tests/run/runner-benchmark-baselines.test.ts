import { posix as path } from 'node:path';
import {
    createBenchmarkBaselineFixture,
    readBaselineContents,
    performanceBaselineFixtureFile as fixture,
    type BaselineFixture
} from '../../test-support/benchmark-baseline-fixture.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import {
    normalizeConfig,
    orchestrator,
    type BenchmarkExecution,
    type BenchmarkBaselineRunResult
} from '../../packages/run/run.entry-point.ts';
import { createPerformanceBaselineStore } from '../../baselines/performance-store.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { runIfMain } from '../direct-launcher.test.ts';

function assertSuccessfulWrite(scope: TestScope, result: BenchmarkBaselineRunResult, count: number): void {
    scope.assert.equal(result.result.status, 'passed');
    scope.assert.deepEqual(result.result.runnerErrors, []);
    scope.assert.equal(result.writeOutcome.kind, 'written');
    scope.assert.equal(result.changes.length, count);
}

async function assertBootstrapAndUpdate(
    scope: TestScope,
    fixtureData: BaselineFixture,
    original: readonly string[]
): Promise<void> {
    const { command } = fixtureData;
    const bootstrap = await orchestrator.bench.baseline.bootstrap(command, { timing: null });
    scope.assert.equal(bootstrap.result.summary.failed, 2);
    scope.assert.equal(bootstrap.writeOutcome.kind, 'blocked');
    scope.assert.deepEqual(await readBaselineContents(fixtureData), original);
    assertSuccessfulWrite(scope, await orchestrator.bench.baseline.update(command, { timing: null }), 2);
    scope.assert.notDeepEqual(await readBaselineContents(fixtureData), original);
}

async function addStaleBaselines(
    scope: TestScope,
    store: Awaited<ReturnType<typeof createPerformanceBaselineStore>>
): Promise<void> {
    const [ entry ] = await store.list();
    scope.require.defined(entry);
    const stale = { ...entry.baseline, adapter: 'retired' };
    const foreign = {
        ...stale,
        expected: { ...stale.expected, calibration: { ...stale.expected.calibration, machineClass: 'other-machine' } }
    };
    await store.apply({ baseline: stale, kind: 'create' });
    await store.apply({ baseline: foreign, kind: 'create' });
    const skipped = {
        ...entry.baseline,
        work: { ...entry.baseline.work, case: { ...entry.baseline.work.case, title: 'unavailable' } }
    };
    await store.apply({ baseline: skipped, kind: 'create' });
}

async function assertFilteredInventory(scope: TestScope, fixtureData: BaselineFixture): Promise<void> {
    const { command } = fixtureData;
    const original = await readBaselineContents(fixtureData);
    const filtered = {
        ...command,
        request: {
            ...command.request,
            selection: {
                kind: 'filter' as const,
                filter: { kind: 'equals' as const, field: 'title' as const, value: 'first' }
            }
        }
    };
    const filteredApply = await orchestrator.bench.baseline.apply(filtered, { timing: null });
    scope.assert.equal(filteredApply.changes.length, 0);
    scope.assert.deepEqual(await readBaselineContents(fixtureData), original);
}

async function assertStaleDiffAndApply(
    scope: TestScope,
    fixtureData: BaselineFixture,
    original: readonly string[],
    store: Awaited<ReturnType<typeof createPerformanceBaselineStore>>
): Promise<void> {
    const { command } = fixtureData;
    const diff = await orchestrator.bench.baseline.diff(command, { timing: null });
    scope.assert.deepEqual(
        diff.changes.map(function changeKind(change) {
            return change.kind;
        }),
        [ 'remove' ]
    );
    scope.assert.deepEqual(await readBaselineContents(fixtureData), original);
    assertSuccessfulWrite(scope, await orchestrator.bench.baseline.apply(command, { timing: null }), 1);
    const remaining = await store.list();
    scope.assert.equal(remaining.length, 4);
}

async function assertExistingWorkflow(scope: TestScope, fixtureData: BaselineFixture): Promise<void> {
    const { command } = fixtureData;
    const original = await readBaselineContents(fixtureData);
    const compared = await orchestrator.bench.run(command, { timing: null });
    scope.assert.equal(compared.status, 'passed');
    fixtureData.setOffset(10);
    const preview = await orchestrator.bench.baseline.diff(command, { timing: null });
    scope.assert.equal(preview.changes.length, 2);
    scope.assert.equal(preview.writeOutcome.kind, 'read-only');
    scope.assert.deepEqual(await readBaselineContents(fixtureData), original);
    await assertBootstrapAndUpdate(scope, fixtureData, original);
}

async function assertCompleteInventory(
    scope: TestScope,
    fixtureData: BaselineFixture,
    store: Awaited<ReturnType<typeof createPerformanceBaselineStore>>
): Promise<void> {
    const { command } = fixtureData;
    const original = await readBaselineContents(fixtureData);
    const update = await orchestrator.bench.baseline.update(command, { timing: null });
    scope.assert.equal(update.writeOutcome.kind, 'blocked');
    scope.assert.equal(update.result.runnerErrors[0]?.subtype, 'artifact');
    scope.assert.deepEqual(await readBaselineContents(fixtureData), original);
    await assertStaleDiffAndApply(scope, fixtureData, original, store);
}

async function assertWorkflow(scope: TestScope, execution: BenchmarkExecution): Promise<void> {
    const fixtureData = await createBenchmarkBaselineFixture(scope, execution);
    const { command } = fixtureData;
    const missing = await orchestrator.bench.run(command, { timing: null });
    scope.assert.equal(missing.summary.failed, 2);
    assertSuccessfulWrite(scope, await orchestrator.bench.baseline.bootstrap(command, { timing: null }), 2);
    await assertExistingWorkflow(scope, fixtureData);
}

async function assertStaleScope(scope: TestScope): Promise<void> {
    const fixtureData = await createBenchmarkBaselineFixture(scope, {
        processModel: 'supervised-process',
        maxConcurrency: 1,
        scheduling: 'serial'
    });
    const { command } = fixtureData;
    assertSuccessfulWrite(scope, await orchestrator.bench.baseline.update(command, { timing: null }), 2);
    const store = await createPerformanceBaselineStore({
        directory: path.join(fixtureData.directory, 'baselines'),
        maxBytes: 10_485_760,
        projectRoot: process.cwd()
    });
    await addStaleBaselines(scope, store);
    await assertFilteredInventory(scope, fixtureData);
    await assertCompleteInventory(scope, fixtureData, store);
}

export const testNode = suite('benchmark baseline commands', [
    test(
        'baseline verbs preserve comparisons and read-only previews in supervised execution',
        async function (scope: TestScope) {
            await assertWorkflow(scope, {
                processModel: 'supervised-process',
                maxConcurrency: 1,
                scheduling: 'serial'
            });
            return scope.assert.collect();
        }
    ),
    test(
        'baseline verbs preserve comparisons and read-only previews in worker pools',
        async function (scope: TestScope) {
            const defaults = normalizeConfig({
                profiles: { startup: { testFamily: 'benchmark', files: { include: [ fixture ] } } }
            });
            const profile = defaults.profiles.startup;
            if (profile?.testFamily !== 'benchmark') {
                throw new Error('Missing benchmark profile.');
            }
            await assertWorkflow(scope, profile.execution);
            return scope.assert.collect();
        }
    ),
    test(
        'cleanup requires a complete inventory and preserves other machine classes',
        async function (scope: TestScope) {
            await assertStaleScope(scope);
            return scope.assert.collect();
        }
    )
]);

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
