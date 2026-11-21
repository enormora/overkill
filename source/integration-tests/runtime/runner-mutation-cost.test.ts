import type { ParameterizedTestScope } from '@overkill-dev/test';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { table, type TestScope, suite } from '@overkill-dev/test';

import { normalizeConfig, orchestrator, type PerTestResult } from '../../packages/run/run.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { mutationModes, type MutationMode } from './fixtures/mutation-evidence/mutation-project.test.ts';

const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const benchmarkUrl = new URL(`./fixtures/mutation-evidence/mutation-cost.bench.test.${extension}`, import.meta.url);

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

const assertCostMetric = defineCompositeAssertion({
    name: 'cost metric',
    assert(check, reading: CostMetrics[string] | undefined) {
        if (reading === undefined || reading === null) {
            return check.defined(reading);
        }
        return check.group([
            check.equal(reading.count, 2),
            check.true(reading.minimum !== null && reading.minimum >= 0)
        ]);
    }
});

const assertHostBootstrap = defineCompositeAssertion({
    name: 'host bootstrap',
    assert(check, metrics: CostMetrics, mode: MutationMode) {
        const reading: CostMetrics[string] | undefined = metrics.freshHostEntryToLifecycleMicroseconds;
        if (reading === undefined || reading === null) {
            return check.defined(reading);
        }
        return check.group([
            check.equal(reading.count, mode.freshState || mode.processModel === 'supervised-process' ? 2 : 0)
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
        async test(scope: ParameterizedTestScope<(typeof mutationModes)[number]>) {
            const mode = scope.parameters;

            const { file, directory } = await costFixture(scope.cleanup, mode);
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
                const { benchmark } = entry;
                scope.require.defined(benchmark);
                scope.assert.equal(benchmark.status, 'complete');
                scope.assert.equal(benchmark.samples, 2);
                scope.assert.equal(benchmark.lifecycle?.warmup.samples, 0);
                const costEvidencePhases = entry.id.title.includes('execution-session')
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
                for (
                    const costEvidenceName of [
                        'durationMicroseconds',
                        'driverStartupMilliseconds',
                        ...costEvidencePhases
                    ]
                ) {
                    scope.assert(assertCostMetric, benchmark.metrics[costEvidenceName]);
                }
                if (entry.id.title.includes('execution-session')) {
                    scope.assert(assertHostBootstrap, benchmark.metrics, mode);
                }
            }
            return scope.assert.collect();
        }
    }) ]
);
