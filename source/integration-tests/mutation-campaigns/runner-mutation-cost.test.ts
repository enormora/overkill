import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { table, type TestScope, suite } from '@overkill-dev/test';
import {
    defineCompositeAssertion,
    type CompositeAssertionReturn,
    type CompositeCheckBuilder
} from '@overkill-dev/test/assert';

import { normalizeConfig, orchestrator, type PerTestResult } from '../../packages/run/run.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { mutationModes, type MutationMode } from '../runtime/fixtures/mutation-evidence/mutation-project.test.ts';

const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const benchmarkUrl = new URL(
    `../runtime/fixtures/mutation-evidence/mutation-cost.bench.test.${extension}`,
    import.meta.url
);

async function costFixture(
    cleanup: TestScope['cleanup'],
    mode: MutationMode
): Promise<{ readonly file: string; readonly directory: string; }> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp('target/mutation-cost-smoke-');
    cleanup(async function removeFixture() {
        await rm(directory, { recursive: true, force: true });
    });
    const file = join(directory, 'cost.bench.mjs');
    await writeFile(
        file,
        `
import { createMutationCostSuite } from ${JSON.stringify(benchmarkUrl.href)};
export const testNode = createMutationCostSuite(2, false, [${JSON.stringify(mode)}]);
`
    );
    return { file, directory };
}

type CostMetrics = NonNullable<PerTestResult['benchmark']>['metrics'];

function costMetricChecks(
    check: CompositeCheckBuilder<'assert'>,
    reading: CostMetrics[string] | undefined
): CompositeAssertionReturn<'assert'> {
    if (reading === undefined) {
        return check.defined(reading);
    }
    return check.group([
        check.equal(reading.count, 2),
        check.true(reading.minimum !== null && reading.minimum >= 0)
    ]);
}

function hostBootstrapChecks(
    check: CompositeCheckBuilder<'assert'>,
    metrics: CostMetrics,
    mode: MutationMode
): CompositeAssertionReturn<'assert'> {
    const reading: CostMetrics[string] | undefined = metrics.freshHostEntryToLifecycleMicroseconds;
    if (reading === undefined) {
        return check.defined(reading);
    }
    return check.group([
        check.equal(reading.count, mode.freshState || mode.processModel === 'supervised-process' ? 2 : 0)
    ]);
}

const executionSessionPhases = [
    'initialPlanReadyMicroseconds',
    'subsequentPlanReadyMicroseconds',
    'initialExecutionMicroseconds',
    'subsequentExecutionMicroseconds',
    'initialInvocationMicroseconds',
    'subsequentInvocationMicroseconds',
    'disposalMicroseconds'
];
const mutationCostEvidence = defineCompositeAssertion({
    name: 'mutation measurements retain every cost phase and bootstrap sample',
    assert(check, result: Awaited<ReturnType<typeof orchestrator.bench.run>>, mode: MutationMode) {
        return check.group([
            check.deepEqual(result.runnerErrors, []),
            check.equal(result.summary.passed, 3),
            ...result.perTest.map(function measuredCosts(entry) {
                const { benchmark } = entry;
                if (benchmark === null) {
                    return check.defined(benchmark);
                }
                const session = entry.id.title.includes('execution-session');
                const phases = session ? executionSessionPhases : [ 'campaignMicroseconds' ];
                const bootstrap = session ? [ hostBootstrapChecks(check, benchmark.metrics, mode) ] : [];
                return check.group([
                    check.partialDeepEqual(benchmark, {
                        status: 'complete',
                        samples: 2,
                        lifecycle: { warmup: { samples: 0 } }
                    }),
                    ...[ 'durationMicroseconds', 'driverStartupMilliseconds', ...phases ].map(function costPhase(name) {
                        return costMetricChecks(check, benchmark.metrics[name]);
                    }),
                    ...bootstrap
                ]);
            })
        ]);
    }
});

export const testNode = suite(
    'mutation cost measurement completeness',
    [ table({
        title: 'records mutation work and duration across execution boundaries',
        cases: mutationModes,
        caseTitle(mode) {
            return `${mode.processModel} freshState ${String(mode.freshState)}`;
        },
        async test(
            { cleanup, assert: assertContext, parameters: mode }
        ) {
            const { file, directory } = await costFixture(cleanup, mode);
            const config = normalizeConfig({
                profiles: {
                    costs: {
                        testFamily: 'benchmark',
                        files: { include: [ file ] },
                        timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 55_000, hardMilliseconds: 60_000 }
                    }
                },
                reporters: [ createLineReporter() ],
                runtimeStateDir: join(directory, 'state')
            });
            const result = await orchestrator.bench.run({
                config,
                cwd: process.cwd(),
                engine: { kind: 'default' },
                request: defaultRunRequest({ profile: 'costs', order: 'lexical' })
            }, { timing: null });
            assertContext(mutationCostEvidence, result, mode);
            return assertContext.collect();
        }
    }) ]
);
