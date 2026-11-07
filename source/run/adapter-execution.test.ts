import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import {
    createEngine,
    createRunResult,
    serializeValue,
    type TestPlan,
    type RunResult
} from '../packages/engine/engine.entry-point.ts';
import type { RunAdapterRegistration } from '../config/adapter-profile.ts';
import { executeAdapterPlan, prepareAdapterPlan } from './adapter-execution.ts';

function executionPlan(): TestPlan {
    const engine = createEngine();
    return engine.createTestPlan(engine.createRoot({
        annotations: {},
        controls: {},
        title: 'adapter',
        children: [ engine.createTestCase({
            annotations: {},
            controls: {},
            title: 'case',
            definitionLocations: [ { kind: 'unknown' } ],
            body() {
                throw new Error('Adapter execution must not invoke the runtime body.');
            }
        }) ]
    }));
}

function emptyEvidence(plan: TestPlan): RunResult {
    return createRunResult(plan, [], [], {
        startedAtMicroseconds: 0,
        completedAtMicroseconds: 0,
        testExecutionWallTimeMicroseconds: 0,
        processUsage: null,
        planStatus: 'planned'
    });
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
                    record('prepare');
                    return plan;
                },
                async collect() {
                    record('collect');
                    return {
                        facts: serializeValue('collected'),
                        async lower() {
                            throw new Error('Lowering failed.');
                        }
                    };
                }
            };
        }
    };
}

export const testNode = suite('generic adapter execution', [
    test('prepares through explicit registration and retains setup failures as runner errors', async function (scope) {
        const events: string[] = [];
        const adapter = failingAdapter(function record(event) {
            events.push(event);
        });
        const prepared = await prepareAdapterPlan(adapter, null, executionPlan());
        const result = await executeAdapterPlan(adapter, null, prepared);
        scope.assert.deepEqual(events, [ 'validate', 'load', 'prepare', 'validate', 'load', 'collect' ]);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.equal(result.runnerErrors.length, 1);
        scope.assert.includes(result.runnerErrors[0]?.message ?? '', 'Lowering failed.');
        return scope.assert.collect();
    }),
    test('rejects missing evidence from an adapter claiming success', async function (scope) {
        const plan = executionPlan();
        const adapter: RunAdapterRegistration = {
            id: 'empty',
            validate(settings) {
                if (settings !== null) {
                    throw new Error('Expected null settings.');
                }
            },
            async load() {
                return {
                    async prepare(input) {
                        return input;
                    },
                    async collect() {
                        return {
                            facts: serializeValue(null),
                            async lower() {
                                return {
                                    facts: serializeValue(null),
                                    async execute() {
                                        return emptyEvidence(plan);
                                    }
                                };
                            }
                        };
                    }
                };
            }
        };
        const result = await executeAdapterPlan(adapter, null, plan);
        scope.assert.equal(result.status, 'failed');
        scope.assert.includes(result.runnerErrors[0]?.message ?? '', 'incomplete work evidence');
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
