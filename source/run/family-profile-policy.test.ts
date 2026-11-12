import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineReporter, defineTestFamily, type TestFamily } from '../packages/engine/engine.entry-point.ts';
import { normalizeConfig, type RunCommand, type RunRequest } from '../packages/run/run.entry-point.ts';
import { createDeterministicRunCoordinator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { analysisFixture, type EvidenceMode } from '../test-support/family-analysis-fixture.ts';
import { selectBenchmarkProfile, selectProfile } from './test-profile.ts';
import { assertProfileRequestSupported, validateRunInput } from './run-validation.ts';
import { observeResolvedFamily } from './family-profile-run.ts';

function command(record: (event: string) => void, mode: EvidenceMode): RunCommand {
    return {
        config: normalizeConfig({
            profiles: {
                types: {
                    testFamily: analysisFixture(record, mode),
                    settings: null,
                    files: { include: [ 'source/native.types.ts' ] }
                }
            }
        }),
        cwd: '/project',
        engine: { kind: 'default' as const },
        request: defaultRunRequest({ profile: 'types', paths: [ 'source/native.types.ts' ] })
    };
}

function changingVariants(record: (event: string) => void): TestFamily<null> {
    const original = analysisFixture(record, 'complete');
    let preparations = 0;
    return defineTestFamily({
        ...original,
        async load() {
            const backend = await original.load();
            return {
                async prepare(input) {
                    preparations += 1;
                    return await backend.prepare({
                        ...input,
                        testPlan: input.expandVariants([
                            { key: `compiler-${preparations}`, facts: null }
                        ])
                    });
                }
            };
        }
    });
}

const unsupportedAnalysisRequests: readonly {
    readonly name: string;
    readonly request: Partial<RunRequest>;
    readonly message: string;
}[] = [
    {
        name: 'debugging',
        request: { debug: { mode: 'all', selectors: [] } },
        message: 'Debug mode requires runtime test bodies.'
    },
    ...([
        { name: 'live capture', request: { capture: 'live' } },
        { name: 'process measurement', request: { measureProcessUsage: true } },
        {
            name: 'process budgets',
            request: {
                processBudgetOverrides: {
                    activeResourceCount: 1,
                    javaScriptEngineHeapBytes: null,
                    residentSetBytes: null,
                    residentSetGrowthBytesPerSecond: null
                }
            }
        },
        { name: 'sampling', request: { processUsageSamplingIntervalMilliseconds: 1 } },
        { name: 'precise timings', request: { timingCollection: 'precise' } }
    ] as const)
        .map(function runtimeRequest(scenario) {
            return {
                ...scenario,
                message:
                    'Analysis profiles do not support runtime capture, debugging, process budgets, or precise timings.'
            };
        }),
    {
        name: 'serial overrides',
        request: { execution: { mode: 'serial' } },
        message: 'Serial execution overrides require a microtest or property profile.'
    },
    {
        name: 'worker overrides',
        request: { workers: 1 },
        message: 'Worker count can only be requested for worker-pool profiles.'
    },
    {
        name: 'ordinary coverage',
        request: { coverage: true },
        message: 'Coverage can only be requested for microtest profiles.'
    }
];

export const testNode = suite('family runner failure policy', [
    ...unsupportedAnalysisRequests.map(function rejectedAnalysisRequest(scenario) {
        return test(`rejects ${scenario.name} for analysis before backend loading`, function (scope) {
            const events: string[] = [];
            const input = command(function record(event) {
                events.push(event);
            }, 'complete');
            scope.assert.throws(function validateAnalysisRequest() {
                assertProfileRequestSupported(
                    { ...input.request, ...scenario.request },
                    selectProfile('types', input.config),
                    'test',
                    null
                );
            }, { message: scenario.message });
            scope.assert.deepEqual(events, []);
            return scope.assert.collect();
        });
    }),
    test('rejects baseline and merge-recording namespaces for imported analysis', function (scope) {
        const input = command(function unusedBackend() {
            return undefined;
        }, 'complete');
        const profile = selectProfile('types', input.config);
        scope.assert.throws(function validateAnalysisBaseline() {
            assertProfileRequestSupported(input.request, profile, 'baseline', null);
        }, { message: 'Ordinary baselines require a microtest, property, or integration profile.' });
        scope.assert.throws(function validateMergeRecordingNamespace() {
            assertProfileRequestSupported(
                { ...input.request, recordForMerge: true, shard: { index: 1, total: 2 } },
                profile,
                'baseline',
                null
            );
        }, { message: '--record-for-merge is only supported by ordinary runs outside execution sessions.' });
        return scope.assert.collect();
    }),
    test('validates malformed JavaScript request flags before backend loading', function (scope) {
        const input = command(function unusedBackend() {
            return undefined;
        }, 'complete');
        for (
            const scenario of [
                { field: 'lastFailed', value: 'yes', message: 'Run lastFailed must be a boolean.' },
                {
                    field: 'timingCollection',
                    value: 'fast',
                    message: 'Timing collection must be "profile-default" or "precise".'
                },
                { field: 'recordForMerge', value: 'yes', message: 'Record for merge must be a boolean.' }
            ]
        ) {
            const request = { ...input.request, shard: { index: 1, total: 2 } };
            Reflect.set(request, scenario.field, scenario.value);
            scope.assert.throws(function validateMalformedRequest() {
                validateRunInput({ ...input, request });
            }, { message: scenario.message });
        }
        return scope.assert.collect();
    }),
    test('retains selection and disposal failures together', async function (scope) {
        const events: string[] = [];
        const cleanup = new Error('Family cleanup failed.');
        const input = command(function record(event) {
            events.push(event);
            if (event === 'dispose') {
                throw cleanup;
            }
        }, 'complete');
        try {
            await createDeterministicRunCoordinator().orchestrator.resolve({
                ...input,
                request: {
                    ...input.request,
                    selection: { kind: 'filter', filter: { field: 'title', kind: 'equals', value: 'missing' } }
                }
            });
        } catch (error: unknown) {
            if (!(error instanceof AggregateError)) {
                throw new Error('Expected combined setup and cleanup failures.', { cause: error });
            }
            scope.assert.deepEqual({
                message: error.message,
                errors: error
                    .errors
                    .filter(function isError(cause: unknown) {
                        return cause instanceof Error;
                    })
                    .map(function errorMessage(cause) {
                        return cause.message;
                    }),
                events
            }, {
                message: 'Family setup and cleanup failed.',
                errors: [ 'Run selection matched no test cases.', 'Family cleanup failed.' ],
                events: [ 'load', 'prepare', 'dispose' ]
            });
            return scope.assert.collect();
        }
        throw new Error('Expected family selection to reject.');
    }),
    test('preserves failures for resolved plans without family preparations', async function (scope) {
        const input = command(function unusedBackend() {
            return undefined;
        }, 'complete');
        const resolved = await createDeterministicRunCoordinator().orchestrator.resolve({
            ...input,
            config: normalizeConfig({ profiles: { types: { testFamily: 'microtest' } } })
        });
        const failure = new Error('Observation failed.');
        try {
            await observeResolvedFamily(resolved, async function rejectObservation() {
                throw failure;
            });
        } catch (error: unknown) {
            scope.assert.equal(error, failure);
            return scope.assert.collect();
        }
        throw new Error('Expected family observation to reject.');
    }),
    test('rejects variant drift between collection and repeated preparation', async function (scope) {
        const events: string[] = [];
        const input = command(function unusedBackend() {
            return undefined;
        }, 'complete');
        const coordinator = createDeterministicRunCoordinator();
        const initialized = await coordinator.orchestrator.initialize({
            ...input,
            config: normalizeConfig({
                profiles: {
                    types: {
                        testFamily: changingVariants(function record(event) {
                            events.push(event);
                        }),
                        settings: null,
                        files: { include: [ 'source/native.types.ts' ] }
                    }
                }
            })
        });
        const collected = await initialized.collect();
        await scope.assert.rejects(async function executeChangedVariants() {
            await collected.run({ selection: { kind: 'all' } });
        }, { message: 'Prepared family work changed between invocations.' });
        scope.assert.deepEqual(events, [ 'load', 'prepare', 'collect', 'dispose', 'load', 'prepare', 'dispose' ]);
        return scope.assert.collect();
    }),
    test('reports imported family identity when rejecting benchmark selection', function (scope) {
        const events: string[] = [];
        const input = command(function record(event) {
            events.push(event);
        }, 'complete');
        scope.assert.throws(function selectAnalysisAsBenchmark() {
            return selectBenchmarkProfile('types', input.config);
        }, {
            message:
                'Profile "types" has testFamily "@example/analysis". Benchmark commands require testFamily "benchmark".'
        });
        scope.assert.deepEqual(events, []);
        return scope.assert.collect();
    }),
    test('maps backend setup failures through runner diagnostics', async function (scope) {
        const events: string[] = [];
        const coordinator = createDeterministicRunCoordinator();
        const result = await coordinator.orchestrator.run(command(function record(event) {
            events.push(event);
        }, 'setup-error'));
        scope.assert.equal(result.status, 'failed');
        scope.assert.includes(
            result
                .runnerErrors
                .map(function (error) {
                    return error.message;
                })
                .join('\n'),
            'Checker setup failed.'
        );
        scope.assert.equal(result.runnerErrors[0]?.subtype, 'loader');
        scope.assert.deepEqual(events, [ 'load', 'prepare' ]);
        return scope.assert.collect();
    }),
    test('disposes empty selections without calling backend collection', async function (scope) {
        const events: string[] = [];
        const coordinator = createDeterministicRunCoordinator();
        const input = command(function record(event) {
            events.push(event);
        }, 'complete');
        const result = await coordinator.orchestrator.run({
            ...input,
            request: { ...input.request, selection: { kind: 'none' } }
        });
        scope.assert.equal(result.summary.planned, 0);
        scope.assert.deepEqual(events, [ 'load', 'prepare', 'dispose' ]);
        return scope.assert.collect();
    }),
    test('retains reporter failure and disposes backend before final delivery', async function (scope) {
        const events: string[] = [];
        const coordinator = createDeterministicRunCoordinator();
        const input = command(function record(event) {
            events.push(event);
        }, 'complete');
        const reporter = defineReporter(function () {
            return {
                kind: 'real-time',
                name: 'failing family reporter',
                sinks: [ { kind: 'memory' } ],
                onFinish: null,
                dispose() {
                    events.push('reporter-dispose');
                },
                onEvent(event) {
                    if (event.kind === 'run-end') {
                        events.push('run-end');
                    } else if (event.kind === 'test-start') {
                        throw new Error('Reporter failed.');
                    }
                }
            };
        });
        const result = await coordinator.orchestrator.run({
            ...input,
            config: { ...input.config, reporters: [ reporter ] }
        });
        scope.assert.equal(result.status, 'failed');
        scope.assert.true(result.runnerErrors.some(function (error) {
            return error.subtype === 'reporter';
        }));
        scope.assert.true(events.indexOf('dispose') < events.indexOf('run-end'));
        scope.assert.equal(
            events
                .filter(function (event) {
                    return event === 'reporter-dispose';
                })
                .length,
            1
        );
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
