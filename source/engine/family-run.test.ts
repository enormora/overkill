import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import {
    defineReporter,
    defineTestFamily,
    singleAttemptResult,
    type DefinedReporter,
    type Engine,
    type FamilyAnalysisContext,
    type FamilyCollectionInput,
    type FamilyExecuteOptions,
    type FamilyPreparation,
    type FamilyPreparationInput,
    type PreparedFamilyRun,
    type ReporterEvent,
    type RunArtifact,
    type RunResult,
    type TestFamily,
    type TestPlan,
    type TestScope,
    type WorkId
} from '../packages/engine/engine.entry-point.ts';
import { testNode as lifetimeTests } from './family-lifetime.test.ts';
import { testNode as evidenceValidation } from './family-evidence-validation.test.ts';
import { testNode as preparationValidation } from './family-preparation-validation.test.ts';
import { withCaseExecutionLifecycle } from './case-execution-lifecycle.ts';

const controller = new AbortController();
const { signal } = controller;
const location = { kind: 'unknown' } as const;
const nodeOptions = { definitionLocations: [ location ] as const, annotations: {}, controls: {} };
const options: FamilyExecuteOptions = {
    debug: { mode: 'off' },
    signal,
    execution: { mode: 'serial-in-process' },
    retryPolicy: null,
    reporters: [],
    runFacts: {},
    startedAt: '2026-01-01T00:00:00.000Z'
};

function createPlan(engine: Engine, body: Parameters<Engine['createTestCase']>[0]['body']): TestPlan {
    return engine.createTestPlan(engine.createRoot({
        ...nodeOptions,
        title: 'root',
        children: [
            engine.createTestCase({ ...nodeOptions, title: 'check', body }),
            engine.createSkippedTestCase({ ...nodeOptions, title: 'skip', reason: 'authored' })
        ]
    }));
}

function evidenceArtifact(workId: WorkId): RunArtifact {
    return {
        id: {
            scope: { kind: 'case', case: workId.case, activeCases: [ workId.case ], confidence: 'active-case' },
            runtimes: workId.runtimes,
            workload: workId.workload,
            familyVariant: workId.familyVariant,
            sequence: 0,
            subtype: 'adapter',
            attempt: { index: 0 }
        },
        payload: { kind: 'adapter', adapter: '@example/analysis', facts: null },
        source: 'native'
    };
}

function completedAnalysis(
    input: FamilyPreparationInput<null>,
    observe: (value: string) => unknown,
    badEvidence: boolean
): FamilyPreparation {
    const testPlan = input.expandVariants([ { key: 'one', facts: null }, { key: 'two', facts: null } ]);
    return {
        testPlan,
        facts: { prepared: true },
        async collect({ workIds }: FamilyCollectionInput) {
            for (const id of workIds) {
                observe(id.familyVariant?.key ?? '');
            }
            return {
                kind: 'analysis' as const,
                facts: { collected: workIds.length },
                async execute({ report }: FamilyAnalysisContext) {
                    for (const workId of workIds.toReversed()) {
                        await report({ kind: 'case-start', workId });
                        if (badEvidence) {
                            await report({ kind: 'case-start', workId });
                        }
                        await report({ kind: 'case-progress', workId, note: 'checked' });
                        await report({
                            kind: 'case-end',
                            result: singleAttemptResult({
                                id: workId.case,
                                workId,
                                definitionLocations: [ location ],
                                outcome: { kind: 'pass' },
                                verdict: 'pass',
                                durationMicroseconds: 3
                            }, { index: 0 }),
                            artifacts: [ evidenceArtifact(workId) ]
                        });
                    }
                }
            };
        },
        async dispose() {
            observe('disposed');
        }
    };
}

function analysisFamily(observe: (value: string) => unknown, badEvidence: boolean): TestFamily<null> {
    return defineTestFamily({
        id: '@example/analysis',
        version: '1',
        module: null,
        features: { execution: 'analysis', processModels: [ 'in-process' ], profileOptions: [] },
        parseSettings(value) {
            if (value !== null) {
                throw new TypeError('Invalid settings.');
            }
            observe('parsed');
            return null;
        },
        async load() {
            observe('loaded');
            return {
                async prepare(input) {
                    return completedAnalysis(input, observe, badEvidence);
                }
            };
        }
    });
}

function recordEvents(record: (event: ReporterEvent) => unknown): DefinedReporter {
    return defineReporter(function () {
        return {
            kind: 'real-time',
            name: 'family evidence',
            sinks: [ { kind: 'memory' } ],
            onFinish: null,
            dispose: null,
            onEvent(event) {
                record(event);
            }
        };
    });
}

function analysisPlan(engine: Engine): TestPlan {
    return createPlan(engine, function () {
        throw new Error('Analysis invoked a runtime body.');
    });
}

async function prepareAnalysis(
    engine: Engine,
    observe: (value: string) => unknown,
    badEvidence: boolean
): Promise<PreparedFamilyRun> {
    return engine.prepareFamily({
        testPlan: analysisPlan(engine),
        testFamily: analysisFamily(observe, badEvidence),
        settings: null,
        projectRoot: process.cwd(),
        signal
    });
}

function assertAnalysisResults(
    scope: TestScope,
    result: RunResult,
    workIds: readonly WorkId[],
    events: readonly ReporterEvent[]
): void {
    scope.assert.equal(result.status, 'passed');
    scope.assert.deepEqual(
        result.artifacts.map(function variant(artifact) {
            return artifact.id.familyVariant?.key;
        }),
        [ 'one', 'two' ]
    );
    scope.assert.deepEqual(
        result.perTest.map(function work(entry) {
            return entry.workId;
        }),
        workIds
    );
    scope.assert.deepEqual(
        result.perTest.map(function verdict(entry) {
            return entry.verdict;
        }),
        [ 'skip', 'skip', 'pass', 'pass' ]
    );
    scope.assert.deepEqual(
        events.flatMap(function start(event) {
            return event.kind === 'test-start' && event.case.title === 'check'
                ? [ event.workId?.familyVariant?.key ]
                : [];
        }),
        [ 'one', 'two' ]
    );
}

async function assertSkippedSelection(scope: TestScope, engine: Engine, prepared: PreparedFamilyRun): Promise<void> {
    const workIds = prepared.testPlan.cases.flatMap(function skip(testCase) {
        return testCase.execution.kind === 'skip' ? [ testCase.workId ] : [];
    });
    const collected = await prepared.collect({ workIds, signal });
    const result = await engine.execute(collected, options);
    scope.assert.equal(result.summary.skipped, 2);
    scope.assert.equal(collected.facts.collection, null);
}

function runtimeFamily(): TestFamily<null> {
    return defineTestFamily({
        id: '@example/runtime',
        version: '1',
        module: null,
        features: { execution: 'runtime', processModels: [ 'in-process' ], profileOptions: [] },
        parseSettings() {
            return null;
        },
        async load() {
            return {
                async prepare(input) {
                    return {
                        testPlan: input.testPlan,
                        facts: null,
                        async collect() {
                            return { kind: 'runtime', facts: null };
                        },
                        async dispose() {
                            return undefined;
                        }
                    };
                }
            };
        }
    });
}

export const testNode = suite('engine family runs', [
    lifetimeTests,
    preparationValidation,
    evidenceValidation,
    test('collects exact variant work and reports analysis in execution order', async function (scope) {
        const engine = createTestEngine();
        const observed: string[] = [];
        const events: ReporterEvent[] = [];
        await using prepared = await prepareAnalysis(engine, observed.push.bind(observed), false);
        const workIds = prepared
            .testPlan
            .cases
            .map(function work(testCase) {
                return testCase.workId;
            })
            .toReversed();
        const collected = await prepared.collect({ workIds, signal });
        const result = await engine.execute(collected, {
            ...options,
            reporters: [ recordEvents(events.push.bind(events)) ]
        });
        scope.assert.deepEqual(Array.from(observed), [ 'parsed', 'loaded', 'two', 'one', 'disposed' ]);
        assertAnalysisResults(scope, result, workIds, events);
        return scope.assert.collect();
    }),
    ...[ 'duplicate', 'unknown' ].map(function invalidSelection(kind) {
        return test(`rejects ${kind} work IDs before backend collection`, async function (scope) {
            const engine = createTestEngine();
            const observed: string[] = [];
            await using prepared = await prepareAnalysis(engine, observed.push.bind(observed), false);
            const { workId } = prepared.testPlan.cases[0];
            const workIds = kind === 'duplicate' ? [ workId, workId ] : [ { ...workId, familyVariant: null } ];
            await scope.assert.rejects(async function () {
                await prepared.collect({ workIds, signal });
            }, {
                message: /unknown or duplicate/u
            });
            scope.assert.deepEqual(observed, [ 'parsed', 'loaded', 'disposed' ]);
            return scope.assert.collect();
        });
    }),
    test('invalid selection disposes preparation and prevents reuse', async function (scope) {
        const engine = createTestEngine();
        const observed: string[] = [];
        await using prepared = await prepareAnalysis(engine, observed.push.bind(observed), false);
        await scope.assert.rejects(async function () {
            await prepared.collect({ workIds: [], signal });
        }, { message: /at least one/u });
        await scope.assert.rejects(async function () {
            await prepared.collect({ workIds: [ prepared.testPlan.cases[0].workId ], signal });
        }, { message: /consumed or disposed/u });
        scope.assert.deepEqual(observed, [ 'parsed', 'loaded', 'disposed' ]);
        return scope.assert.collect();
    }),
    test('bypasses backend collection for authored skips', async function (scope) {
        const engine = createTestEngine();
        const observed: string[] = [];
        await using prepared = await prepareAnalysis(engine, observed.push.bind(observed), false);
        await assertSkippedSelection(scope, engine, prepared);
        scope.assert.deepEqual(observed, [ 'parsed', 'loaded', 'disposed' ]);
        return scope.assert.collect();
    }),
    test('retains valid completion after evidence and reporter errors', async function (scope) {
        const engine = createTestEngine();
        await using prepared = await prepareAnalysis(engine, function () {
            return undefined;
        }, true);
        const collected = await prepared.collect({ workIds: [ prepared.testPlan.cases[0].workId ], signal });
        const reporter = recordEvents(function rejectProgress(event) {
            if (event.kind === 'test-progress') {
                throw new Error('Reporter could not display progress.');
            }
        });
        const result = await engine.execute(collected, { ...options, reporters: [ reporter ] });
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.deepEqual(
            result.runnerErrors.map(function subtype(error) {
                return error.subtype;
            }),
            [ 'runtime-state', 'reporter' ]
        );
        return scope.assert.collect();
    }),
    test('retains only observed runtime results when execution policy stops admission', async function (scope) {
        const engine = createTestEngine();
        const executed: string[] = [];
        const testPlan = engine.createTestPlan(engine.createRoot({
            ...nodeOptions,
            title: 'root',
            children: [ 'first', 'second' ].map(function failingCase(title) {
                return engine.createTestCase({
                    ...nodeOptions,
                    title,
                    body(caseScope) {
                        executed.push(title);
                        caseScope.assert.fail({ message: 'mutant killed' });
                        return caseScope.assert.collect();
                    }
                });
            })
        }));
        await using prepared = await engine.prepareFamily({
            testPlan,
            testFamily: runtimeFamily(),
            settings: null,
            projectRoot: process.cwd(),
            signal
        });
        const collected = await prepared.collect({
            workIds: prepared.testPlan.cases.map(function (testCase) {
                return testCase.workId;
            }),
            signal
        });
        const result = await withCaseExecutionLifecycle({
            async enter() {
                return undefined;
            },
            async complete() {
                return 'stop';
            }
        }, async function executeUntilStopped() {
            return await engine.execute(collected, options);
        });
        scope.assert.deepEqual({
            executed,
            titles: result.perTest.map(function caseTitle(entry) {
                return entry.id.title;
            }),
            planned: result.summary.planned,
            failed: result.summary.failed,
            inconclusive: result.summary.inconclusive,
            skipped: result.summary.skipped,
            errors: result.runnerErrors
        }, {
            executed: [ 'first' ],
            titles: [ 'first' ],
            planned: 2,
            failed: 1,
            inconclusive: 0,
            skipped: 0,
            errors: []
        });
        return scope.assert.collect();
    }),
    test('cancels active runtime scopes without claiming a pass', async function (scope) {
        const engine = createTestEngine();
        const abort = new AbortController();
        const testPlan = createPlan(engine, function body(caseScope) {
            abort.abort('stop runtime');
            caseScope.assert.equal(caseScope.signal.aborted, true);
            return caseScope.assert.collect();
        });
        await using prepared = await engine.prepareFamily({
            testPlan,
            testFamily: runtimeFamily(),
            settings: null,
            projectRoot: process.cwd(),
            signal
        });
        const collected = await prepared.collect({ workIds: [ prepared.testPlan.cases[0].workId ], signal });
        const result = await engine.execute(collected, { ...options, signal: abort.signal });
        scope.assert.deepEqual([ result.status, result.summary.inconclusive, result.runnerErrors[0]?.cause ], [
            'failed',
            1,
            'stop runtime'
        ]);
        return scope.assert.collect();
    }),
    test('keeps cooperative abort throws out of assertion failures', async function (scope) {
        const engine = createTestEngine();
        const abort = new AbortController();
        const testPlan = createPlan(engine, function body(caseScope) {
            abort.abort('stop runtime');
            throw caseScope.signal.reason;
        });
        await using prepared = await engine.prepareFamily({
            testPlan,
            testFamily: runtimeFamily(),
            settings: null,
            projectRoot: process.cwd(),
            signal
        });
        const collected = await prepared.collect({ workIds: [ prepared.testPlan.cases[0].workId ], signal });
        const result = await engine.execute(collected, { ...options, signal: abort.signal });
        scope.assert.deepEqual([ result.status, result.summary.inconclusive, result.runnerErrors[0]?.cause ], [
            'failed',
            1,
            'stop runtime'
        ]);
        return scope.assert.collect();
    }),
    test('executes collected runtime bodies through the ordinary engine', async function (scope) {
        const engine = createTestEngine();
        const testPlan = createPlan(engine, function (caseScope) {
            caseScope.assert.fail({ message: 'ordinary assertion' });
            return caseScope.assert.collect();
        });
        const testFamily = runtimeFamily();
        await using prepared = await engine.prepareFamily({
            testPlan,
            testFamily,
            settings: null,
            projectRoot: process.cwd(),
            signal
        });
        const collected = await prepared.collect({ workIds: [ prepared.testPlan.cases[0].workId ], signal });
        const result = await engine.execute(collected, options);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.perTest[0]?.outcome?.kind, 'fail');
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
