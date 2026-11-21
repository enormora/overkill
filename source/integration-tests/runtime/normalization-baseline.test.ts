import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { type TestScope, suite, test } from '@overkill-dev/test';

import type { StoredCalibration } from '../../baselines/calibration-reference.ts';
import { readCalibrationReferenceReport } from '../../packages/bench/bench.entry-point.ts';
import type { RunResult } from '../../engine/run-result.ts';
import { orchestrator, type RunCommand } from '../../packages/run/run.entry-point.ts';
import { createPerformanceBaselineStore, type PerformanceBaselineStore } from '../../baselines/performance-store.ts';
import { normalizationCommand, normalizationReferences } from '../../test-support/benchmark-normalization-fixture.ts';
import { normalizationBaselineAdapter } from '../../test-support/normalization-baseline-adapter.ts';

function withBaselineAdapters(command: RunCommand, adapters: readonly string[]): RunCommand {
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
async function baselineCommand(cleanup: TestScope['cleanup'], adapters: readonly string[]): Promise<RunCommand> {
    return withBaselineAdapters(await normalizationCommand(cleanup, 'reuse', 'normalized metric'), adapters);
}
const saveReference = defineCompositeAssertion({
    name: 'save reference',
    async assert(check, command: RunCommand) {
        const capture = await orchestrator.bench.calibrate(command, { timing: null });
        const initialChecks = check.equal(capture.result.status, 'passed');
        const store = await normalizationReferences(command);
        const [ reference ] = await store.list();
        if (reference === undefined || reference === null) {
            return check.group([ initialChecks, check.defined(reference) ]);
        }
        const intermediateChecks = check.defined(reference);
        await store.write('bench', [ {
            ...reference.snapshot,
            samples: reference.snapshot.samples.map(function fixedSample() {
                return 100;
            })
        } ], function owners() {
            return reference.owners;
        });
        const saved = await orchestrator.bench.baseline.update(command, { timing: null });
        return check.group([
            initialChecks,
            intermediateChecks,
            check.equal(saved.result.status, 'passed'),
            check.equal(saved.writeOutcome.kind, 'written')
        ]);
    }
});
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
async function replaceSavedCalibration(
    command: RunCommand,
    component: 'actual' | 'reference'
): Promise<void> {
    const store = await performanceStore(command);
    const [ entry ] = await store.list();
    if (entry === undefined || entry === null) {
        throw new Error('Expected entry to satisfy defined.');
    }
    const { baseline } = entry;
    if (baseline.normalization === null) {
        throw new Error('Expected normalized baseline.');
    }
    const metric = baseline.normalization.metrics.value;
    if (metric === undefined || metric === null) {
        throw new Error('Expected metric to satisfy defined.');
    }
    const normalization = {
        ...baseline.normalization,
        metrics: {
            ...baseline.normalization.metrics,
            value: {
                ...metric,
                [component]: {
                    ...metric[component],
                    samples: metric[component]
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
const assertSavedReference = defineCompositeAssertion({
    name: 'saved reference',
    assert(check, result: RunResult) {
        const measured = result.perTest[0]?.benchmark;
        if (measured === undefined || measured === null) {
            return check.defined(measured);
        }
        const { normalization } = measured;
        if (normalization === undefined || normalization === null) {
            return check.defined(normalization);
        }
        const metric = normalization.metrics.value;
        if (metric === undefined || metric === null) {
            return check.defined(metric);
        }
        return check.group([
            check.equal(metric.source, 'baseline'),
            check.equal(metric.summary?.median, 200),
            check.equal(metric.budgets[0]?.maximum, 300),
            check.equal(measured.budgets[0]?.estimate, 0.5)
        ]);
    }
});
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
                        include: [ 'source/integration-tests/runtime/fixtures/normalization-raw.bench.test.ts' ]
                    }
                }
            }
        }
    };
}
const assertStaleDiffAndApply = defineCompositeAssertion({
    name: 'stale diff and apply',
    async assert(check, raw: RunCommand) {
        const store = await normalizationReferences(raw);
        const diff = await orchestrator.bench.baseline.diff(raw, { timing: null });
        const initialChecks = check.deepEqual(
            diff.calibrationChanges.map(function kind(change) {
                return change.kind;
            }),
            [ 'remove' ]
        );
        const references = await store.list();
        const intermediateChecks = check.equal(references.length, 1);
        const applied = await orchestrator.bench.baseline.apply(raw, { timing: null });
        return check.group([
            initialChecks,
            intermediateChecks,
            check.equal(
                applied
                    .result
                    .status,
                'passed'
            ),
            check.deepEqual(await store.list(), [])
        ]);
    }
});
function boundedCapture(command: RunCommand): RunCommand {
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
                bench: { ...profile, attachments: { ...profile.attachments, maxArtifactBytes: 1 } }
            }
        }
    };
}
function completeCapture(command: RunCommand): RunCommand {
    const profile = command.config.profiles.bench;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Expected benchmark profile.');
    }
    return {
        ...command,
        request: { ...command.request, selection: { kind: 'all' } },
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
                        include: [
                            'source/integration-tests/runtime/fixtures/normalization.bench.test.ts',
                            'source/integration-tests/runtime/fixtures/normalization-raw.bench.test.ts'
                        ]
                    }
                }
            }
        }
    };
}
type CapturedReferences = {
    readonly capture: Awaited<ReturnType<typeof orchestrator.bench.calibrate>>;
    readonly references: readonly StoredCalibration[];
};
async function captureReferences(command: RunCommand): Promise<CapturedReferences> {
    const capture = await orchestrator.bench.calibrate(command, { timing: null });
    const store = await normalizationReferences(command);
    return { capture, references: await store.list() };
}
const calibrationCapture = defineCompositeAssertion({
    name: 'calibration capture',
    assert(check, capture: CapturedReferences['capture']) {
        return check.group([
            check.deepEqual(capture.result.runnerErrors, []),
            check.equal(capture.result.status, 'passed')
        ]);
    }
});

export const testNode = suite('saved normalization references', [
    test('reports completed references after a later publication failure', async function (scope: TestScope) {
        const command = await normalizationCommand(scope.cleanup, 'reuse', 'capture multiple references');

        const preparePartialCaptureFailureStore = await normalizationReferences(command);
        const {
            references: preparePartialCaptureFailureReferences,
            capture: preparePartialCaptureFailureReferencesCapture
        } = await captureReferences(command);
        scope.assert(calibrationCapture, preparePartialCaptureFailureReferencesCapture);
        const preparePartialCaptureFailureFirst = preparePartialCaptureFailureReferences.find(function (reference) {
            return reference.snapshot.identity.workload.name === 'reference ticks';
        });
        const preparePartialCaptureFailureSecond = preparePartialCaptureFailureReferences.find(function (reference) {
            return reference.snapshot.identity.workload.name === 'second reference ticks';
        });
        scope.require.defined(preparePartialCaptureFailureFirst);
        scope.require.defined(preparePartialCaptureFailureSecond);
        await preparePartialCaptureFailureStore.remove(preparePartialCaptureFailureReferences);
        await mkdir(join(command.cwd, preparePartialCaptureFailureStore.pathOf(preparePartialCaptureFailureSecond)), {
            recursive: true
        });
        const completedPath = preparePartialCaptureFailureStore.pathOf(preparePartialCaptureFailureFirst);

        const capture = await orchestrator.bench.calibrate(command, { timing: null });
        const report = readCalibrationReferenceReport(capture.result);
        scope.require.defined(report);
        scope.assert.equal(capture.result.status, 'failed');
        scope.assert.deepEqual({ outcome: report.outcome, completed: report.completed }, {
            outcome: 'failed',
            completed: [ completedPath ]
        });
        const written = await stat(join(command.cwd, completedPath));
        scope.assert.true(written.isFile());
        return scope.assert.collect();
    }),
    test('blocks capture when its reference report cannot fit the artifact limit', async function (scope) {
        const command = boundedCapture(await normalizationCommand(scope.cleanup, 'reuse', 'normalized metric'));
        const capture = await orchestrator.bench.calibrate(command, { timing: null });
        const store = await normalizationReferences(command);
        scope.assert.equal(capture.result.status, 'failed');
        scope.assert.true(capture.result.runnerErrors.some(function (error) {
            return error.subtype === 'artifact';
        }));
        scope.assert.deepEqual(await store.list(), []);
        return scope.assert.collect();
    }),
    test('captures raw benchmarks without writing calibration references', async function (scope: TestScope) {
        const command = rawCommand(await normalizationCommand(scope.cleanup, 'reuse', 'normalized metric'));
        const capture = await orchestrator.bench.calibrate(command, { timing: null });
        const store = await normalizationReferences(command);
        scope.assert.equal(capture.result.status, 'passed');
        scope.assert.equal(capture.result.perTest[0]?.benchmark?.samples, 0);
        const report = readCalibrationReferenceReport(capture.result);
        scope.require.defined(report);
        scope.assert.deepEqual(report, {
            changes: [],
            completed: [],
            outcome: 'written'
        });
        scope.assert.deepEqual(await store.list(), []);
        return scope.assert.collect();
    }),
    test('deduplicates captures and excludes raw cases from calibration ownership', async function (scope: TestScope) {
        const command = completeCapture(await normalizationCommand(scope.cleanup, 'reuse', 'normalized metric'));
        const { references: references, capture: referencesCapture } = await captureReferences(command);
        scope.assert(calibrationCapture, referencesCapture);
        const first = references.find(function (reference) {
            return reference.snapshot.identity.workload.name === 'reference ticks';
        });
        scope.require.defined(first);
        scope.assert.equal(references.length, 2);
        scope.assert.deepEqual(
            first
                .owners
                .map(function (owner) {
                    return owner.case.title;
                })
                .toSorted(function alphabetical(left, right) {
                    return left.localeCompare(right);
                }),
            [
                'capture multiple references',
                'capture skips benchmark fixtures',
                'mixed normalized and raw metrics',
                'normalized metric'
            ]
        );
        return scope.assert.collect();
    }),
    test('uses saved references while preserving the original budget basis', async function (scope) {
        const command = await baselineCommand(scope.cleanup, [ 'reference' ]);
        await scope.assert(saveReference, command);
        await replaceSavedCalibration(command, 'reference');
        const result = await orchestrator.bench.run(command, { timing: null });
        scope.assert.deepEqual(result.runnerErrors, []);
        scope.assert.equal(result.status, 'passed');
        scope.assert(assertSavedReference, result);
        return scope.assert.collect();
    }),
    test('keeps unchanged expectations stable across calibration reruns', async function (scope) {
        const command = await baselineCommand(scope.cleanup, [ 'reference' ]);
        await scope.assert(saveReference, command);
        const diff = await orchestrator.bench.baseline.diff(command, { timing: null });
        scope.assert.deepEqual(diff.changes, []);
        scope.assert.equal(diff.result.status, 'passed');
        return scope.assert.collect();
    }),
    test('adds adapters without conflicting with earlier calibration samples', async function (scope) {
        const command = await baselineCommand(scope.cleanup, [ 'first' ]);
        await scope.assert(saveReference, command);
        await replaceSavedCalibration(command, 'actual');
        const expanded = withBaselineAdapters(command, [ 'first', 'second' ]);
        const updated = await orchestrator.bench.baseline.update(expanded, { timing: null });
        scope.assert.equal(updated.result.status, 'passed');
        const result = await orchestrator.bench.run(expanded, { timing: null });
        scope.assert.deepEqual(result.runnerErrors, []);
        scope.assert.equal(result.status, 'passed');
        return scope.assert.collect();
    }),
    test('rejects conflicting references from matching adapters', async function (scope) {
        const conflicting = await baselineCommand(scope.cleanup, [ 'first', 'second' ]);
        await scope.assert(saveReference, conflicting);
        await replaceSavedCalibration(conflicting, 'reference');
        const result = await orchestrator.bench.run(conflicting, { timing: null });
        scope.assert.equal(result.status, 'failed');
        scope.assert.true(result.runnerErrors.some(function incompatibleReference(error) {
            return error.subtype === 'measurement' && error.message.includes('disagree');
        }));
        scope.assert.equal(result.perTest[0]?.benchmark?.normalization?.comparability.kind, 'non-comparable');
        return scope.assert.collect();
    }),
    test('preserves references when applying a title-filtered inventory', async function (scope) {
        const command = await normalizationCommand(scope.cleanup, 'reuse', 'normalized metric');
        const { references: references, capture: referencesCapture } = await captureReferences(command);
        scope.assert(calibrationCapture, referencesCapture);
        const raw = rawCommand(command);
        const filtered = {
            ...raw,
            request: {
                ...raw.request,
                selection: {
                    kind: 'filter' as const,
                    filter: { kind: 'equals' as const, field: 'title' as const, value: 'raw metric' }
                }
            }
        };
        const applied = await orchestrator.bench.baseline.apply(filtered, { timing: null });
        const store = await normalizationReferences(command);
        scope.assert.equal(applied.result.status, 'passed');
        scope.assert.deepEqual(await store.list(), references);
        return scope.assert.collect();
    }),
    test('preserves references when applying a path-limited inventory', async function (scope) {
        const command = await normalizationCommand(scope.cleanup, 'reuse', 'normalized metric');
        const { references: references, capture: referencesCapture } = await captureReferences(command);
        scope.assert(calibrationCapture, referencesCapture);
        const raw = rawCommand(command);
        const partial = {
            ...raw,
            request: {
                ...raw.request,
                paths: [ 'source/integration-tests/runtime/fixtures/normalization-raw.bench.test.ts' ]
            }
        };
        const applied = await orchestrator.bench.baseline.apply(partial, { timing: null });
        const store = await normalizationReferences(command);
        scope.assert.equal(applied.result.status, 'passed');
        scope.assert.deepEqual(await store.list(), references);
        return scope.assert.collect();
    }),
    test('previews stale references and removes them only on full apply', async function (scope) {
        const command = await normalizationCommand(scope.cleanup, 'reuse', 'normalized metric');
        const capture = await orchestrator.bench.calibrate(command, { timing: null });
        scope.assert.equal(capture.result.status, 'passed');
        const raw = rawCommand(command);
        const ordinary = await orchestrator.bench.run(raw, { timing: null });
        scope.assert.equal(ordinary.status, 'failed');
        await scope.assert(assertStaleDiffAndApply, raw);
        return scope.assert.collect();
    })
]);
