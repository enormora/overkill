import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';

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
import { readBenchmarkRunMetadata } from '../../bench/benchmark-run-report.ts';
import { readPerformanceBaselineReport } from '../../baselines/performance-report.ts';

function benchmarkProfile(fixture: BaselineFixture): BenchmarkProfileConfig {
    const profile = fixture.command.config.profiles.startup;
    if (profile === undefined) {
        throw new Error('Expected profile to satisfy defined.');
    }
    if (profile.testFamily !== 'benchmark') {
        throw new Error('Expected benchmark profile.');
    }
    return profile;
}
function metadataLimitedCommand(fixture: BaselineFixture): RunCommand {
    const profile = benchmarkProfile(fixture);
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

function chartFailureCommand(fixture: BaselineFixture): RunCommand {
    const profile = benchmarkProfile(fixture);
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
const assertPresentationFailure = defineCompositeAssertion({
    name: 'presentation failure',
    assert(check, delivery: BenchmarkBaselineRunResult) {
        const report = readPerformanceBaselineReport(delivery.result);
        if (report === null) {
            return check.defined(report);
        }
        return check.group([
            check.equal(report.writeOutcome.kind, 'written'),
            check.equal(
                report.comparisons.some(function chartError(row) {
                    return row.presentation.kind === 'error';
                }),
                true
            )
        ]);
    }
});
async function outputDirectory(cleanup: TestScope['cleanup']): Promise<string> {
    const directory = await mkdtemp('target/benchmark-html-integration-');
    cleanup(async function removeOutput() {
        await rm(directory, { recursive: true, force: true });
    });
    return directory;
}
const assertRenderedDelivery = defineCompositeAssertion({
    name: 'rendered delivery',
    async assert(check, registerCleanup: TestScope['cleanup'], execution: BenchmarkExecution) {
        const fixture = await createBenchmarkBaselineFixture(registerCleanup, execution);
        const outputFile = join(await outputDirectory(registerCleanup), 'report.html');
        const command = {
            ...fixture.command,
            config: { ...fixture.command.config, reporters: [ createBenchmarkHtmlReporter({ outputFile }) ] }
        };
        const delivery = await orchestrator.bench.baseline.bootstrap(command, { timing: null });
        const initialChecks = check.group([
            check.equal(delivery.writeOutcome.kind, 'written'),
            check.deepEqual(delivery.result.runnerErrors, [])
        ]);
        const html = await readFile(outputFile, 'utf8');
        return check.group([
            initialChecks,
            check.includes(html, execution.processModel),
            check.includes(html, 'machineClass')
        ]);
    }
});
export const testNode = suite('benchmark HTML runner integration', [
    test('preserves baseline writes when chart metadata fails', async function (scope) {
        const fixture = await createBenchmarkBaselineFixture(scope.cleanup, {
            processModel: 'supervised-process',
            scheduling: 'serial',
            maxConcurrency: 1
        });
        const command = chartFailureCommand(fixture);
        const delivery = await orchestrator.bench.baseline.bootstrap(command, { timing: null });
        scope.assert.equal(delivery.writeOutcome.kind, 'written');
        scope.assert.equal(delivery.result.status, 'failed');
        const contents = await readBaselineContents(fixture);
        scope.assert.equal(contents.length > 0, true);
        scope.assert(assertPresentationFailure, delivery);
        return scope.assert.collect();
    }),
    test('renders supervised process evidence', async function (scope) {
        await scope.assert(assertRenderedDelivery, scope.cleanup, {
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
        await scope.assert(assertRenderedDelivery, scope.cleanup, profile.execution);
        return scope.assert.collect();
    }),
    test('keeps benchmark facts outside artifact byte limits', async function (scope) {
        const fixture = await createBenchmarkBaselineFixture(scope.cleanup, {
            processModel: 'supervised-process',
            scheduling: 'serial',
            maxConcurrency: 1
        });
        const command = metadataLimitedCommand(fixture);
        const delivery = await orchestrator.bench.baseline.bootstrap(fixture.command, { timing: null });
        const originalResult = { ...delivery.result, preparationFacts: null };
        const result = withBenchmarkErrorMetadata(originalResult, command, null);
        scope.assert.deepEqual({
            status: result.status,
            perTest: result.perTest,
            artifacts: result.artifacts,
            runnerErrors: result.runnerErrors
        }, {
            status: originalResult.status,
            perTest: originalResult.perTest,
            artifacts: originalResult.artifacts,
            runnerErrors: originalResult.runnerErrors
        });
        scope.assert.equal(readBenchmarkRunMetadata(result.preparationFacts)?.execution.profile, 'startup');
        return scope.assert.collect();
    })
]);
