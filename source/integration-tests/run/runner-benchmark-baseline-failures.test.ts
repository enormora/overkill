import { mkdir, readFile, rename } from 'node:fs/promises';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { defineReporter, type DefinedReporter } from '../../packages/engine/engine.entry-point.ts';
import { normalizeConfig, orchestrator, type RunCommand } from '../../packages/run/run.entry-point.ts';
import type { PerformanceBaselineAdapter } from '../../baselines/performance-adapter.ts';
import {
    createBenchmarkBaselineFixture,
    durationAdapter,
    readBaselineContents,
    performanceBaselineFixtureFile,
    type BaselineFixture
} from '../../test-support/benchmark-baseline-fixture.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { runIfMain } from '../direct-launcher.test.ts';

const execution = { processModel: 'supervised-process', maxConcurrency: 1, scheduling: 'serial' } as const;

function withAdapters(command: RunCommand, adapters: readonly PerformanceBaselineAdapter[]): RunCommand {
    const profile = command.config.profiles.startup;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Missing benchmark profile.');
    }
    return {
        ...command,
        config: {
            ...command.config,
            profiles: {
                startup: {
                    ...profile,
                    baselines: { ...profile.baselines, adapters }
                }
            }
        }
    };
}

async function assertObservationFailure(scope: TestScope): Promise<void> {
    const fixture = await createBenchmarkBaselineFixture(scope, execution);
    const adapter = durationAdapter(function () {
        return 0;
    });
    const command = withAdapters(fixture.command, [ {
        ...adapter,
        observe(input) {
            return input.work.case.title === 'second'
                ? { kind: 'missing', reason: 'Duration unavailable.' }
                : adapter.observe(input);
        }
    } ]);
    const result = await orchestrator.bench.baseline.update(command, { timing: null });
    scope.assert.equal(result.changes.length, 1);
    scope.assert.equal(result.writeOutcome.kind, 'blocked');
    scope.assert.equal(result.result.runnerErrors[0]?.subtype, 'artifact');
    scope.assert.equal(result.result.runnerErrors[0]?.attributedTo?.title, 'second');
    scope.assert.deepEqual(await readBaselineContents(fixture), []);
}

function withAdditionalMetric(command: RunCommand): RunCommand {
    const profile = command.config.profiles.startup;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Missing benchmark profile.');
    }
    return withAdapters(command, [ ...profile.baselines.adapters, {
        ...durationAdapter(function () {
            return 0;
        }),
        id: 'new-metric'
    } ]);
}

async function assertBootstrapBlocksCreates(scope: TestScope): Promise<void> {
    const fixture = await createBenchmarkBaselineFixture(scope, execution);
    await orchestrator.bench.baseline.update(fixture.command, { timing: null });
    const original = await readBaselineContents(fixture);
    fixture.setOffset(10);
    const result = await orchestrator.bench.baseline.bootstrap(withAdditionalMetric(fixture.command), { timing: null });
    scope.assert.equal(result.changes.length, 2);
    scope.assert.equal(result.result.summary.failed, 2);
    scope.assert.equal(result.writeOutcome.kind, 'blocked');
    scope.assert.deepEqual(await readBaselineContents(fixture), original);
}

function interruptSecondWrite(filePath: string): DefinedReporter {
    return defineReporter(function createWriteInterruption() {
        return {
            dispose: null,
            kind: 'real-time',
            name: 'write-interruption',
            onFinish: null,
            sinks: [ { kind: 'memory' } ],
            async onEvent(event) {
                if (event.kind === 'test-end' && event.case.title === 'second' && event.completion === 'final') {
                    await rename(filePath, `${filePath}.backup`);
                    await mkdir(filePath);
                }
            }
        };
    });
}

type BaselinePaths = { readonly first: string; readonly second: string; };
async function baselinePaths(scope: TestScope, fixture: BaselineFixture): Promise<BaselinePaths> {
    const entries = await orchestrator.bench.baseline.list({
        ...fixture.command,
        request: { paths: [], profile: 'startup' }
    });
    const first = entries.find(function (entry) {
        return entry.baseline.work.case.title === 'first';
    });
    const second = entries.find(function (entry) {
        return entry.baseline.work.case.title === 'second';
    });
    scope.require.defined(first);
    scope.require.defined(second);
    return { first: first.path, second: second.path };
}

async function assertPartialContents(scope: TestScope, first: string, second: string): Promise<void> {
    const changed: unknown = JSON.parse(await readFile(first, 'utf8'));
    scope.assert.partialDeepEqual(changed, { expected: { value: 110 } });
    const preserved: unknown = JSON.parse(await readFile(`${second}.backup`, 'utf8'));
    scope.assert.partialDeepEqual(preserved, { expected: { value: 200 } });
}

async function assertPartialWrite(scope: TestScope, fixture: BaselineFixture): Promise<void> {
    const { first, second } = await baselinePaths(scope, fixture);
    fixture.setOffset(10);
    const command = {
        ...fixture.command,
        config: { ...fixture.command.config, reporters: [ interruptSecondWrite(second) ] },
        request: { ...fixture.command.request, order: 'lexical' as const }
    };
    const result = await orchestrator.bench.baseline.update(command, { timing: null });
    if (result.writeOutcome.kind !== 'failed') {
        throw new Error('Expected a failed baseline write.');
    }
    scope.assert.equal(result.writeOutcome.writtenChanges.length, 1);
    scope.assert.equal(result.result.runnerErrors[0]?.subtype, 'artifact');
    await assertPartialContents(scope, first, second);
}

function diskOnlyCommand(command: RunCommand): RunCommand {
    const profile = command.config.profiles.startup;
    const defaults = normalizeConfig({
        profiles: { startup: { testFamily: 'benchmark', files: { include: [ 'missing-file.bench.ts' ] } } }
    })
        .profiles
        .startup;
    if (
        profile?.testFamily !== 'benchmark' || defaults?.testFamily !== 'benchmark' ||
        defaults.execution.processModel !== 'worker-pool'
    ) {
        throw new Error('Missing benchmark profile.');
    }
    return {
        ...command,
        config: {
            ...command.config,
            profiles: {
                startup: {
                    ...profile,
                    files: { include: [ 'missing-file.bench.ts' ], exclude: [] },
                    execution: {
                        ...defaults.execution,
                        hostProcess: { kind: 'child', nodeArguments: [ '--invalid-calibration-flag' ] }
                    }
                }
            }
        }
    };
}

async function assertListIsolation(scope: TestScope): Promise<void> {
    const fixture = await createBenchmarkBaselineFixture(scope, execution);
    await orchestrator.bench.baseline.update(fixture.command, { timing: null });
    const { config } = diskOnlyCommand(fixture.command);
    const entries = await orchestrator.bench.baseline.list({
        config,
        cwd: fixture.command.cwd,
        request: { paths: [ 'source/integration-tests/run/fixtures' ], profile: 'startup' }
    });
    scope.assert.equal(entries.length, 2);
    const unselected = await orchestrator.bench.baseline.list({
        config,
        cwd: fixture.command.cwd,
        request: { paths: [ 'another-source' ], profile: 'startup' }
    });
    scope.assert.deepEqual(unselected, []);
}

function commandWithFailingCase(command: RunCommand): RunCommand {
    const profile = command.config.profiles.startup;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Missing benchmark profile.');
    }
    return {
        ...command,
        config: {
            ...command.config,
            profiles: {
                startup: {
                    ...profile,
                    files: {
                        include: [
                            performanceBaselineFixtureFile,
                            'source/integration-tests/run/fixtures/benchmark.bench.test.ts'
                        ],
                        exclude: []
                    }
                }
            }
        },
        request: {
            ...command.request,
            selection: {
                kind: 'filter',
                filter: {
                    kind: 'any',
                    filters: [
                        { kind: 'equals', field: 'title', value: 'first' },
                        { kind: 'equals', field: 'title', value: 'fails' }
                    ]
                }
            }
        }
    };
}

async function assertFailedCaseBlocksWrites(scope: TestScope): Promise<void> {
    const fixture = await createBenchmarkBaselineFixture(scope, execution);
    const result = await orchestrator.bench.baseline.update(commandWithFailingCase(fixture.command), { timing: null });
    scope.assert.equal(result.changes.length, 1);
    scope.assert.equal(result.result.summary.failed, 1);
    scope.assert.deepEqual(result.result.runnerErrors, []);
    scope.assert.equal(result.writeOutcome.kind, 'blocked');
    scope.assert.deepEqual(await readBaselineContents(fixture), []);
}

async function assertCalibrationFailure(scope: TestScope): Promise<void> {
    const fixture = await createBenchmarkBaselineFixture(scope, execution);
    const command = diskOnlyCommand(fixture.command);
    const result = await orchestrator.bench.baseline.update({
        ...command,
        request: { ...command.request, paths: [ performanceBaselineFixtureFile ] }
    }, { timing: null });
    scope.assert.equal(result.result.runnerErrors[0]?.subtype, 'artifact');
    scope.assert.deepEqual(result.result.perTest, []);
    scope.assert.equal(result.writeOutcome.kind, 'blocked');
    scope.assert.deepEqual(await readBaselineContents(fixture), []);
}

async function assertLateReporterFailure(scope: TestScope): Promise<void> {
    const fixture = await createBenchmarkBaselineFixture(scope, execution);
    const reporter = defineReporter(function () {
        return {
            dispose: null,
            kind: 'final-result',
            name: 'late-failure',
            sinks: [ { kind: 'memory' } ],
            onResult() {
                throw new Error('Late reporter failure.');
            }
        };
    });
    const result = await orchestrator.bench.baseline.update({
        ...fixture.command,
        config: { ...fixture.command.config, reporters: [ reporter ] }
    }, { timing: null });
    scope.assert.equal(result.result.status, 'failed');
    scope.assert.equal(result.result.runnerErrors[0]?.subtype, 'reporter');
    scope.assert.equal(result.writeOutcome.kind, 'written');
    const contents = await readBaselineContents(fixture);
    scope.assert.equal(contents.length, 2);
}

export const testNode = suite('benchmark baseline failure boundaries', [
    test('case assertion failures block pending creates', async function (scope: TestScope) {
        await assertFailedCaseBlocksWrites(scope);
        return scope.assert.collect();
    }),
    test('calibration process failures block writes before benchmark execution', async function (scope: TestScope) {
        await assertCalibrationFailure(scope);
        return scope.assert.collect();
    }),
    test('late reporter failures preserve completed baseline writes', async function (scope: TestScope) {
        await assertLateReporterFailure(scope);
        return scope.assert.collect();
    }),
    test('missing observations block all pending writes with case attribution', async function (scope: TestScope) {
        await assertObservationFailure(scope);
        return scope.assert.collect();
    }),
    test('bootstrap mismatches block creation of unrelated missing metrics', async function (scope: TestScope) {
        await assertBootstrapBlocksCreates(scope);
        return scope.assert.collect();
    }),
    test('later I/O failures preserve and report completed writes', async function (scope: TestScope) {
        const fixture = await createBenchmarkBaselineFixture(scope, execution);
        await orchestrator.bench.baseline.update(fixture.command, { timing: null });
        await assertPartialWrite(scope, fixture);
        return scope.assert.collect();
    }),
    test('listing reads persisted identities without collection or calibration', async function (scope: TestScope) {
        await assertListIsolation(scope);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode, [ createLineReporter() ]);
