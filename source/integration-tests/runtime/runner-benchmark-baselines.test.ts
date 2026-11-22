import { posix as path } from 'node:path';
import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { type TestScope, suite, test } from '@overkill-dev/test';

import {
    createBenchmarkBaselineFixture,
    readBaselineContents,
    performanceBaselineFixtureFile as fixture,
    type BaselineFixture
} from '../../test-support/benchmark-baseline-fixture.ts';
import {
    normalizeConfig,
    orchestrator,
    type BenchmarkExecution,
    type BenchmarkBaselineRunResult
} from '../../packages/run/run.entry-point.ts';
import { createPerformanceBaselineStore } from '../../baselines/performance-store.ts';

const successfulWriteChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    result: BenchmarkBaselineRunResult,
    count: number
): CompositeAssertionReturn<'assert'> {
    return check.group([
        check.equal(result.result.status, 'passed'),
        check.deepEqual(result.result.runnerErrors, []),
        check.equal(result.writeOutcome.kind, 'written'),
        check.equal(result.changes.length, count)
    ]);
};
const assertSuccessfulWrite = defineCompositeAssertion({
    name: 'successful write',
    assert: successfulWriteChecks
});

const bootstrapAndUpdateChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    fixtureData: BaselineFixture,
    original: readonly string[]
): Promise<CompositeAssertionReturn<'assert'>> {
    const { command } = fixtureData;
    const bootstrap = await orchestrator.bench.baseline.bootstrap(command, { timing: null });
    return check.group([
        check.equal(bootstrap.result.summary.failed, 2),
        check.equal(bootstrap.writeOutcome.kind, 'blocked'),
        check.deepEqual(await readBaselineContents(fixtureData), original),
        successfulWriteChecks(
            check.annotated('successful write'),
            await orchestrator
                .bench
                .baseline
                .update(command, { timing: null }),
            2
        ),
        check.notDeepEqual(await readBaselineContents(fixtureData), original)
    ]);
};

async function addStaleBaselines(
    store: Awaited<ReturnType<typeof createPerformanceBaselineStore>>
): Promise<void> {
    const [ entry ] = await store.list();
    if (entry === undefined) {
        throw new Error('Expected entry to satisfy defined.');
    }
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

const assertFilteredInventory = defineCompositeAssertion({
    name: 'filtered inventory',
    async assert(check, fixtureData: BaselineFixture) {
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
        return check.group([
            check.equal(filteredApply.changes.length, 0),
            check.deepEqual(await readBaselineContents(fixtureData), original)
        ]);
    }
});

const staleDiffAndApplyChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    fixtureData: BaselineFixture,
    original: readonly string[],
    store: Awaited<ReturnType<typeof createPerformanceBaselineStore>>
): Promise<CompositeAssertionReturn<'assert'>> {
    const { command } = fixtureData;
    const diff = await orchestrator.bench.baseline.diff(command, { timing: null });
    const initialChecks = check.group([
        check.deepEqual(
            diff.changes.map(function changeKind(change) {
                return change.kind;
            }),
            [ 'remove' ]
        ),
        check.deepEqual(await readBaselineContents(fixtureData), original),
        successfulWriteChecks(
            check.annotated('successful write'),
            await orchestrator.bench.baseline.apply(command, { timing: null }),
            1
        )
    ]);
    const remaining = await store.list();
    return check.group([ initialChecks, check.equal(remaining.length, 4) ]);
};

const existingWorkflowChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    fixtureData: BaselineFixture
): Promise<CompositeAssertionReturn<'assert'>> {
    const { command } = fixtureData;
    const original = await readBaselineContents(fixtureData);
    const compared = await orchestrator.bench.run(command, { timing: null });
    const initialChecks = check.equal(compared.status, 'passed');
    fixtureData.setOffset(10);
    const preview = await orchestrator.bench.baseline.diff(command, { timing: null });
    return check.group([
        initialChecks,
        check.equal(preview.changes.length, 2),
        check.equal(preview.writeOutcome.kind, 'read-only'),
        check.deepEqual(await readBaselineContents(fixtureData), original),
        await bootstrapAndUpdateChecks(check.annotated('bootstrap and update'), fixtureData, original)
    ]);
};

const assertCompleteInventory = defineCompositeAssertion({
    name: 'complete inventory',
    async assert(
        check,
        fixtureData: BaselineFixture,
        store: Awaited<ReturnType<typeof createPerformanceBaselineStore>>
    ) {
        const { command } = fixtureData;
        const original = await readBaselineContents(fixtureData);
        const update = await orchestrator.bench.baseline.update(command, { timing: null });
        return check.group([
            check.equal(update.writeOutcome.kind, 'blocked'),
            check.equal(update.result.runnerErrors[0]?.subtype, 'artifact'),
            check.deepEqual(await readBaselineContents(fixtureData), original),
            await staleDiffAndApplyChecks(check.annotated('stale diff and apply'), fixtureData, original, store)
        ]);
    }
});

const assertWorkflow = defineCompositeAssertion({
    name: 'workflow',
    async assert(check, registerCleanup: TestScope['cleanup'], execution: BenchmarkExecution) {
        const fixtureData = await createBenchmarkBaselineFixture(registerCleanup, execution);
        const { command } = fixtureData;
        const missing = await orchestrator.bench.run(command, { timing: null });
        return check.group([
            check.equal(missing.summary.failed, 2),
            successfulWriteChecks(
                check.annotated('successful write'),
                await orchestrator
                    .bench
                    .baseline
                    .bootstrap(command, { timing: null }),
                2
            ),
            await existingWorkflowChecks(check.annotated('existing workflow'), fixtureData)
        ]);
    }
});

export const testNode = suite('benchmark baseline commands', [
    test(
        'baseline verbs preserve comparisons and read-only previews in supervised execution',
        async function (scope) {
            await scope.assert(assertWorkflow, scope.cleanup, {
                processModel: 'supervised-process',
                maxConcurrency: 1,
                scheduling: 'serial'
            });
            return scope.assert.collect();
        }
    ),
    test(
        'baseline verbs preserve comparisons and read-only previews in worker pools',
        async function (scope) {
            const defaults = normalizeConfig({
                profiles: { startup: { testFamily: 'benchmark', files: { include: [ fixture ] } } }
            });
            const profile = defaults.profiles.startup;
            if (profile?.testFamily !== 'benchmark') {
                throw new Error('Missing benchmark profile.');
            }
            await scope.assert(assertWorkflow, scope.cleanup, profile.execution);
            return scope.assert.collect();
        }
    ),
    test('cleanup requires a complete inventory and preserves other machine classes', async function (scope) {
        const fixtureData = await createBenchmarkBaselineFixture(scope.cleanup, {
            processModel: 'supervised-process',
            maxConcurrency: 1,
            scheduling: 'serial'
        });
        const { command } = fixtureData;
        scope.assert(assertSuccessfulWrite, await orchestrator.bench.baseline.update(command, { timing: null }), 2);
        const store = await createPerformanceBaselineStore({
            directory: path.join(fixtureData.directory, 'baselines'),
            maxBytes: 10_485_760,
            projectRoot: process.cwd()
        });
        await addStaleBaselines(store);
        await scope.assert(assertFilteredInventory, fixtureData);
        await scope.assert(assertCompleteInventory, fixtureData, store);

        return scope.assert.collect();
    })
]);
