import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder, defineCompositeAssertion } from '@overkill-dev/test/assert';
import { isDeepStrictEqual } from 'node:util';
import { table, type TestScope, suite, test } from '@overkill-dev/test';

import type { RunResult } from '../../engine/run-result.ts';
import { normalizationCommand, normalizationReferences } from '../../test-support/benchmark-normalization-fixture.ts';
import { orchestrator, parseRunnerResult, type RunCommand } from '../../packages/run/run.entry-point.ts';
import { createBenchmarkHtmlReport } from '../../reporters/benchmark-html-model.ts';
import type { BenchmarkNormalizationEvidence } from '../../packages/bench/bench.entry-point.ts';

const chartScalesChecks = (
    check: CompositeCheckBuilder<'assert'>,
    result: RunResult
): CompositeAssertionReturn<'assert'> => {
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
            return check.defined(measured);
        }
        const initialChecks = check.group([
            check.defined(measured),
            check.equal(measured.metrics.value?.median, 100)
        ]);
        const { normalization } = measured;
        if (normalization === undefined || normalization === null) {
            return check.group([ initialChecks, check.defined(normalization) ]);
        }
        const intermediateChecks = check.defined(normalization);
        const metric = normalization.metrics.value;
        if (metric === undefined || metric === null) {
            return check.group([ initialChecks, intermediateChecks, check.defined(metric) ]);
        }
        return check.group([
            initialChecks,
            intermediateChecks,
            check.defined(metric),
            check.equal(metric.summary?.median, 50),
            check.equal(measured.budgets[0]?.estimate, 0.5),
            chartScalesChecks(check.annotated('chart scales'), result)
        ]);
    }
});
const assertAutomaticResult = defineCompositeAssertion({
    name: 'automatic result',
    assert(check, result: RunResult) {
        const initialChecks = check.group([
            check.equal(result.status, 'passed'),
            check.deepEqual(result.runnerErrors, [])
        ]);
        const measured = result.perTest[0]?.benchmark;
        if (measured === undefined || measured === null) {
            return check.group([ initialChecks, check.defined(measured) ]);
        }
        const intermediateChecks = check.defined(measured);
        const { normalization } = measured;
        if (normalization === undefined || normalization === null) {
            return check.group([ initialChecks, intermediateChecks, check.defined(normalization) ]);
        }
        return check.group([
            initialChecks,
            intermediateChecks,
            check.defined(normalization),
            check.equal(measured.budgets[0]?.estimate, 0.5),
            check.equal(normalization.metrics.value?.source, 'canonical')
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
        if (reference === undefined || reference === null) {
            return check.group([ initialChecks, check.defined(reference) ]);
        }
        const intermediateChecks = check.defined(reference);
        await store.write('bench', [ {
            ...reference.snapshot,
            samples: reference.snapshot.samples.map(function fasterReference() {
                return 100;
            })
        } ], function owners() {
            return reference.owners;
        });
        return check.group([ initialChecks, intermediateChecks ]);
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
const captureScalesChecks = (
    check: CompositeCheckBuilder<'assert'>,
    canonical: RunResult,
    captured: RunResult
): CompositeAssertionReturn<'assert'> => {
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
        if (before === undefined || before === null) {
            return check.defined(before);
        }
        const initialChecks = check.defined(before);
        if (after === undefined || after === null) {
            return check.group([ initialChecks, check.defined(after) ]);
        }
        const intermediateChecks = check.defined(after);
        if (before.benchmark === undefined || before.benchmark === null) {
            return check.group([ initialChecks, intermediateChecks, check.defined(before.benchmark) ]);
        }
        const laterChecks = check.defined(before.benchmark);
        if (after.benchmark === undefined || after.benchmark === null) {
            return check.group([ initialChecks, intermediateChecks, laterChecks, check.defined(after.benchmark) ]);
        }
        return check.group([
            initialChecks,
            intermediateChecks,
            laterChecks,
            check.defined(after.benchmark),
            check.deepEqual(after.workId, before.workId),
            check.deepEqual(after.benchmark.budgets, before.benchmark.budgets),
            captureScalesChecks(check.annotated('capture scales'), canonical, captured)
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
            scope.assert.equal(listed.facts.benchmarkNormalization, null);
            scope.assert.deepEqual(await store.list(), []);
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
            scope.assert.deepEqual(result.result.runnerErrors, []);
            scope.assert.equal(result.result.status, 'passed');
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
        scope.assert.deepEqual(
            measured.budgets.map(function estimate(budget) {
                return budget.estimate;
            }),
            [ 0.5, 100 ]
        );
        scope.assert.equal(
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
