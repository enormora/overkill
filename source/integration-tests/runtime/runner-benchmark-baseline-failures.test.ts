import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder, defineCompositeAssertion } from '@overkill-dev/test/assert';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { defineMacro, type TestScope, suite, test } from '@overkill-dev/test';

import { defineReporter, type DefinedReporter, type PerTestResult } from '../../packages/engine/engine.entry-point.ts';
import { normalizeConfig, orchestrator, type RunCommand } from '../../packages/run/run.entry-point.ts';
import type { PerformanceBaselineAdapter } from '../../baselines/performance-adapter.ts';
import {
    createBenchmarkBaselineFixture,
    durationAdapter,
    readBaselineContents,
    performanceBaselineFixtureFile,
    type BaselineFixture
} from '../../test-support/benchmark-baseline-fixture.ts';

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

const assertObservationFailure = defineMacro((title: string) =>
    test(title, async (scope) => {
        const fixture = await createBenchmarkBaselineFixture(scope.cleanup, execution);
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

        return scope.assert.collect();
    })
);

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
async function baselinePaths(fixture: BaselineFixture): Promise<BaselinePaths> {
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
    if (first === undefined || first === null) {
        throw new Error('Expected first to satisfy defined.');
    }
    if (second === undefined || second === null) {
        throw new Error('Expected second to satisfy defined.');
    }
    return { first: first.path, second: second.path };
}

const partialContentsChecks = async (
    check: CompositeCheckBuilder<'assert'>,
    first: string,
    second: string
): Promise<CompositeAssertionReturn<'assert'>> => {
    const changed: unknown = JSON.parse(await readFile(first, 'utf8'));
    const initialChecks = check.partialDeepEqual(changed, { expected: { value: 110 } });
    const preserved: unknown = JSON.parse(await readFile(`${second}.backup`, 'utf8'));
    return check.group([ initialChecks, check.partialDeepEqual(preserved, { expected: { value: 200 } }) ]);
};

const assertPartialWrite = defineCompositeAssertion({
    name: 'partial write',
    async assert(check, fixture: BaselineFixture) {
        const { first, second } = await baselinePaths(fixture);
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
        return check.group([
            check.equal(result.writeOutcome.writtenChanges.length, 1),
            check.equal(result.result.runnerErrors[0]?.subtype, 'artifact'),
            await partialContentsChecks(check.annotated('partial contents'), first, second)
        ]);
    }
});

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

type FailingBenchmarkCase = { readonly file: string; readonly title: string; };

function commandWithFailingCase(command: RunCommand, failedCase: FailingBenchmarkCase): RunCommand {
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
                            failedCase.file
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
                        { kind: 'equals', field: 'title', value: failedCase.title }
                    ]
                }
            }
        }
    };
}

const assertFailedCaseBlocksWrites = defineMacro((title: string) =>
    test(title, async (scope) => {
        const fixture = await createBenchmarkBaselineFixture(scope.cleanup, execution);
        const result = await orchestrator.bench.baseline.update(
            commandWithFailingCase(fixture.command, {
                file: 'source/integration-tests/runtime/fixtures/benchmark.bench.test.ts',
                title: 'fails'
            }),
            { timing: null }
        );
        scope.assert.equal(result.changes.length, 1);
        scope.assert.equal(result.result.summary.failed, 1);
        scope.assert.deepEqual(result.result.runnerErrors, []);
        scope.assert.equal(result.writeOutcome.kind, 'blocked');
        scope.assert.deepEqual(await readBaselineContents(fixture), []);

        return scope.assert.collect();
    })
);

const assertCleanupGcEvidence = defineCompositeAssertion({
    name: 'cleanup gc evidence',
    assert(check, failed: PerTestResult) {
        const measured = failed.benchmark;
        if (measured === undefined || measured === null) {
            return check.defined(measured);
        }
        const initialChecks = check.group([
            check.defined(measured),
            check.equal(measured.samples, 1),
            check.equal(measured.status, 'incomplete')
        ]);
        const { lifecycle } = measured;
        if (lifecycle === undefined || lifecycle === null) {
            return check.group([ initialChecks, check.defined(lifecycle) ]);
        }
        return check.group([
            initialChecks,
            check.defined(lifecycle),
            check.partialDeepEqual(lifecycle, {
                garbageCollection: { mode: 'after-sample', completed: 1, failures: 0 }
            })
        ]);
    }
});

const assertSampleCleanupBlocksWrites = defineMacro((title: string) =>
    test(title, async (scope: TestScope) => {
        const fixture = await createBenchmarkBaselineFixture(scope.cleanup, execution);
        const result = await orchestrator.bench.baseline.update(
            commandWithFailingCase(fixture.command, {
                file: 'source/integration-tests/runtime/fixtures/benchmark-cleanup-failure.bench.test.ts',
                title: 'sample cleanup fails'
            }),
            { timing: null }
        );
        const failed = result.result.perTest.find(function isCleanupFailure(entry) {
            return entry.id.title === 'sample cleanup fails';
        });
        scope.assert.equal(result.writeOutcome.kind, 'blocked');
        scope.assert.equal(result.changes.length, 1);
        scope.assert.equal(failed?.verdict, 'fail');
        scope.require.defined(failed);
        scope.assert(assertCleanupGcEvidence, failed);
        scope.assert.deepEqual(await readBaselineContents(fixture), []);

        return scope.assert.collect();
    })
);

export const testNode = suite('benchmark baseline failure boundaries', [
    assertSampleCleanupBlocksWrites('sample cleanup failures retain readings and block pending creates'),
    assertFailedCaseBlocksWrites('case assertion failures block pending creates'),
    test('calibration process failures block writes before benchmark execution', async (scope) => {
        const fixture = await createBenchmarkBaselineFixture(scope.cleanup, execution);
        const command = diskOnlyCommand(fixture.command);
        const result = await orchestrator.bench.baseline.update({
            ...command,
            request: { ...command.request, paths: [ performanceBaselineFixtureFile ] }
        }, { timing: null });
        scope.assert.equal(result.result.runnerErrors[0]?.subtype, 'artifact');
        scope.assert.deepEqual(result.result.perTest, []);
        scope.assert.equal(result.writeOutcome.kind, 'blocked');
        scope.assert.deepEqual(await readBaselineContents(fixture), []);

        return scope.assert.collect();
    }),
    test('late reporter failures preserve completed baseline writes', async (scope) => {
        const fixture = await createBenchmarkBaselineFixture(scope.cleanup, execution);
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

        return scope.assert.collect();
    }),
    assertObservationFailure('missing observations block all pending writes with case attribution'),
    test('bootstrap mismatches block creation of unrelated missing metrics', async (scope) => {
        const fixture = await createBenchmarkBaselineFixture(scope.cleanup, execution);
        await orchestrator.bench.baseline.update(fixture.command, { timing: null });
        const original = await readBaselineContents(fixture);
        fixture.setOffset(10);
        const result = await orchestrator.bench.baseline.bootstrap(withAdditionalMetric(fixture.command), {
            timing: null
        });
        scope.assert.equal(result.changes.length, 2);
        scope.assert.equal(result.result.summary.failed, 2);
        scope.assert.equal(result.writeOutcome.kind, 'blocked');
        scope.assert.deepEqual(await readBaselineContents(fixture), original);

        return scope.assert.collect();
    }),
    test('later I/O failures preserve and report completed writes', async function (scope) {
        const fixture = await createBenchmarkBaselineFixture(scope.cleanup, execution);
        await orchestrator.bench.baseline.update(fixture.command, { timing: null });
        await scope.assert(assertPartialWrite, fixture);
        return scope.assert.collect();
    }),
    test('listing reads persisted identities without collection or calibration', async (scope) => {
        const fixture = await createBenchmarkBaselineFixture(scope.cleanup, execution);
        await orchestrator.bench.baseline.update(fixture.command, { timing: null });
        const { config } = diskOnlyCommand(fixture.command);
        const entries = await orchestrator.bench.baseline.list({
            config,
            cwd: fixture.command.cwd,
            request: { paths: [ 'source/integration-tests/runtime/fixtures' ], profile: 'startup' }
        });
        scope.assert.equal(entries.length, 2);
        const unselected = await orchestrator.bench.baseline.list({
            config,
            cwd: fixture.command.cwd,
            request: { paths: [ 'another-source' ], profile: 'startup' }
        });
        scope.assert.deepEqual(unselected, []);

        return scope.assert.collect();
    })
]);
