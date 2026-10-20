import type { RunResult } from '../../engine/run-result.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { orchestrator, type RunCommand } from '../../packages/run/run.entry-point.ts';
import { createPerformanceBaselineStore, type PerformanceBaselineStore } from '../../baselines/performance-store.ts';
import { normalizationCommand, normalizationReferences } from '../../test-support/benchmark-normalization-fixture.ts';
import { normalizationBaselineAdapter } from '../../test-support/normalization-baseline-adapter.ts';

async function baselineCommand(scope: TestScope, adapters: readonly string[]): Promise<RunCommand> {
    const command = await normalizationCommand(scope, 'reuse', 'normalized metric');
    const profile = command.config.profiles.bench;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Expected benchmark profile.');
    }
    return {
        ...command,
        config: {
            ...command.config,
            profiles: {
                ...command
                    .config
                    .profiles,
                bench: {
                    ...profile,
                    baselines: { ...profile.baselines, adapters: adapters.map(normalizationBaselineAdapter) }
                }
            }
        }
    };
}
async function saveReference(scope: TestScope, command: RunCommand): Promise<void> {
    const capture = await orchestrator.bench.calibrate(command, { timing: null });
    scope.assert.equal(capture.result.status, 'passed');
    const store = await normalizationReferences(command);
    const [ reference ] = await store.list();
    scope.require.defined(reference);
    await store.write('bench', [ {
        ...reference.snapshot,
        samples: reference.snapshot.samples.map(function fixedSample() {
            return 100;
        })
    } ], function owners() {
        return reference.owners;
    });
    const saved = await orchestrator.bench.baseline.update(command, { timing: null });
    scope.assert.equal(saved.result.status, 'passed');
    scope.assert.equal(saved.writeOutcome.kind, 'written');
}
async function performanceStore(command: RunCommand): Promise<PerformanceBaselineStore> {
    const profile = command.config.profiles.bench;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Expected benchmark profile.');
    }
    return await createPerformanceBaselineStore({
        directory: profile.baselines.directory,
        projectRoot: command.cwd,
        maxBytes: profile.attachments.maxArtifactBytes
    });
}
async function replaceSavedReference(scope: TestScope, command: RunCommand): Promise<void> {
    const store = await performanceStore(command);
    const [ entry ] = await store.list();
    scope.require.defined(entry);
    const { baseline } = entry;
    if (baseline.version !== 2 || baseline.normalization === null) {
        throw new Error('Expected normalized baseline.');
    }
    const metric = baseline.normalization.metrics.value;
    scope.require.defined(metric);
    const normalization = {
        ...baseline.normalization,
        metrics: {
            ...baseline.normalization.metrics,
            value: {
                ...metric,
                actual: {
                    ...metric.actual,
                    samples: metric
                        .actual
                        .samples
                        .map(function savedSample() {
                            return 400;
                        })
                }
            }
        }
    };
    await store.apply({ kind: 'update', previous: baseline, baseline: { ...baseline, normalization } });
}
function assertSavedReference(scope: TestScope, result: RunResult): void {
    const measured = result.perTest[0]?.benchmark;
    scope.require.defined(measured);
    const { normalization } = measured;
    scope.require.defined(normalization);
    const metric = normalization.metrics.value;
    scope.require.defined(metric);
    scope.assert.equal(metric.source, 'baseline');
    scope.assert.equal(metric.summary?.median, 200);
    scope.assert.equal(metric.budgets[0]?.maximum, 300);
    scope.assert.equal(measured.budgets[0]?.estimate, 50);
}
function rawCommand(command: RunCommand): RunCommand {
    const profile = command.config.profiles.bench;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Expected benchmark profile.');
    }
    return {
        ...command,
        request: { ...command.request, selection: { kind: 'all' as const } },
        config: {
            ...command.config,
            profiles: {
                ...command
                    .config
                    .profiles,
                bench: {
                    ...profile,
                    files: {
                        exclude: [],
                        include: [ 'source/integration-tests/run/fixtures/normalization-raw.bench.test.ts' ]
                    }
                }
            }
        }
    };
}
async function assertStaleDiffAndApply(scope: TestScope, raw: RunCommand): Promise<void> {
    const store = await normalizationReferences(raw);
    const diff = await orchestrator.bench.baseline.diff(raw, { timing: null });
    scope.assert.deepEqual(
        diff.calibrationChanges.map(function kind(change) {
            return change.kind;
        }),
        [ 'remove' ]
    );
    const references = await store.list();
    scope.assert.equal(references.length, 1);
    const applied = await orchestrator.bench.baseline.apply(raw, { timing: null });
    scope.assert.equal(applied.result.status, 'passed');
    scope.assert.deepEqual(await store.list(), []);
}
export const testNode = suite('saved normalization references', [
    test('uses saved references while preserving the original budget basis', async function (scope: TestScope) {
        const command = await baselineCommand(scope, [ 'reference' ]);
        await saveReference(scope, command);
        await replaceSavedReference(scope, command);
        const result = await orchestrator.bench.run(command, { timing: null });
        scope.assert.deepEqual(result.runnerErrors, []);
        scope.assert.equal(result.status, 'passed');
        assertSavedReference(scope, result);
        return scope.assert.collect();
    }),
    test('keeps unchanged expectations stable across calibration reruns', async function (scope: TestScope) {
        const command = await baselineCommand(scope, [ 'reference' ]);
        await saveReference(scope, command);
        const diff = await orchestrator.bench.baseline.diff(command, { timing: null });
        scope.assert.deepEqual(diff.changes, []);
        scope.assert.equal(diff.result.status, 'passed');
        return scope.assert.collect();
    }),
    test('rejects conflicting references from matching adapters', async function (scope: TestScope) {
        const conflicting = await baselineCommand(scope, [ 'first', 'second' ]);
        await saveReference(scope, conflicting);
        await replaceSavedReference(scope, conflicting);
        const result = await orchestrator.bench.run(conflicting, { timing: null });
        scope.assert.equal(result.status, 'failed');
        scope.assert.true(result.runnerErrors.some(function incompatibleReference(error) {
            return error.subtype === 'measurement' && error.message.includes('disagree');
        }));
        scope.assert.equal(result.perTest[0]?.benchmark?.normalization?.comparability.kind, 'non-comparable');
        return scope.assert.collect();
    }),
    test('previews stale references and removes them only on full apply', async function (scope: TestScope) {
        const command = await normalizationCommand(scope, 'reuse', 'normalized metric');
        const capture = await orchestrator.bench.calibrate(command, { timing: null });
        scope.assert.equal(capture.result.status, 'passed');
        const raw = rawCommand(command);
        const ordinary = await orchestrator.bench.run(raw, { timing: null });
        scope.assert.equal(ordinary.status, 'failed');
        await assertStaleDiffAndApply(scope, raw);
        return scope.assert.collect();
    })
]);
