import { suite, test } from '../packages/test/test.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import {
    defineTestFamily,
    defineReporter,
    singleAttemptResult,
    type AdapterArtifact,
    type Engine,
    type FamilyAnalysisContext,
    type FamilyCollection,
    type FamilyEvent,
    type FamilyExecuteOptions,
    type PerTestResult,
    type RunnerError,
    type RunResult,
    type TestFamily,
    type TestOutcome,
    type TestPlan,
    type WorkId
} from '../packages/engine/engine.entry-point.ts';

const locations = [ { kind: 'unknown' } ] as const;
const nodeOptions = { definitionLocations: locations, annotations: {}, controls: {} };
const controller = new AbortController();
const options: FamilyExecuteOptions = {
    debug: { mode: 'off' },
    signal: controller.signal,
    execution: { mode: 'serial-in-process' },
    retryPolicy: null,
    reporters: [],
    runFacts: {},
    startedAt: '2026-01-01T00:00:00.000Z'
};

type Analyze = (context: FamilyAnalysisContext, work: WorkId) => Promise<void>;

function plan(engine: Engine): TestPlan {
    const testCase = engine.createTestCase({
        ...nodeOptions,
        title: 'static case',
        body() {
            throw new Error('Analysis should not execute this body.');
        }
    });
    return engine.createTestPlan(engine.createRoot({ ...nodeOptions, title: 'root', children: [ testCase ] }));
}

function analysisCollection(execute: Analyze, workId: WorkId): FamilyCollection {
    return {
        kind: 'analysis',
        facts: null,
        async execute(context) {
            await execute(context, workId);
        }
    };
}

function analysisFamily(execute: Analyze, workId: WorkId): TestFamily<null> {
    return defineTestFamily({
        id: '@example/analysis-evidence',
        version: '1',
        module: null,
        features: { execution: 'analysis', processModels: [ 'in-process' ], profileOptions: [] },
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
                            return analysisCollection(execute, workId);
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

async function analyze(execute: Analyze, executionOptions: FamilyExecuteOptions): Promise<RunResult> {
    const engine = createTestEngine();
    const testPlan = plan(engine);
    const { workId } = testPlan.cases[0];
    const testFamily = analysisFamily(execute, workId);
    await using prepared = await engine.prepareFamily({
        testPlan,
        testFamily,
        settings: null,
        projectRoot: process.cwd(),
        signal: controller.signal
    });
    const collected = await prepared.collect({ workIds: [ workId ], signal: controller.signal });
    return await engine.execute(collected, executionOptions);
}

function resultFor(workId: WorkId, outcome: TestOutcome): PerTestResult {
    return singleAttemptResult({
        id: workId.case,
        workId,
        definitionLocations: locations,
        outcome,
        verdict: outcome.kind,
        durationMicroseconds: 1
    }, { index: 0 });
}

function artifact(workId: WorkId): AdapterArtifact {
    return {
        id: {
            attempt: { index: 0 },
            scope: { kind: 'case', case: workId.case, confidence: 'active-case', activeCases: [ workId.case ] },
            familyVariant: workId.familyVariant,
            runtimes: workId.runtimes,
            sequence: 1,
            subtype: 'adapter',
            workload: workId.workload
        },
        payload: { kind: 'adapter', adapter: '@example/evidence', facts: null },
        source: 'native'
    };
}

function reportedError(): RunnerError {
    return {
        attributedTo: null,
        attributedToAttempt: null,
        cause: null,
        diagnostics: [],
        message: 'Project diagnostics were incomplete.',
        subtype: 'runtime-state'
    };
}

async function reportRunEvidence(context: FamilyAnalysisContext, workId: WorkId): Promise<void> {
    const { report } = context;
    const caseArtifact = artifact(workId);
    await report({ kind: 'run-error', error: reportedError() });
    await report({
        kind: 'artifact',
        artifact: {
            ...caseArtifact,
            id: { ...caseArtifact.id, attempt: null, scope: { kind: 'run' } }
        }
    });
    await report({ kind: 'case-start', workId });
    await report({ kind: 'case-end', result: resultFor(workId, { kind: 'pass' }), artifacts: [] });
}

async function reportInvalidArtifactEvidence(context: FamilyAnalysisContext, workId: WorkId): Promise<void> {
    const { report } = context;
    const caseArtifact = artifact(workId);
    await report({ kind: 'artifact', artifact: caseArtifact });
    await report({ kind: 'case-start', workId });
    await report({ kind: 'artifact', artifact: caseArtifact });
    await report({ kind: 'artifact', artifact: caseArtifact });
    await report({
        kind: 'case-end',
        result: { ...resultFor(workId, { kind: 'pass' }), id: { ...workId.case, title: 'wrong case' } },
        artifacts: []
    });
    await report({ kind: 'case-end', result: resultFor(workId, { kind: 'pass' }), artifacts: [] });
}

export const testNode = suite('family evidence validation', [
    test('preserves completed evidence when the backend subsequently cancels', async function (scope) {
        const abort = new AbortController();
        const result = await analyze(async function ({ report }, workId) {
            await report({ kind: 'case-start', workId });
            await report({ kind: 'case-end', result: resultFor(workId, { kind: 'pass' }), artifacts: [] });
            abort.abort('cancel after evidence');
        }, { ...options, signal: abort.signal });
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.summary.inconclusive, 0);
        scope.assert.equal(result.runnerErrors[0]?.cause, 'cancel after evidence');
        return scope.assert.collect();
    }),
    test('awaits reporter delivery before accepting later evidence', async function (scope) {
        const gate = { entered: Promise.withResolvers<undefined>(), release: Promise.withResolvers<undefined>() };
        const observed: string[] = [];
        const reporter = defineReporter(function () {
            return {
                kind: 'real-time',
                name: 'backpressure',
                sinks: [ { kind: 'memory' } ],
                dispose: null,
                onFinish: null,
                async onEvent(event) {
                    if (event.kind === 'test-start') {
                        observed.push('start');
                        gate.entered.resolve(undefined);
                        await gate.release.promise;
                    } else if (event.kind === 'test-end') {
                        observed.push('end');
                    }
                }
            };
        });
        const execution = analyze(async function ({ report }, workId) {
            await report({ kind: 'case-start', workId });
            observed.push('start-delivered');
            await report({ kind: 'case-end', result: resultFor(workId, { kind: 'pass' }), artifacts: [] });
        }, { ...options, reporters: [ reporter ] });
        await gate.entered.promise;
        scope.assert.deepEqual(Array.from(observed), [ 'start' ]);
        gate.release.resolve(undefined);
        const result = await execution;
        scope.assert.deepEqual({ events: observed, status: result.status }, {
            events: [ 'start', 'start-delivered', 'end' ],
            status: 'passed'
        });
        return scope.assert.collect();
    }),
    ...[
        'progress-before-start',
        'end-before-start',
        'duplicate-start',
        'duplicate-end',
        'unknown',
        'variant',
        'attempt',
        'contradiction'
    ]
        .map(function invalidSequence(scenario) {
            return test(`rejects ${scenario} independently without losing valid evidence`, async function (scope) {
                const result = await analyze(async function ({ report }, workId) {
                    const start: FamilyEvent = { kind: 'case-start', workId };
                    const end: FamilyEvent = {
                        kind: 'case-end',
                        result: resultFor(workId, { kind: 'pass' }),
                        artifacts: []
                    };
                    const sequences: Readonly<Record<string, readonly FamilyEvent[]>> = {
                        'progress-before-start': [ { kind: 'case-progress', workId, note: 'too early' }, start, end ],
                        'end-before-start': [ end, start, end ],
                        'duplicate-start': [ start, start, end ],
                        'duplicate-end': [ start, end, end ],
                        attempt: [ start, {
                            ...end,
                            result: {
                                ...end.result,
                                attempts: [ {
                                    ...end
                                        .result
                                        .attempts[0],
                                    attempt: { index: 1 }
                                } ]
                            }
                        }, end ],
                        contradiction: [ start, { ...end, result: { ...end.result, verdict: 'fail' } }, end ],
                        unknown: [
                            {
                                kind: 'case-start',
                                workId: { ...workId, case: { ...workId.case, title: 'unselected' } }
                            },
                            start,
                            end
                        ],
                        variant: [
                            {
                                kind: 'case-start',
                                workId: {
                                    ...workId,
                                    familyVariant: { family: '@example/analysis-evidence', key: 'unselected' }
                                }
                            },
                            start,
                            end
                        ]
                    };
                    const events = sequences[scenario] ?? [];
                    for (const event of events) {
                        await report(event);
                    }
                }, options);
                scope.assert.equal(result.status, 'failed');
                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.summary.inconclusive, 0);
                scope.assert.equal(result.runnerErrors.length, 1);
                scope.assert.equal(result.runnerErrors[0]?.subtype, 'runtime-state');
                return scope.assert.collect();
            });
        }),
    ...[ 'run-end', 'finish', 'result', 'dispose' ].map(function reporterFailure(phase) {
        return test(`retains analysis evidence after reporter ${phase} failure`, async function (scope) {
            const failure = new Error(`reporter ${phase} sentinel`);
            const observed: string[] = [];
            const reporter = defineReporter(function () {
                const shared = {
                    name: 'failing analysis reporter',
                    sinks: [ { kind: 'memory' } ] as const,
                    dispose() {
                        observed.push('dispose');
                        if (phase === 'dispose') {
                            throw failure;
                        }
                    }
                };
                if (phase === 'result') {
                    return {
                        ...shared,
                        kind: 'final-result',
                        onResult() {
                            observed.push('result');
                            throw failure;
                        }
                    };
                }
                return {
                    ...shared,
                    kind: 'real-time',
                    onEvent(event) {
                        if (event.kind === 'run-end') {
                            observed.push('run-end');
                            if (phase === 'run-end') {
                                throw failure;
                            }
                        }
                    },
                    onFinish() {
                        observed.push('finish');
                        if (phase === 'finish') {
                            throw failure;
                        }
                    }
                };
            });
            const result = await analyze(async function ({ report }, workId) {
                await report({ kind: 'case-start', workId });
                await report({ kind: 'case-end', result: resultFor(workId, { kind: 'pass' }), artifacts: [] });
            }, { ...options, reporters: [ reporter ] });
            scope.assert.equal(result.status, 'failed');
            scope.assert.equal(result.summary.passed, 1);
            scope.assert.deepEqual(
                result.runnerErrors.map(function deliveryError(error) {
                    return { subtype: error.subtype, cause: error.cause };
                }),
                [ { subtype: 'reporter', cause: failure } ]
            );
            scope.assert.deepEqual(
                observed,
                phase === 'result' ? [ 'result', 'dispose' ] : [ 'run-end', 'finish', 'dispose' ]
            );
            return scope.assert.collect();
        });
    }),
    test('retains run artifacts and declared run errors without attributing them to the case', async function (scope) {
        const result = await analyze(reportRunEvidence, options);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.deepEqual(
            result.artifacts.map(function scopeKind(entry) {
                return entry.id.scope.kind;
            }),
            [ 'run' ]
        );
        scope.assert.deepEqual(
            result.runnerErrors.map(function message(error) {
                return error.message;
            }),
            [ 'Project diagnostics were incomplete.' ]
        );
        return scope.assert.collect();
    }),
    test('rejects inactive and duplicate artifacts and mismatched case identities', async function (scope) {
        const result = await analyze(reportInvalidArtifactEvidence, options);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.artifacts.length, 1);
        scope.assert.deepEqual(
            result.runnerErrors.map(function message(error) {
                return error.message;
            }),
            [
                'Analysis artifact does not belong to active selected work.',
                'Duplicate analysis artifact.',
                'Analysis completion identity does not match the selected work.'
            ]
        );
        return scope.assert.collect();
    }),
    test('retains no-assertions as a case failure', async function (scope) {
        const result = await analyze(async function (context, workId) {
            const { report } = context;
            const outcome: TestOutcome = {
                kind: 'fail',
                failures: [ {
                    kind: 'test-contract',
                    code: 'no-assertions',
                    actual: 0,
                    expected: 'at least one assertion',
                    summary: 'No static assertions found.'
                } ]
            };
            await report({ kind: 'case-start', workId });
            await report({ kind: 'case-end', result: resultFor(workId, outcome), artifacts: [] });
        }, options);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.deepEqual(result.runnerErrors, []);
        return scope.assert.collect();
    }),
    test('rejects a property runtime policy before entering analysis', async function (scope) {
        await scope.assert.rejects(async function () {
            await analyze(async function () {
                throw new Error('Analysis should not begin with invalid options.');
            }, { ...options, propertyRun: { projectRoot: null, seed: 0n } });
        }, { message: /does not support runtime execution policy/u });
        return scope.assert.collect();
    }),
    test('rejects late evidence and retains incomplete results', async function (scope) {
        const captured = Promise.withResolvers<FamilyAnalysisContext>();
        const result = await analyze(async function (context) {
            captured.resolve(context);
        }, options);
        const context = await captured.promise;
        await scope.assert.rejects(async function () {
            await context.report({
                kind: 'run-error',
                error: {
                    subtype: 'runtime-state',
                    cause: null,
                    diagnostics: [],
                    attributedTo: null,
                    attributedToAttempt: null,
                    message: 'late'
                }
            });
        }, { message: /already settled/u });
        scope.assert.deepEqual([ result.status, result.summary.inconclusive, result.runnerErrors.length ], [
            'failed',
            1,
            1
        ]);
        return scope.assert.collect();
    }),
    test('preserves an analysis abort reason as a run error', async function (scope) {
        const abort = new AbortController();
        abort.abort('checker stopped');
        const result = await analyze(async function ({ signal }) {
            signal.throwIfAborted();
        }, { ...options, signal: abort.signal });
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.equal(result.runnerErrors[0]?.cause, 'checker stopped');
        return scope.assert.collect();
    })
]);
