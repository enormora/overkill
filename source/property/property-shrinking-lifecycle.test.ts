import { createDeterministicClock } from '@enormora/clock';
import { runIfMain } from '#test-runner';
import { createTimedTestEngine } from '../test-support/create-test-engine.ts';
import { resolveTestPlanCollectionPolicy } from '../run/run-test-plan.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import {
    createRoot,
    createTestPlan,
    serializeValue,
    type ExecuteOptions,
    type RunResult,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { property } from './property-authoring.ts';
import { gen } from './generators.ts';

async function executeShrinkDeadline(timeoutPolicy: NonNullable<ExecuteOptions['timeoutPolicy']>): Promise<RunResult> {
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const engine = createTimedTestEngine(clock);
    const node = property({
        title: 'deadline during shrinking',
        generator: gen.integer({ min: 0, max: 100 }),
        examples: [ function () {
            return 100;
        } ],
        test(value, sample) {
            if (value === 0) {
                clock.advanceByMilliseconds(
                    Math.min(timeoutPolicy.timeoutMilliseconds, timeoutPolicy.hardTimeoutMilliseconds)
                );
            }
            sample.assert.fail({ message: 'original failure before deadline' });
            return sample.assert.collect();
        }
    });
    const plan = resolveTestPlanCollectionPolicy(
        createTestPlan(createRoot({
            title: 'deadline',
            annotations: {},
            controls: {},
            children: [ node ]
        })),
        {
            testFamily: 'property',
            propertyPolicy: propertyExecutionDefaults.policy,
            timeoutMilliseconds: timeoutPolicy.timeoutMilliseconds
        }
    );
    return await engine.execute(plan, {
        execution: propertyExecutionDefaults.execution,
        propertyRun: { seed: 42n, projectRoot: process.cwd() },
        reporters: [],
        retryPolicy: null,
        runFacts: {},
        startedAt: '2026-10-29T00:00:00.000Z',
        timeoutPolicy
    });
}

function assertDeadlineEvidence(scope: TestScope, result: RunResult): void {
    const evidence = result.perTest[0]?.property?.invocations[0];
    scope.require.defined(evidence);
    scope.assert.equal(evidence.shrinkStatus, 'interrupted');
    scope.assert.equal(JSON.stringify(evidence.original.input), JSON.stringify(serializeValue(100)));
    scope.assert.includes(JSON.stringify(evidence.retained.failure), 'original failure before deadline');
}

export const testNode = suite('shrink lifecycle', [
    test('retains confirmed evidence when an engine deadline interrupts shrinking', async function (scope) {
        const result = await executeShrinkDeadline({ timeoutMilliseconds: 100, hardTimeoutMilliseconds: 10 });
        scope.assert.equal(result.summary.crashed, 1);
        assertDeadlineEvidence(scope, result);
        scope.assert.equal(
            JSON.stringify(result.perTest[0]?.property?.invocations[0]?.retained.input),
            JSON.stringify(serializeValue(100))
        );
        scope.assert.includes(JSON.stringify(result.runnerErrors), 'hard-timeout');
        return scope.assert.collect();
    }),
    test('retains matching evidence alongside the native soft timeout', async function (scope) {
        const result = await executeShrinkDeadline({ timeoutMilliseconds: 10, hardTimeoutMilliseconds: 100 });
        scope.assert.equal(result.summary.failed, 1);
        assertDeadlineEvidence(scope, result);
        scope.assert.includes(JSON.stringify(result.perTest[0]?.outcome), 'timeout');
        return scope.assert.collect();
    }),
    test(
        'retains the confirmed failure when a dependent shrink domain is exhausted',
        async function (scope: TestScope) {
            let calls = 0;
            const result = await executePropertyNode(
                property({
                    title: 'dependent shrink domain exhaustion',
                    settings: { maxSize: 1 },
                    generator: gen.boolean().flatMap(function bounded(flag) {
                        return gen.array(gen.constant(1), { minLength: flag ? 1 : 2, maxLength: flag ? 1 : 2 });
                    }),
                    test(_value, sample) {
                        calls += 1;
                        sample.assert.fail({ message: 'retained dependent failure' });
                        return sample.assert.collect();
                    }
                }),
                { ...propertyExecutionDefaults, seed: 43n }
            );
            const evidence = result.perTest[0]?.property?.invocations[0];
            scope.require.defined(evidence);
            scope.assert.equal(result.summary.failed, 1);
            scope.assert.equal(result.summary.inconclusive, 0);
            scope.assert.equal(calls, 2);
            scope.assert.equal(evidence.shrinkStatus, 'search-exhausted');
            scope.assert.equal(
                JSON.stringify(evidence.retained.input),
                JSON.stringify(serializeValue([ 1 ]))
            );
            return scope.assert.collect();
        }
    ),
    test('reconstructs mutable mapped inputs for confirmation and every candidate', async function (scope) {
        const seen: number[] = [];
        const result = await executePropertyNode(
            property({
                title: 'fresh shrinking inputs',
                generator: gen.integer({ min: 100, max: 1000 }).map(function fresh(value) {
                    return new Map([ [ 'value', value ] ]);
                }),
                test(input, sample) {
                    const value = input.get('value') ?? -1;
                    seen.push(value);
                    sample.assert.true(value < 100);
                    input.set('value', -1);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.true(seen.every(function valid(value) {
            return value >= 100;
        }));
        scope.assert.true(seen.length >= 2);
        scope.assert.equal(
            JSON.stringify(result.perTest[0]?.property?.invocations[0]?.retained.input),
            JSON.stringify(serializeValue(new Map([ [ 'value', 100 ] ])))
        );
        return scope.assert.collect();
    }),
    test('cleanup failure stops shrinking with its native outcome', async function (scope) {
        const seen: number[] = [];
        const result = await executePropertyNode(
            property({
                title: 'native cleanup',
                generator: gen.integer({ min: 0, max: 100 }),
                examples: [ function () {
                    return 100;
                } ],
                test(value, sample) {
                    seen.push(value);
                    sample.cleanup(function cleanup() {
                        if (value < 100) {
                            throw new Error('candidate cleanup failed');
                        }
                    });
                    sample.assert.fail({ message: 'original failure' });
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.deepEqual(seen, [ 100, 100, 0 ]);
        scope.assert.includes(JSON.stringify(result.perTest[0]?.outcome), 'cleanup-error');
        scope.assert.equal(
            JSON.stringify(result.perTest[0]?.property?.invocations[0]?.retained.input),
            JSON.stringify(serializeValue(100))
        );
        return scope.assert.collect();
    }),
    test('failure keys expire when the invocation completes', async function (scope) {
        let declareFailure: (key: string) => void = function () {
            throw new Error('Key setter was not captured.');
        };
        const result = await executePropertyNode(
            property({
                title: 'key lifetime',
                generator: gen.constant(1),
                test(value, sample) {
                    declareFailure = sample.failureKey;
                    sample.failureKey('trial');
                    sample.assert.equal(value, 1);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.throws(function expiredKey() {
            declareFailure('late');
        }, { message: 'Failure keys require a nonblank string within an active trial.' });
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
