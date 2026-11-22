import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';
import { table, type TestScope, suite } from '@overkill-dev/test';

import { runWithAttachmentContext } from '../../../attachments/attachment-context.ts';
import {
    type RunResult,
    type PerTestResult,
    createRoot,
    createTestPlan,
    execute
} from '../../../packages/engine/engine.entry-point.ts';
import {
    benchmark,
    moduleMeasurement,
    rawMeasurement,
    timelineMeasurement,
    workload,
    defaultSamplingPolicy,
    defaultBenchmarkLifecyclePolicy,
    readBenchmarkTimeline,
    type ModuleImportRequest,
    type ModuleSample,
    type BenchmarkMeasureContext
} from '../../../packages/bench/bench.entry-point.ts';

const modes = [ 'success', 'missing', 'duplicate', 'caught-failure', 'cleanup-failure', 'budget-failure' ] as const;
type Mode = typeof modes[number];
type Context = BenchmarkMeasureContext<Readonly<Record<string, never>>, ModuleSample>;

async function moduleRequest(cleanup: TestScope['cleanup'], mode: Mode): Promise<ModuleImportRequest> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-strategy-'));
    cleanup(async function removeFixture() {
        await rm(directory, { recursive: true, force: true });
    });
    const filename = join(directory, 'entry.cjs');
    await writeFile(
        filename,
        mode === 'caught-failure'
            ? 'throw new Error("module evaluation failed");'
            : 'module.exports = () => { throw new Error("export invoked"); };'
    );
    return { url: pathToFileURL(filename), cwd: directory, env: null, nodeArguments: [] };
}

function registerCleanup(context: Context, record: (event: string) => void, mode: Mode): void {
    record('body');
    context.cleanup(function attemptCleanup() {
        record('attempt');
    });
    context.sample.cleanup(function firstCleanup() {
        record('first');
    });
    context.sample.cleanup(function secondCleanup() {
        record('second');
        if (mode === 'cleanup-failure') {
            throw new Error('sample reset failed');
        }
    });
}

async function importForMode(context: Context, request: ModuleImportRequest, mode: Mode): Promise<void> {
    if (mode !== 'missing') {
        try {
            await context.sample.importModule(request);
        } catch (error: unknown) {
            if (mode !== 'caught-failure') {
                throw error;
            }
        }
    }
    if (mode === 'duplicate') {
        await context.sample.importModule(request);
    }
}

async function runModule(
    request: ModuleImportRequest,
    record: (event: string) => void,
    mode: Mode
): Promise<RunResult> {
    const node = benchmark('module contract', {
        kind: 'startup',
        workloads: [ workload('one', {}) ],
        measurement: timelineMeasurement(rawMeasurement(moduleMeasurement()), { maximumEvents: 64 }),
        async measure(context) {
            registerCleanup(context, record, mode);
            await importForMode(context, request, mode);
            return { value: mode === 'budget-failure' ? 2 : 1, diagnostic: 999 };
        },
        diagnosticMetrics: [ 'diagnostic' ],
        budgets: { one: { value: { maximum: 1, statistic: { kind: 'observed-maximum' } } } }
    }, {
        annotations: {},
        controls: {},
        lifecycle: { ...defaultBenchmarkLifecyclePolicy, warmupSamples: 0 },
        sampling: { ...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2 }
    });
    return await runWithAttachmentContext(null, async function () {
        return await execute(createTestPlan(createRoot({
            title: 'strategy',
            annotations: {},
            controls: {},
            children: [ node ]
        })));
    });
}

function directModuleChecks(
    check: CompositeCheckBuilder<'assert'>,
    result: RunResult
): CompositeAssertionReturn<'assert'> {
    const tested = result.perTest[0];
    if (tested === undefined) {
        return check.defined(tested);
    }
    if (tested.benchmark === null) {
        return check.defined(tested.benchmark);
    }
    return check.group([
        check.partialDeepEqual(tested.benchmark, {
            samples: 2,
            normalization: null,
            rawSamples: { status: 'omitted' },
            timeline: { status: 'omitted' }
        }),
        check.equal(tested.benchmark.budgets.length, 1),
        check.defined(tested.benchmark.rawSamples.reason),
        check.equal(readBenchmarkTimeline(result, tested), null)
    ]);
}

const cleanupFailureChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    tested: PerTestResult
): CompositeAssertionReturn<'assert'> {
    if (tested.benchmark === null) {
        return check.defined(tested.benchmark);
    }
    if (tested.outcome === null) {
        return check.defined(tested.outcome);
    }
    return check.group([
        check.partialDeepEqual(tested.benchmark, { samples: 1, metrics: { value: { median: 1 } } }),
        check.partialDeepEqual(tested.outcome, {
            kind: 'fail',
            failures: [ { kind: 'cleanup-error', error: { message: 'sample reset failed' } } ]
        })
    ]);
};

const assertInterrupted = defineCompositeAssertion({
    name: 'interrupted',
    assert(check, result: RunResult, lifecycle: readonly string[], mode: Mode) {
        const tested = result.perTest[0];
        if (tested === undefined) {
            return check.defined(tested);
        }
        const initialChecks = check.group([
            check.defined(tested),
            check.equal(result.status, 'failed'),
            check.equal(tested.benchmark?.status, 'incomplete'),
            check.deepEqual(lifecycle, [ 'body', 'second', 'first', 'attempt' ])
        ]);
        return mode === 'cleanup-failure'
            ? check.group([ initialChecks, cleanupFailureChecks(check.annotated('cleanup failure'), tested) ])
            : check.group([ initialChecks, check.equal(tested.outcome?.kind, 'inconclusive') ]);
    }
});

const completionExpectations = {
    success: { status: 'passed', decision: 'pass' },
    'budget-failure': { status: 'failed', decision: 'fail' }
} as const;
const completedModuleEvidence = defineCompositeAssertion({
    name: 'completed module measurements retain lifecycle and budget decisions',
    assert(check, result: RunResult, lifecycle: readonly string[], mode: keyof typeof completionExpectations) {
        const tested = result.perTest[0];
        if (tested === undefined) {
            return check.defined(tested);
        }
        const expected = completionExpectations[mode];
        const failures = mode === 'budget-failure'
            ? [ check.partialDeepEqual(tested.outcome ?? {}, { kind: 'fail', failures: [ { kind: 'assertion' } ] }) ]
            : [];
        return check.group([
            check.equal(result.status, expected.status),
            check.deepEqual(result.runnerErrors, []),
            directModuleChecks(check, result),
            check.equal(tested.benchmark?.budgets[0]?.decision, expected.decision),
            check.deepEqual(lifecycle, [ 'body', 'second', 'first', 'body', 'second', 'first', 'attempt', 'attempt' ]),
            ...failures
        ]);
    }
});

export const testNode = suite(
    'public module strategy contracts',
    [ table({
        title: 'preserves lifecycle and budget outcomes',
        cases: modes,
        caseTitle(mode) {
            return mode;
        },
        async test(scope) {
            const mode = scope.parameters;

            const request = await moduleRequest(scope.cleanup, mode);
            const lifecycle: string[] = [];
            const result = await runModule(request, function recordLifecycle(event) {
                lifecycle.push(event);
            }, mode);
            if (mode === 'success' || mode === 'budget-failure') {
                scope.assert(completedModuleEvidence, result, lifecycle, mode);
            } else {
                scope.assert(assertInterrupted, result, lifecycle, mode);
            }
            return scope.assert.collect();
        }
    }) ]
);
