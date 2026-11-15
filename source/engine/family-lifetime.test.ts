import { suite, test } from '../packages/test/test.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import {
    defineTestFamily,
    defineReporter,
    type Engine,
    type FamilyExecuteOptions,
    type FamilyCollectionInput,
    type FamilyPreparation,
    type FamilyPreparationInput,
    type PreparedFamilyRun,
    type RunResult
} from '../packages/engine/engine.entry-point.ts';

const disposalSymbols: typeof Symbol & { readonly asyncDispose: typeof Symbol.asyncDispose; } = Symbol;
const asyncDispose: typeof Symbol.asyncDispose = disposalSymbols.asyncDispose;
const { signal } = new AbortController();
const options: FamilyExecuteOptions = {
    signal,
    debug: { mode: 'off' },
    execution: { mode: 'serial-in-process' },
    retryPolicy: null,
    reporters: [],
    runFacts: {},
    startedAt: '2026-01-01T00:00:00.000Z'
};

async function prepare(
    engine: Engine,
    backend: (input: FamilyPreparationInput<null>) => Promise<FamilyPreparation>
): Promise<PreparedFamilyRun> {
    const node = engine.createTestCase({
        title: 'check',
        definitionLocations: [ { kind: 'unknown' } ],
        annotations: {},
        controls: {},
        body() {
            throw new Error('Analysis body ran.');
        }
    });
    const root = engine.createRoot({
        title: 'root',
        annotations: {},
        controls: {},
        children: [ node ]
    });
    return await engine.prepareFamily({
        testPlan: engine.createTestPlan(root),
        settings: null,
        projectRoot: process.cwd(),
        signal,
        testFamily: defineTestFamily({
            id: '@example/lifetime',
            version: '1',
            module: null,
            features: { execution: 'analysis', processModels: [ 'in-process' ], profileOptions: [] },
            parseSettings() {
                return null;
            },
            async load() {
                return {
                    prepare: backend
                };
            }
        })
    });
}

function selection(prepared: PreparedFamilyRun): FamilyCollectionInput {
    return {
        workIds: prepared.testPlan.cases.map(function identity(testCase) {
            return testCase.workId;
        }),
        signal
    };
}

type ExecutionGate = {
    readonly engine: Engine;
    readonly entered: ReturnType<typeof Promise.withResolvers<AbortSignal>>;
    readonly release: ReturnType<typeof Promise.withResolvers<undefined>>;
    readonly observed: readonly string[];
    readonly backend: (input: FamilyPreparationInput<null>) => Promise<FamilyPreparation>;
};
type AbandonmentObservation = {
    readonly beforeCleanup: { readonly aborted: boolean; readonly events: readonly string[]; };
    readonly events: readonly string[];
    readonly status: RunResult['status'];
    readonly passed: number;
    readonly inconclusive: number;
};

function executionGate(): ExecutionGate {
    const entered = Promise.withResolvers<AbortSignal>();
    const release = Promise.withResolvers<undefined>();
    const observed: string[] = [];
    return {
        engine: createTestEngine(),
        entered,
        release,
        observed,
        async backend({ testPlan }: FamilyPreparationInput<null>): Promise<FamilyPreparation> {
            return {
                testPlan,
                facts: null,
                async collect() {
                    return {
                        kind: 'analysis',
                        facts: null,
                        async execute(context) {
                            entered.resolve(context.signal);
                            await release.promise;
                            observed.push('settled');
                        }
                    };
                },
                async dispose() {
                    observed.push('dispose');
                }
            };
        }
    };
}

async function abandonActiveExecution(): Promise<AbandonmentObservation> {
    const gate = executionGate();
    await using prepared = await prepare(gate.engine, gate.backend);
    const collected = await prepared.collect(selection(prepared));
    const executing = gate.engine.execute(collected, options);
    const activeSignal = await gate.entered.promise;
    const disposal = prepared[asyncDispose]();
    const beforeCleanup = { aborted: activeSignal.aborted, events: Array.from(gate.observed) };
    gate.release.resolve(undefined);
    const [ result ] = await Promise.all([ executing, disposal ]);
    return {
        beforeCleanup,
        events: gate.observed,
        status: result.status,
        passed: result.summary.passed,
        inconclusive: result.summary.inconclusive
    };
}

export const testNode = suite('family lifetime', [
    test('retains backend and cleanup failures together without repeating disposal', async function (scope) {
        const engine = createTestEngine();
        const failures = [ new Error('execution sentinel'), new Error('cleanup sentinel') ] as const;
        await using prepared = await prepare(engine, async function ({ testPlan }) {
            return {
                testPlan,
                facts: null,
                async collect() {
                    return {
                        kind: 'analysis',
                        facts: null,
                        async execute() {
                            throw failures[0];
                        }
                    };
                },
                async dispose() {
                    throw failures[1];
                }
            };
        });
        const collected = await prepared.collect(selection(prepared));
        const result = await engine.execute(collected, options);
        scope.assert.deepEqual(
            failures.map(function retainedCount(failure) {
                return result
                    .runnerErrors
                    .filter(function matchingCause(error) {
                        return error.cause === failure;
                    })
                    .length;
            }),
            [ 1, 1 ]
        );
        scope.assert.deepEqual([ result.status, result.summary.inconclusive ], [ 'failed', 1 ]);
        await prepared[asyncDispose]();
        return scope.assert.collect();
    }),
    ...[ false, true ].map(function abandonment(collected) {
        return test(`disposes abandoned preparation after collection ${String(collected)}`, async function (scope) {
            const engine = createTestEngine();
            const observed: string[] = [];
            await using prepared = await prepare(engine, async function ({ testPlan }) {
                return {
                    testPlan,
                    facts: null,
                    async collect() {
                        observed.push('collect');
                        return {
                            kind: 'analysis',
                            facts: null,
                            async execute() {
                                observed.push('execute');
                            }
                        };
                    },
                    async dispose() {
                        observed.push('dispose');
                    }
                };
            });
            const run = collected ? await prepared.collect(selection(prepared)) : null;
            await Promise.all([ prepared[asyncDispose](), prepared[asyncDispose]() ]);
            scope.assert.deepEqual(observed, collected ? [ 'collect', 'dispose' ] : [ 'dispose' ]);
            await scope.assert.rejects(async function () {
                await prepared.collect(selection(prepared));
            }, { message: /consumed or disposed/u });
            if (run !== null) {
                await scope.assert.rejects(async function () {
                    await engine.execute(run, options);
                }, { message: /consumed or disposed/u });
            }
            return scope.assert.collect();
        });
    }),
    test('abandonment cancels active execution and waits before cleanup', async function (scope) {
        scope.assert.deepEqual(await abandonActiveExecution(), {
            beforeCleanup: { aborted: true, events: [] },
            events: [ 'settled', 'dispose' ],
            status: 'failed',
            passed: 0,
            inconclusive: 1
        });
        return scope.assert.collect();
    }),
    test('rejects concurrent collection without cancelling the first call', async function (scope) {
        const release = Promise.withResolvers<undefined>();
        await using prepared = await prepare(createTestEngine(), async function backend({ testPlan }) {
            return {
                testPlan,
                facts: null,
                async collect() {
                    await release.promise;
                    return {
                        kind: 'analysis',
                        facts: null,
                        async execute() {
                            return undefined;
                        }
                    };
                },
                async dispose() {
                    return undefined;
                }
            };
        });
        const first = prepared.collect(selection(prepared));
        await scope.assert.rejects(async function () {
            await prepared.collect(selection(prepared));
        }, {
            message: /consumed or disposed/u
        });
        release.resolve(undefined);
        const collected = await first;
        scope.assert.equal(collected.testPlan.cases.length, 1);
        return scope.assert.collect();
    }),
    test('rejects concurrent execution without cancelling admitted work', async function (scope) {
        const engine = createTestEngine();
        const release = Promise.withResolvers<undefined>();
        await using prepared = await prepare(engine, async function backend({ testPlan }) {
            return {
                testPlan,
                facts: null,
                async collect() {
                    return {
                        kind: 'analysis',
                        facts: null,
                        async execute() {
                            await release.promise;
                        }
                    };
                },
                async dispose() {
                    return undefined;
                }
            };
        });
        const collected = await prepared.collect(selection(prepared));
        const first = engine.execute(collected, options);
        await scope.assert.rejects(async function () {
            await engine.execute(collected, options);
        }, {
            message: /consumed or disposed/u
        });
        release.resolve(undefined);
        await first;
        return scope.assert.collect();
    }),
    test('consumes collections, rejects foreign engines, and completes missing evidence', async function (scope) {
        const engine = createTestEngine();
        const observed: string[] = [];
        await using prepared = await prepare(engine, async function backend({ testPlan }) {
            return {
                testPlan,
                facts: null,
                async collect() {
                    return {
                        kind: 'analysis',
                        facts: null,
                        async execute() {
                            observed.push('execute');
                        }
                    };
                },
                async dispose() {
                    observed.push('dispose');
                }
            };
        });
        const collected = await prepared.collect(selection(prepared));
        await scope.assert.rejects(async function () {
            await createTestEngine().execute(collected, options);
        }, { message: /from this engine/u });
        const result = await engine.execute(collected, options);
        scope.assert.deepEqual([ result.status, result.summary.inconclusive, result.runnerErrors.length ], [
            'failed',
            1,
            1
        ]);
        await scope.assert.rejects(async function () {
            await engine.execute(collected, options);
        }, {
            message: /consumed or disposed/u
        });
        scope.assert.deepEqual(observed, [ 'execute', 'dispose' ]);
        return scope.assert.collect();
    }),
    test('awaits active collection before disposing once', async function (scope) {
        const release = Promise.withResolvers<undefined>();
        const observed: string[] = [];
        await using prepared = await prepare(createTestEngine(), async function backend({ testPlan }) {
            return {
                testPlan,
                facts: null,
                async collect(input) {
                    await release.promise;
                    observed.push(input.signal.aborted ? 'aborted' : 'running');
                    return {
                        kind: 'analysis',
                        facts: null,
                        async execute() {
                            return undefined;
                        }
                    };
                },
                async dispose() {
                    observed.push('dispose');
                }
            };
        });
        const rejected = scope.assert.rejects(async function () {
            await prepared.collect(selection(prepared));
        }, { message: /abort/iu });
        const disposal = prepared[asyncDispose]();
        scope.assert.deepEqual(Array.from(observed), []);
        release.resolve(undefined);
        await Promise.all([ rejected, disposal ]);
        scope.assert.deepEqual(observed, [ 'aborted', 'dispose' ]);
        return scope.assert.collect();
    }),
    test('delivers cleanup failures before final reporting without redelivery', async function (scope) {
        const engine = createTestEngine();
        const failure = new Error('cleanup failed');
        const observed: string[] = [];
        await using prepared = await prepare(engine, async function backend({ testPlan }) {
            return {
                testPlan,
                facts: null,
                async collect() {
                    return {
                        kind: 'analysis',
                        facts: null,
                        async execute() {
                            return undefined;
                        }
                    };
                },
                async dispose() {
                    observed.push('dispose');
                    throw failure;
                }
            };
        });
        const collected = await prepared.collect(selection(prepared));
        const reporter = defineReporter(function () {
            return {
                kind: 'final-result',
                name: 'lifetime',
                sinks: [ { kind: 'memory' } ],
                dispose: null,
                onResult(result) {
                    observed.push('result');
                    scope.assert.equal(
                        result.runnerErrors.some(function cleanup(error) {
                            return error.cause === failure;
                        }),
                        true
                    );
                }
            };
        });
        const result = await engine.execute(collected, { ...options, reporters: [ reporter ] });
        await prepared[asyncDispose]();
        scope.assert.deepEqual([ result.status, observed ], [ 'failed', [ 'dispose', 'result' ] ]);
        return scope.assert.collect();
    })
]);
