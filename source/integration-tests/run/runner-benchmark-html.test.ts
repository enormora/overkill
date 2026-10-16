import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import {
    orchestrator,
    normalizeConfig,
    type BenchmarkExecution,
    type RunCommand,
    type BenchmarkProfileConfig,
    type BenchmarkBaselineRunResult
} from '../../packages/run/run.entry-point.ts';
import { withBenchmarkErrorMetadata } from '../../run/benchmark-report-metadata.ts';
import { createBenchmarkHtmlReporter } from '../../packages/reporter-benchmark-html/reporter-benchmark-html.entry-point.ts';
import {
    createBenchmarkBaselineFixture,
    durationAdapter,
    readBaselineContents,
    type BaselineFixture
} from '../../test-support/benchmark-baseline-fixture.ts';
import { readPerformanceBaselineReport } from '../../baselines/performance-report.ts';

function withoutBenchmarkMetadata(result: BenchmarkBaselineRunResult['result']): BenchmarkBaselineRunResult['result'] {
    return {
        ...result,
        artifacts: result.artifacts.filter(function retainOtherArtifacts(artifact) {
            return artifact.payload.kind !== 'runtime-attachment' ||
                artifact.payload.name !== 'benchmark-run';
        })
    };
}

function benchmarkProfile(scope: TestScope, fixture: BaselineFixture): BenchmarkProfileConfig {
    const profile = fixture.command.config.profiles.startup;
    scope.require.defined(profile);
    if (profile.testFamily !== 'benchmark') {
        throw new Error('Expected benchmark profile.');
    }
    return profile;
}
function metadataLimitedCommand(scope: TestScope, fixture: BaselineFixture): RunCommand {
    const profile = benchmarkProfile(scope, fixture);
    return {
        ...fixture.command,
        config: {
            ...fixture.command.config,
            profiles: {
                startup: {
                    ...profile,
                    attachments: { ...profile.attachments, maxArtifactBytes: 1 }
                }
            }
        }
    };
}

function chartFailureCommand(scope: TestScope, fixture: BaselineFixture): RunCommand {
    const profile = benchmarkProfile(scope, fixture);
    const adapter = {
        ...durationAdapter(function offset() {
            return 0;
        }),
        describeMetrics() {
            throw new Error('Chart extraction failed.');
        }
    };
    return {
        ...fixture.command,
        config: {
            ...fixture.command.config,
            profiles: {
                startup: {
                    ...profile,
                    baselines: { ...profile.baselines, adapters: [ adapter ] }
                }
            }
        }
    };
}
function assertPresentationFailure(scope: TestScope, delivery: BenchmarkBaselineRunResult): void {
    const report = readPerformanceBaselineReport(delivery.result);
    scope.require.defined(report);
    scope.assert.equal(report.writeOutcome.kind, 'written');
    scope.assert.equal(
        report.comparisons.some(function chartError(row) {
            return row.presentation.kind === 'error';
        }),
        true
    );
}
async function outputDirectory(scope: TestScope): Promise<string> {
    const directory = await mkdtemp('target/benchmark-html-integration-');
    scope.cleanup(async function removeOutput() {
        await rm(directory, { recursive: true, force: true });
    });
    return directory;
}
async function assertRenderedDelivery(scope: TestScope, execution: BenchmarkExecution): Promise<void> {
    const fixture = await createBenchmarkBaselineFixture(scope, execution);
    const outputFile = join(await outputDirectory(scope), 'report.html');
    const command = {
        ...fixture.command,
        config: { ...fixture.command.config, reporters: [ createBenchmarkHtmlReporter({ outputFile }) ] }
    };
    const delivery = await orchestrator.bench.baseline.bootstrap(command, { timing: null });
    scope.assert.equal(delivery.writeOutcome.kind, 'written');
    scope.assert.deepEqual(delivery.result.runnerErrors, []);
    const html = await readFile(outputFile, 'utf8');
    scope.assert.includes(html, execution.processModel);
    scope.assert.includes(html, 'machineClass');
}
export const testNode = suite('benchmark HTML runner integration', [
    test('preserves baseline writes when chart metadata fails', async function (scope: TestScope) {
        const fixture = await createBenchmarkBaselineFixture(scope, {
            processModel: 'supervised-process',
            scheduling: 'serial',
            maxConcurrency: 1
        });
        const command = chartFailureCommand(scope, fixture);
        const delivery = await orchestrator.bench.baseline.bootstrap(command, { timing: null });
        scope.assert.equal(delivery.writeOutcome.kind, 'written');
        scope.assert.equal(delivery.result.status, 'failed');
        const contents = await readBaselineContents(fixture);
        scope.assert.equal(contents.length > 0, true);
        assertPresentationFailure(scope, delivery);
        return scope.assert.collect();
    }),
    test('renders supervised process evidence', async function (scope: TestScope) {
        await assertRenderedDelivery(scope, {
            processModel: 'supervised-process',
            scheduling: 'serial',
            maxConcurrency: 1
        });
        return scope.assert.collect();
    }),
    test('renders worker pool evidence', async function (scope: TestScope) {
        const config = normalizeConfig({
            profiles: { startup: { testFamily: 'benchmark', files: { include: [ 'fixture.bench.ts' ] } } }
        });
        const profile = config.profiles.startup;
        scope.require.defined(profile);
        if (profile.testFamily !== 'benchmark') {
            throw new Error('Expected benchmark profile.');
        }
        await assertRenderedDelivery(scope, profile.execution);
        return scope.assert.collect();
    }),
    test('preserves results when metadata exceeds the artifact limit', async function (scope: TestScope) {
        const fixture = await createBenchmarkBaselineFixture(scope, {
            processModel: 'supervised-process',
            scheduling: 'serial',
            maxConcurrency: 1
        });
        const command = metadataLimitedCommand(scope, fixture);
        const delivery = await orchestrator.bench.baseline.bootstrap(fixture.command, { timing: null });
        const originalResult = withoutBenchmarkMetadata(delivery.result);
        const result = withBenchmarkErrorMetadata(originalResult, command, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.perTest.length, originalResult.perTest.length);
        scope.assert.equal(result.artifacts.length, originalResult.artifacts.length);
        scope.assert.equal(
            result.runnerErrors.at(-1)?.message,
            'benchmark-run report exceeds the configured artifact byte limit.'
        );
        return scope.assert.collect();
    })
]);
const { runIfMain } = await import('../direct-launcher.test.ts');
const { createLineReporter } = await import('../../packages/reporter-line/reporter-line.entry-point.ts');
await runIfMain(import.meta, testNode, [ createLineReporter() ]);
