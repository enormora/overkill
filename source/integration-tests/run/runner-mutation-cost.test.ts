import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { normalizeConfig, orchestrator, type PerTestResult } from '../../packages/run/run.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { mutationModes, type MutationMode } from './fixtures/mutation-evidence/mutation-project.test.ts';

const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const benchmarkUrl = new URL(`./fixtures/mutation-evidence/mutation-cost.bench.test.${extension}`, import.meta.url);

async function costFixture(
    scope: TestScope,
    mode: MutationMode
): Promise<{ readonly file: string; readonly directory: string; }> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp('target/mutation-cost-smoke-');
    scope.cleanup(async function removeFixture() {
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

function assertCostMetric(scope: TestScope, reading: CostMetrics[string] | undefined): void {
    scope.require.defined(reading);
    scope.assert.equal(reading.count, 2);
    scope.assert.true(reading.minimum !== null && reading.minimum >= 0);
}

function assertHostBootstrap(scope: TestScope, metrics: CostMetrics, mode: MutationMode): void {
    const reading: CostMetrics[string] | undefined = metrics.freshHostEntryToLifecycleMicroseconds;
    scope.require.defined(reading);
    scope.assert.equal(reading.count, mode.freshState || mode.processModel === 'supervised-process' ? 2 : 0);
}

function assertCostEvidence(scope: TestScope, entry: PerTestResult, mode: MutationMode): void {
    const { benchmark } = entry;
    scope.require.defined(benchmark);
    scope.assert.equal(benchmark.status, 'complete');
    scope.assert.equal(benchmark.samples, 2);
    scope.assert.equal(benchmark.lifecycle?.warmup.samples, 0);
    const phases = entry.id.title.includes('execution-session')
        ? [
            'initialPlanReadyMicroseconds',
            'subsequentPlanReadyMicroseconds',
            'initialExecutionMicroseconds',
            'subsequentExecutionMicroseconds',
            'initialInvocationMicroseconds',
            'subsequentInvocationMicroseconds',
            'disposalMicroseconds'
        ]
        : [ 'campaignMicroseconds' ];
    for (const name of [ 'durationMicroseconds', 'driverStartupMilliseconds', ...phases ]) {
        assertCostMetric(scope, benchmark.metrics[name]);
    }
    if (entry.id.title.includes('execution-session')) {
        assertHostBootstrap(scope, benchmark.metrics, mode);
    }
}

export const testNode = suite(
    'mutation cost measurement completeness',
    mutationModes.map(function executionModes(mode) {
        return test(`${mode.processModel} freshState ${String(mode.freshState)}`, async function (scope) {
            const { file, directory } = await costFixture(scope, mode);
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
            scope.assert.deepEqual(result.runnerErrors, []);
            scope.assert.equal(result.summary.passed, 3);
            for (const entry of result.perTest) {
                assertCostEvidence(scope, entry, mode);
            }
            return scope.assert.collect();
        });
    })
);

await runIfMain(import.meta, testNode);
