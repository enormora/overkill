import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import {
    createEngine,
    createRunResult,
    singleAttemptResult,
    type Engine,
    type TestCase,
    type TestPlan,
    type PerTestResult,
    type RunnerError,
    type RunResult
} from '../packages/engine/engine.entry-point.ts';
import type { RunAdapterRegistration, AdapterPreparation, CollectedAdapterRun } from '../config/adapter-profile.ts';
import { normalizeConfig } from '../config/config.ts';
import { createInMemoryRealTimeReporter, type InMemoryRealTimeReporter } from '../reporters/in-memory-reporter.ts';
import { createDeterministicRunCoordinator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { executeAdapterPlan, prepareAdapterPlan } from './adapter-execution.ts';

function authoredCase(engine: Engine): TestCase {
    return engine.createTestCase({
        annotations: {},
        controls: {},
        title: 'case',
        definitionLocations: [ { kind: 'unknown' } ],
        body() {
            throw new Error('Adapter execution must not invoke the runtime body.');
        }
    });
}

function executionPlan(): TestPlan {
    const engine = createEngine();
    return engine.createTestPlan(engine.createRoot({
        annotations: {},
        controls: {},
        title: 'adapter',
        children: [ authoredCase(engine) ]
    }));
}

function reportedRun(plan: TestPlan, perTest: readonly PerTestResult[], errors: readonly RunnerError[]): RunResult {
    return createRunResult(plan, perTest, errors, {
        startedAtMicroseconds: 0,
        completedAtMicroseconds: 0,
        testExecutionWallTimeMicroseconds: 0,
        processUsage: null,
        planStatus: 'planned'
    });
}

function passingCase(plan: TestPlan): PerTestResult {
    const testCase = plan.cases[0];
    return singleAttemptResult({
        id: testCase.id,
        workId: testCase.workId,
        definitionLocations: [ { kind: 'unknown' } ],
        outcome: { kind: 'pass' },
        verdict: 'pass',
        durationMicroseconds: 0
    }, { index: 0 });
}

function conflictingEvidence(plan: TestPlan, conflict: 'duplicate' | 'unknown'): readonly PerTestResult[] {
    const result = passingCase(plan);
    if (conflict === 'duplicate') {
        return [ result, result ];
    }
    const id = { ...result.id, title: 'unplanned' };
    return [ { ...result, id, workId: { ...result.workId, case: id } } ];
}

function evidenceCollection(check: (plan: TestPlan) => RunResult, plan: TestPlan): CollectedAdapterRun {
    return {
        facts: null,
        async lower() {
            return {
                facts: null,
                async execute() {
                    return check(plan);
                }
            };
        }
    };
}

function evidenceAdapter(check: (plan: TestPlan) => RunResult): RunAdapterRegistration {
    return {
        id: 'evidence',
        validate(settings) {
            if (settings !== null) {
                throw new Error('Expected null settings.');
            }
        },
        async load() {
            return {
                async prepare(testPlan) {
                    return {
                        testPlan,
                        async collect(plan) {
                            return evidenceCollection(check, plan);
                        }
                    };
                }
            };
        }
    };
}

function failedPreparation(testPlan: TestPlan, record: (event: string) => void): AdapterPreparation {
    record('prepare');
    return {
        testPlan,
        async collect() {
            record('collect');
            return {
                facts: 'collected',
                async lower() {
                    throw new Error('Lowering failed.');
                }
            };
        }
    };
}

function failingAdapter(record: (event: string) => void): RunAdapterRegistration {
    return {
        id: 'fixture',
        validate() {
            record('validate');
        },
        async load() {
            record('load');
            return {
                async prepare(plan) {
                    return failedPreparation(plan, record);
                }
            };
        }
    };
}

async function checkAdapterEvidence(adapter: RunAdapterRegistration, plan: TestPlan): Promise<RunResult> {
    const preparation = await prepareAdapterPlan(adapter, null, plan);
    return await executeAdapterPlan(adapter, preparation.collect(plan), plan);
}

function adapterRunFacts(reporter: InMemoryRealTimeReporter): unknown {
    const start = reporter.getRecordedEntries().find(function (entry) {
        return entry.event?.kind === 'run-start';
    });
    return start?.event?.kind === 'run-start' ? start.event.facts.adapter : null;
}

export const testNode = suite('generic adapter execution', [
    test('reuses preparation across collected invocations', async function (scope) {
        const events: string[] = [];
        const adapter = failingAdapter(function (event) {
            events.push(event);
        });
        const coordinator = createDeterministicRunCoordinator();
        const config = normalizeConfig({
            profiles: {
                types: {
                    testFamily: 'type-test',
                    files: { include: [ 'source/native.types.ts' ] },
                    adapter,
                    settings: null
                }
            }
        });
        const initialized = await coordinator.orchestrator.initialize({
            config,
            cwd: '/project',
            engine: { kind: 'default' },
            request: defaultRunRequest({ profile: 'types', paths: [ 'source/native.types.ts' ] })
        });
        const collected = await initialized.collect();
        const first = await collected.run({ selection: { kind: 'all' } });
        const second = await collected.run({ selection: { kind: 'all' } });
        scope.assert.deepEqual({
            statuses: [ first.status, second.status ],
            loads: events
                .filter(function (event) {
                    return event === 'load';
                })
                .length,
            preparations: events
                .filter(function (event) {
                    return event === 'prepare';
                })
                .length,
            collections: events
                .filter(function (event) {
                    return event === 'collect';
                })
                .length,
            facts: collected.facts.adapter
        }, {
            statuses: [ 'failed', 'failed' ],
            loads: 1,
            preparations: 1,
            collections: 3,
            facts: { id: 'fixture', facts: 'collected' }
        });
        return scope.assert.collect();
    }),
    test('prepares through explicit registration and retains setup failures as runner errors', async function (scope) {
        const events: string[] = [];
        const adapter = failingAdapter(function record(event) {
            events.push(event);
        });
        const prepared = await prepareAdapterPlan(adapter, null, executionPlan());
        const result = await executeAdapterPlan(adapter, prepared.collect(prepared.testPlan), prepared.testPlan);
        scope.assert.deepEqual(events, [ 'validate', 'load', 'prepare', 'collect' ]);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.equal(result.runnerErrors.length, 1);
        scope.assert.includes(result.runnerErrors[0]?.message ?? '', 'Lowering failed.');
        return scope.assert.collect();
    }),
    test('rejects missing evidence from an adapter claiming success', async function (scope) {
        const plan = executionPlan();
        const adapter = evidenceAdapter(function (input) {
            return reportedRun(input, [], []);
        });
        const result = await checkAdapterEvidence(adapter, plan);
        scope.assert.equal(result.status, 'failed');
        scope.assert.includes(result.runnerErrors[0]?.message ?? '', 'incomplete work evidence');
        return scope.assert.collect();
    }),
    ...([ 'duplicate', 'unknown' ] as const).map(function (conflict) {
        return test(`rejects ${conflict} executable identities in checker evidence`, async function (scope) {
            const plan = executionPlan();
            const adapter = evidenceAdapter(function (input) {
                return reportedRun(input, conflictingEvidence(input, conflict), []);
            });
            const result = await checkAdapterEvidence(adapter, plan);
            scope.assert.equal(result.status, 'failed');
            scope.assert.equal(result.summary.passed, 0);
            scope.assert.includes(result.runnerErrors[0]?.message ?? '', 'duplicate or unknown work identities');
            return scope.assert.collect();
        });
    }),
    test('preserves native checker errors when case evidence is unavailable', async function (scope) {
        const failure: RunnerError = {
            subtype: 'loader',
            cause: null,
            message: 'Compiler failed.',
            diagnostics: [],
            attributedTo: null,
            attributedToWork: null,
            attributedToAttempt: null
        };
        const adapter = evidenceAdapter(function (input) {
            return reportedRun(input, [], [ failure ]);
        });
        const result = await checkAdapterEvidence(adapter, executionPlan());
        scope.assert.equal(result.status, 'failed');
        scope.assert.deepEqual(result.runnerErrors, [ failure ]);
        scope.assert.equal(result.artifacts.length, 1);
        return scope.assert.collect();
    }),
    test('rejects runtime-only requests before loading the checker', async function (scope) {
        const events: string[] = [];
        const adapter = failingAdapter(function record(event) {
            events.push(event);
        });
        const config = normalizeConfig({
            profiles: {
                types: {
                    testFamily: 'type-test',
                    files: { include: [ 'source/native.types.ts' ] },
                    adapter,
                    settings: null
                }
            }
        });
        const coordinator = createDeterministicRunCoordinator();
        const requests = [ { capture: 'live' }, { measureProcessUsage: true }, {
            timingCollection: 'precise'
        } ] as const;
        for (const request of requests) {
            await scope.assert.rejects(async function () {
                return coordinator.orchestrator.resolve({
                    config,
                    cwd: '/project',
                    engine: { kind: 'default' },
                    request: defaultRunRequest({ profile: 'types', paths: [ 'source/native.types.ts' ], ...request })
                });
            }, {
                message:
                    'Adapter profiles do not support runtime capture, debugging, process budgets, or precise timings.'
            });
        }
        scope.assert.equal(events.includes('load'), false);
        return scope.assert.collect();
    }),
    test('reports registered profiles through native runner events without invoking bodies', async function (scope) {
        const engine = createEngine();
        const reporter = createInMemoryRealTimeReporter();
        const adapter = evidenceAdapter(function (plan) {
            return reportedRun(plan, [ passingCase(plan) ], []);
        });
        const config = normalizeConfig({
            profiles: {
                types: {
                    testFamily: 'type-test',
                    files: { include: [ 'source/native.types.ts' ] },
                    adapter,
                    settings: null,
                    reporters: [ reporter ]
                }
            }
        });
        const coordinator = createDeterministicRunCoordinator();
        const delivery = await coordinator.runDirectEntrypoint({
            config,
            cwd: '/project',
            engine: { kind: 'instance', engine },
            request: defaultRunRequest({ profile: 'types', paths: [ 'source/native.types.ts' ] })
        }, {
            kind: 'direct-entrypoint',
            root: { annotations: {}, controls: {}, title: 'adapter' },
            testNode: authoredCase(engine)
        });
        scope.assert.deepEqual({
            status: delivery.result.status,
            passed: delivery.result.summary.passed,
            errors: delivery.result.runnerErrors,
            artifacts: delivery.result.artifacts.map(function (artifact) {
                return artifact.payload.kind;
            })
        }, { status: 'passed', passed: 1, errors: [], artifacts: [ 'adapter' ] });
        scope.assert.deepEqual(adapterRunFacts(reporter), { id: 'evidence', facts: null });
        scope.assert.deepEqual(
            reporter
                .getRecordedEntries()
                .filter(function (entry) {
                    return entry.type === 'event';
                })
                .map(function (entry) {
                    return entry.event?.kind;
                }),
            [ 'run-start', 'test-start', 'test-end', 'run-end' ]
        );
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
