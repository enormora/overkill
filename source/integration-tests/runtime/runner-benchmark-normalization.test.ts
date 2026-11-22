import { isDeepStrictEqual } from 'node:util';
import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';
import { table, type TestScope, suite, test } from '@overkill-dev/test';
import type { CalibrationReferenceStore } from '../../baselines/calibration-store.ts';
import {
    type ResolvedRun,
    orchestrator,
    parseRunnerResult,
    type RunCommand
} from '../../packages/run/run.entry-point.ts';

import type { RunResult } from '../../engine/run-result.ts';
import { normalizationCommand, normalizationReferences } from '../../test-support/benchmark-normalization-fixture.ts';

import { createBenchmarkHtmlReport } from '../../reporters/benchmark-html-model.ts';
import type { BenchmarkNormalizationEvidence } from '../../packages/bench/bench.entry-point.ts';

const chartScalesChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    result: RunResult
): CompositeAssertionReturn<'assert'> {
    const initialChecks = check.true(
        isDeepStrictEqual(parseRunnerResult(result).perTest[0]?.benchmark, result.perTest[0]?.benchmark)
    );
    const { groups } = createBenchmarkHtmlReport({
        result,
        context: {
            id: null,
            startedAt: null,
            facts: null
        }
    })
        .charts;
    return check.group([
        initialChecks,
        check.equal(groups.length, 2),
        check.true(groups.some(function rawGroup(group) {
            return group.name.includes('raw)');
        })),
        check.true(groups.some(function normalizedGroup(group) {
            return group.name.includes('normalized /');
        }))
    ]);
};

const assertNormalizedResult = defineCompositeAssertion({
    name: 'normalized result',
    assert(check, result: RunResult) {
        const measured = result.perTest[0]?.benchmark;
        if (measured === undefined || measured === null) {
            return check.group([ check.defined(measured), check.notNull(measured) ]);
        }
        return check.group([
            check.partialDeepEqual(measured, {
                metrics: { value: { median: 100 } },
                normalization: { metrics: { value: { summary: { median: 50 } } } }
            }),
            check.equal(measured.budgets[0]?.estimate, 0.5),
            chartScalesChecks(check.annotated('chart scales'), result)
        ]);
    }
});
const assertAutomaticResult = defineCompositeAssertion({
    name: 'automatic result',
    assert(check, result: RunResult) {
        const measured = result.perTest[0]?.benchmark;
        if (measured === undefined || measured === null) {
            return check.group([ check.defined(measured), check.notNull(measured) ]);
        }
        return check.group([
            check.equal(result.status, 'passed'),
            check.deepEqual(result.runnerErrors, []),
            check.equal(measured.budgets[0]?.estimate, 0.5),
            check.partialDeepEqual(measured.normalization ?? {}, { metrics: { value: { source: 'canonical' } } })
        ]);
    }
});
const captureFixedReference = defineCompositeAssertion({
    name: 'capture fixed reference',
    async assert(check, command: RunCommand) {
        const store = await normalizationReferences(command);
        const capture = await orchestrator.bench.calibrate(command, { timing: null });
        const initialChecks = check.group([
            check.deepEqual(capture.result.runnerErrors, []),
            check.equal(capture.result.status, 'passed')
        ]);
        const [ reference ] = await store.list();
        if (reference === undefined) {
            return check.group([ initialChecks, check.defined(reference) ]);
        }

        await store.write('bench', [ {
            ...reference.snapshot,
            samples: reference.snapshot.samples.map(function fasterReference() {
                return 100;
            })
        } ], function owners() {
            return reference.owners;
        });
        return check.group([ initialChecks ]);
    }
});
const normalizedBenchmark = defineCompositeAssertion({
    name: 'normalized benchmark',
    assert(check, result: RunResult) {
        return check.group([ check.deepEqual(result.runnerErrors, []), check.equal(result.status, 'passed') ]);
    }
});
function retainedNormalization(result: RunResult): BenchmarkNormalizationEvidence {
    const normalization = result.perTest[0]?.benchmark?.normalization;
    if (normalization === undefined || normalization === null) {
        throw new Error('Expected normalization to satisfy defined.');
    }
    return normalization;
}
const captureScalesChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    canonical: RunResult,
    captured: RunResult
): CompositeAssertionReturn<'assert'> {
    const before = retainedNormalization(canonical);
    const after = retainedNormalization(captured);
    return check.group([
        check.equal(before.metrics.value?.summary?.median, 0.5),
        check.equal(after.metrics.value?.summary?.median, 50)
    ]);
};

const assertCaptureInvariant = defineCompositeAssertion({
    name: 'capture invariant',
    assert(check, canonical: RunResult, captured: RunResult) {
        const before = canonical.perTest[0];
        const after = captured.perTest[0];
        if (before === undefined || after === undefined) {
            return check.group([ check.defined(before), check.defined(after) ]);
        }
        const beforeBenchmark = before.benchmark;
        const afterBenchmark = after.benchmark;
        if (beforeBenchmark === null || afterBenchmark === null) {
            return check.group([ check.notNull(beforeBenchmark), check.notNull(afterBenchmark) ]);
        }
        return check.group([
            check.deepEqual(after.workId, before.workId),
            check.deepEqual(afterBenchmark.budgets, beforeBenchmark.budgets),
            captureScalesChecks(check.annotated('capture scales'), canonical, captured)
        ]);
    }
});
type DiscoveredNormalizationReferencesEvidence = {
    readonly listed: ResolvedRun;
    readonly store: CalibrationReferenceStore;
};

const discoveredNormalizationReferences = defineCompositeAssertion({
    name: 'discovered normalization references',
    async assert(
        check,
        { listed, store }: DiscoveredNormalizationReferencesEvidence
    ) {
        return check.group([
            check.equal(listed.facts.benchmarkNormalization, null),
            check.deepEqual(await store.list(), [])
        ]);
    }
});

export const testNode = suite('benchmark normalization process boundaries', [
    test(
        'display captures preserve logical identity and canonical budget decisions',
        async function (scope) {
            const command = await normalizationCommand(scope.cleanup, 'reuse', 'normalized metric');
            const canonical = await orchestrator.bench.run(command, { timing: null });
            scope.assert(normalizedBenchmark, canonical);
            await scope.assert(captureFixedReference, command);
            const captured = await orchestrator.bench.run(command, { timing: null });
            scope.assert(normalizedBenchmark, captured);
            scope.assert(assertCaptureInvariant, canonical, captured);
            return scope.assert.collect();
        }
    ),
    table({
        title: 'captures and normalizes across execution boundaries',
        cases: [ 'supervised-process', 'reuse', 'fresh-worker-per-unit' ] as const,
        caseTitle(boundary) {
            return boundary;
        },
        async test(scope) {
            const boundary = scope.parameters;

            const command = await normalizationCommand(scope.cleanup, boundary, 'normalized metric');
            const store = await normalizationReferences(command);
            const listed = await orchestrator.bench.list(command, { timing: null });
            await scope.assert(discoveredNormalizationReferences, { listed, store });
            await scope.assert(captureFixedReference, command);
            const result = await orchestrator.bench.run(command, { timing: null });
            scope.assert(normalizedBenchmark, result);
            scope.assert(assertNormalizedResult, result);
            return scope.assert.collect();
        }
    }),
    test(
        'captures without acquiring unrelated fixtures or running benchmark bodies',
        async function (scope) {
            const command = await normalizationCommand(scope.cleanup, 'reuse', 'capture skips benchmark fixtures');
            const result = await orchestrator.bench.calibrate(command, { timing: null });
            scope.assert(
                defineCompositeAssertion({
                    name: 'captures without acquiring unrelated fixtures or running benchmark bodies',
                    assert(check) {
                        return check.group([
                            check.deepEqual(result.result.runnerErrors, []),
                            check.equal(result.result.status, 'passed')
                        ]);
                    }
                })
            );
            const store = await normalizationReferences(command);
            const references = await store.list();
            scope.assert.equal(references.length, 1);
            return scope.assert.collect();
        }
    ),
    test('keeps constructor metrics raw without a scaling rule', async function (scope: TestScope) {
        const command = await normalizationCommand(scope.cleanup, 'reuse', 'mixed normalized and raw metrics');
        await scope.assert(captureFixedReference, command);
        const result = await orchestrator.bench.run(command, { timing: null });
        scope.assert(normalizedBenchmark, result);
        const measured = result.perTest[0]?.benchmark;
        scope.require.defined(measured);
        scope.assert(
            defineCompositeAssertion({
                name: 'keeps constructor metrics raw without a scaling rule',
                assert(check) {
                    return check.group([
                        check.deepEqual(
                            measured
                                .budgets
                                .map(function estimate(budget) {
                                    return budget.estimate;
                                }),
                            [ 0.5, 100 ]
                        ),
                        check.equal(
                            createBenchmarkHtmlReport({
                                result,
                                context: {
                                    id: null,
                                    startedAt: null,
                                    facts: null
                                }
                            })
                                .charts
                                .groups
                                .length,
                            3
                        )
                    ]);
                }
            })
        );
        return scope.assert.collect();
    }),
    test('normalizes automatically without captured references', async function (scope) {
        const command = await normalizationCommand(scope.cleanup, 'supervised-process', 'normalized metric');
        const result = await orchestrator.bench.run(command, { timing: null });
        scope.assert(assertAutomaticResult, result);
        const store = await normalizationReferences(command);
        scope.assert.deepEqual(await store.list(), []);
        return scope.assert.collect();
    })
]);
