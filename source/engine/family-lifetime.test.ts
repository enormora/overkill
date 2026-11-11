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
    type PreparedFamilyRun
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

export const testNode = suite('family lifetime', [
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
