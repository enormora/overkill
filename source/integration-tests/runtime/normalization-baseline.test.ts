import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
    type CompositeCheckBuilder,
    type CompositeAssertionReturn,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';
import {
    type CalibrationReferenceReport,
    readCalibrationReferenceReport
} from '../../packages/bench/bench.entry-point.ts';
import { type RunReporterDeliveryResult, orchestrator, type RunCommand } from '../../packages/run/run.entry-point.ts';

import type { StoredCalibration } from '../../baselines/calibration-reference.ts';

import type { RunResult } from '../../engine/run-result.ts';

import {
    normalizationCommand,
    normalizationReferences,
    withBaselineAdapters,
    baselineCommand,
    replaceSavedCalibration
} from '../../test-support/benchmark-normalization-fixture.ts';

const saveReference = defineCompositeAssertion({
    name: 'save reference',
    async assert(check, command: RunCommand) {
        const capture = await orchestrator.bench.calibrate(command, { timing: null });
        const initialChecks = check.equal(capture.result.status, 'passed');
        const store = await normalizationReferences(command);
        const [ reference ] = await store.list();
        if (reference === undefined) {
            return check.group([ initialChecks, check.defined(reference) ]);
        }

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
            check.equal(saved.result.status, 'passed'),
            check.equal(saved.writeOutcome.kind, 'written')
        ]);
    }
});
function baselineBudgetChecks(
    check: CompositeCheckBuilder<'assert'>,
    measured: NonNullable<RunResult['perTest'][number]['benchmark']>
): CompositeAssertionReturn<'assert'> {
    return check.group([
        check.equal(measured.normalization?.metrics.value?.budgets[0]?.maximum, 300),
        check.equal(measured.budgets[0]?.estimate, 0.5)
    ]);
}
const assertSavedReference = defineCompositeAssertion({
    name: 'saved reference',
    assert(check, result: RunResult) {
        const measured = result.perTest[0]?.benchmark;
        if (measured === undefined || measured === null) {
            return check.group([ check.defined(measured), check.notNull(measured) ]);
        }
        return check.group([
            check.partialDeepEqual(measured, {
                normalization: { metrics: { value: { source: 'baseline', summary: { median: 200 } } } }
            }),
            baselineBudgetChecks(check, measured)
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

type PartialPublicationFailureEvidence = {
    readonly capture: RunReporterDeliveryResult;
    readonly report: CalibrationReferenceReport;
    readonly completedPath: string;
};

const partialPublicationFailure = defineCompositeAssertion({
    name: 'partial publication failure',
    assert(
        check,
        { capture, report, completedPath }: PartialPublicationFailureEvidence
    ) {
        return check.group([
            check.equal(capture.result.status, 'failed'),
            check.deepEqual({ outcome: report.outcome, completed: report.completed }, {
                outcome: 'failed',
                completed: [ completedPath ]
            })
        ]);
    }
});

type BlockedReferencePublication = {
    readonly command: RunCommand;
    readonly initial: CapturedReferences['capture'];
    readonly completedPath: string;
};
async function blockedReferencePublication(cleanup: TestScope['cleanup']): Promise<BlockedReferencePublication> {
    const command = await normalizationCommand(cleanup, 'reuse', 'capture multiple references');
    const store = await normalizationReferences(command);
    const { references, capture } = await captureReferences(command);
    const first = references.find(function (reference) {
        return reference.snapshot.identity.workload.name === 'reference ticks';
    });
    const second = references.find(function (reference) {
        return reference.snapshot.identity.workload.name === 'second reference ticks';
    });
    if (first === undefined || second === undefined) {
        throw new Error('Expected both calibration references.');
    }
    await store.remove(references);
    await mkdir(join(command.cwd, store.pathOf(second)), { recursive: true });
    return { command, initial: capture, completedPath: store.pathOf(first) };
}
export const testNode = suite('saved normalization references', [
    test('reports completed references after a later publication failure', async function (scope: TestScope) {
        const { command, initial, completedPath } = await blockedReferencePublication(scope.cleanup);
        scope.assert(calibrationCapture, initial);
        const capture = await orchestrator.bench.calibrate(command, { timing: null });
        const report = readCalibrationReferenceReport(capture.result);
        scope.require.defined(report);
        scope.assert(partialPublicationFailure, { capture, report, completedPath });
        const written = await stat(join(command.cwd, completedPath));
        scope.assert.true(written.isFile());
        return scope.assert.collect();
    }),
    test('blocks capture when its reference report cannot fit the artifact limit', async function (scope) {
        const command = boundedCapture(await normalizationCommand(scope.cleanup, 'reuse', 'normalized metric'));
        const capture = await orchestrator.bench.calibrate(command, { timing: null });
        const store = await normalizationReferences(command);
        await scope.assert(
            defineCompositeAssertion({
                name: 'blocks capture when its reference report cannot fit the artifact limit',
                async assert(check) {
                    return check.group([
                        check.equal(capture.result.status, 'failed'),
                        check.true(capture.result.runnerErrors.some(function (error) {
                            return error.subtype === 'artifact';
                        })),
                        check.deepEqual(await store.list(), [])
                    ]);
                }
            })
        );
        return scope.assert.collect();
    }),
    test('captures raw benchmarks without writing calibration references', async function (scope: TestScope) {
        const command = rawCommand(await normalizationCommand(scope.cleanup, 'reuse', 'normalized metric'));
        const capture = await orchestrator.bench.calibrate(command, { timing: null });
        const store = await normalizationReferences(command);
        scope.assert(
            defineCompositeAssertion({
                name: 'captures raw benchmarks without writing calibration references',
                assert(check) {
                    return check.group([
                        check.equal(capture.result.status, 'passed'),
                        check.equal(capture.result.perTest[0]?.benchmark?.samples, 0)
                    ]);
                }
            })
        );
        const report = readCalibrationReferenceReport(capture.result);
        scope.require.defined(report);
        await scope.assert(
            defineCompositeAssertion({
                name: 'captures raw benchmarks without writing calibration references',
                async assert(check) {
                    return check.group([
                        check.deepEqual(report, {
                            changes: [],
                            completed: [],
                            outcome: 'written'
                        }),
                        check.deepEqual(await store.list(), [])
                    ]);
                }
            })
        );
        return scope.assert.collect();
    }),
    test('deduplicates captures and excludes raw cases from calibration ownership', async function (scope: TestScope) {
        const command = completeCapture(await normalizationCommand(scope.cleanup, 'reuse', 'normalized metric'));
        const { references, capture: referencesCapture } = await captureReferences(command);
        scope.assert(calibrationCapture, referencesCapture);
        const first = references.find(function (reference) {
            return reference.snapshot.identity.workload.name === 'reference ticks';
        });
        scope.require.defined(first);
        scope.assert(
            defineCompositeAssertion({
                name: 'deduplicates captures and excludes raw cases from calibration ownership',
                assert(check) {
                    return check.group([
                        check.equal(references.length, 2),
                        check.deepEqual(
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
                        )
                    ]);
                }
            })
        );
        return scope.assert.collect();
    }),
    test('uses saved references while preserving the original budget basis', async function (scope) {
        const command = await baselineCommand(scope.cleanup, [ 'reference' ]);
        await scope.assert(saveReference, command);
        await replaceSavedCalibration(command, 'reference');
        const result = await orchestrator.bench.run(command, { timing: null });
        scope.assert(
            defineCompositeAssertion({
                name: 'uses saved references while preserving the original budget basis',
                assert(check) {
                    return check.group([
                        check.deepEqual(result.runnerErrors, []),
                        check.equal(result.status, 'passed')
                    ]);
                }
            })
        );
        scope.assert(assertSavedReference, result);
        return scope.assert.collect();
    }),
    test('keeps unchanged expectations stable across calibration reruns', async function (scope) {
        const command = await baselineCommand(scope.cleanup, [ 'reference' ]);
        await scope.assert(saveReference, command);
        const diff = await orchestrator.bench.baseline.diff(command, { timing: null });
        scope.assert(
            defineCompositeAssertion({
                name: 'keeps unchanged expectations stable across calibration reruns',
                assert(check) {
                    return check.group([
                        check.deepEqual(diff.changes, []),
                        check.equal(diff.result.status, 'passed')
                    ]);
                }
            })
        );
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
        scope.assert(
            defineCompositeAssertion({
                name: 'adds adapters without conflicting with earlier calibration samples',
                assert(check) {
                    return check.group([
                        check.deepEqual(result.runnerErrors, []),
                        check.equal(result.status, 'passed')
                    ]);
                }
            })
        );
        return scope.assert.collect();
    }),
    test('rejects conflicting references from matching adapters', async function (scope) {
        const conflicting = await baselineCommand(scope.cleanup, [ 'first', 'second' ]);
        await scope.assert(saveReference, conflicting);
        await replaceSavedCalibration(conflicting, 'reference');
        const result = await orchestrator.bench.run(conflicting, { timing: null });
        scope.assert(
            defineCompositeAssertion({
                name: 'rejects conflicting references from matching adapters',
                assert(check) {
                    return check.group([
                        check.equal(result.status, 'failed'),
                        check
                            .true(result
                                .runnerErrors
                                .some(function incompatibleReference(error) {
                                    return error.subtype === 'measurement' && error.message.includes('disagree');
                                })),
                        check.equal(result.perTest[0]?.benchmark?.normalization?.comparability.kind, 'non-comparable')
                    ]);
                }
            })
        );
        return scope.assert.collect();
    }),
    test('preserves references when applying a title-filtered inventory', async function (scope) {
        const command = await normalizationCommand(scope.cleanup, 'reuse', 'normalized metric');
        const { references, capture: referencesCapture } = await captureReferences(command);
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
        await scope.assert(
            defineCompositeAssertion({
                name: 'preserves references when applying a title-filtered inventory',
                async assert(check) {
                    return check.group([
                        check.equal(applied.result.status, 'passed'),
                        check.deepEqual(await store.list(), references)
                    ]);
                }
            })
        );
        return scope.assert.collect();
    }),
    test('preserves references when applying a path-limited inventory', async function (scope) {
        const command = await normalizationCommand(scope.cleanup, 'reuse', 'normalized metric');
        const { references, capture: referencesCapture } = await captureReferences(command);
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
        await scope.assert(
            defineCompositeAssertion({
                name: 'preserves references when applying a path-limited inventory',
                async assert(check) {
                    return check.group([
                        check.equal(applied.result.status, 'passed'),
                        check.deepEqual(await store.list(), references)
                    ]);
                }
            })
        );
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
