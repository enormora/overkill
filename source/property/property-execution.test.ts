import { runIfMain } from '#test-runner';
import { propertyErrorInputCodec } from '../test-support/property-error-input.ts';
import { readPropertyExecutionHost, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { property, withProperties } from './property-authoring.ts';
import { testNode as exploration } from './property-exploration.test.ts';
import { gen } from './generators.ts';
import { executeProperty } from './property-execution.ts';
import type { PropertyExecutionResult } from './property-execution-result.ts';

export const testNode = suite('property trial execution', [
    exploration,
    test('executes all five phases in order with independent accounting', async function (scope: TestScope) {
        const observed: number[] = [];
        const captured: PropertyExecutionResult<number>[] = [];
        const node = test(
            'phase driver',
            withProperties(async function (parent) {
                const host = readPropertyExecutionHost(parent);
                const result = await executeProperty(
                    {
                        coverage: [],
                        generator: gen.integer({ min: 1, max: 2 }),
                        examples: [ function () {
                            return -3;
                        } ],
                        test(value, sample) {
                            observed.push(value);
                            sample.assert.equal(typeof value, 'number');
                            return sample.assert.collect();
                        }
                    },
                    {
                        checkedIn: [ function () {
                            return -1;
                        } ],
                        localCache: [ function () {
                            return -2;
                        } ]
                    },
                    { host, signal: parent.signal, identity: 'phase-driver' }
                );
                captured.push(result);
                parent.assert.equal(result.kind, 'completed');
                return parent.assert.collect();
            })
        );
        const result = await executePropertyNode(node, {
            ...propertyExecutionDefaults,
            policy: { ...propertyExecutionDefaults.policy, maxAutomaticEdges: 2 }
        });
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.deepEqual(observed.slice(0, 5), [ -1, -2, -3, 1, 2 ]);
        scope.assert.equal(observed.length, 8);
        scope.assert.deepEqual(
            captured.map(function phaseCounts(actual) {
                return actual.accounting.phases;
            }),
            [ {
                'checked-in-corpus': { executed: 1, rejected: 0 },
                'local-cache': { executed: 1, rejected: 0 },
                examples: { executed: 1, rejected: 0 },
                'automatic-edges': { executed: 2, rejected: 0 },
                exhaustive: { executed: 0, rejected: 0 },
                exploration: { executed: 3, rejected: 0 },
                confirmation: { executed: 0, rejected: 0 },
                shrinking: { executed: 0, rejected: 0 }
            } ]
        );
        return scope.assert.collect();
    }),
    test('reconstructs examples and generated inputs before sequential cleanup', async function (scope) {
        const log: string[] = [];
        const node = property({
            title: 'fresh graphs',
            generator: gen
                .constant(null)
                .map(function () {
                    return { values: [ 1 ], owner: new TypeError('owned') };
                })
                .withCodec(propertyErrorInputCodec),
            examples: [ function () {
                return { values: [ 1 ], owner: new TypeError('owned') };
            } ],
            test(value, sample) {
                log.push('body');
                sample.assert.deepEqual(Array.from(value.values), [ 1 ]);
                sample.assert.instanceOf(value.owner, TypeError);
                value.values.push(2);
                sample.cleanup(async function finishSample() {
                    await Promise.resolve();
                    log.push('cleanup');
                });
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.deepEqual(log, [ 'body', 'cleanup', 'body', 'cleanup', 'body', 'cleanup', 'body', 'cleanup' ]);
        return scope.assert.collect();
    }),
    test('stops every later phase at the first failed example', async function (scope) {
        const seen: number[] = [];
        const node = property({
            title: 'first failure',
            generator: gen.integer({ min: 1, max: 2 }),
            examples: [ function () {
                return 0;
            }, function () {
                return 1;
            } ],
            test(value, sample) {
                seen.push(value);
                sample.assert.equal(value, 1);
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.deepEqual(seen, [ 0 ]);
        scope.assert.equal(result.summary.discovered, 1);
        scope.assert.equal(result.perTest.length, 1);
        return scope.assert.collect();
    }),
    test('reports unfinished required examples as inconclusive', async function (scope) {
        const seen: number[] = [];
        const node = property({
            title: 'bounded examples',
            generator: gen.constant<number>(1),
            examples: [ function () {
                return 1;
            }, function () {
                return 2;
            } ],
            settings: { maxWork: 7 },
            test(value, sample) {
                seen.push(value);
                sample.assert.true(value > 0);
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.inconclusive, 1);
        scope.assert.deepEqual(seen, [ 1 ]);
        scope.assert.includes(JSON.stringify(result.perTest), 'work budget exhausted');
        return scope.assert.collect();
    }),
    test('bounds impossible filters without treating rejection as a pass', async function (scope) {
        let evaluated = 0;
        const node = property({
            title: 'impossible',
            generator: gen.integer({ min: 0, max: 1 }).filter(function () {
                return false;
            }),
            settings: { maxWork: 30 },
            test(value, sample) {
                evaluated += 1;
                sample.assert.equal(value, 0);
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.inconclusive, 1);
        scope.assert.equal(evaluated, 0);
        return scope.assert.collect();
    }),
    test('accepts exactly completed work without charging an extra exploration pull', async function (scope) {
        let evaluations = 0;
        const node = property({
            title: 'exact budget',
            generator: gen.constant(1),
            settings: { newTrials: 1, maxWork: 11 },
            test(value, sample) {
                evaluations += 1;
                sample.assert.equal(value, 1);
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(evaluations, 1);
        return scope.assert.collect();
    }),
    test('distinguishes an exhausted domain from an exhausted work budget', async function (scope) {
        let evaluations = 0;
        const node = property({
            title: 'empty active domain',
            generator: gen.string({ minLength: 3, maxLength: 3 }),
            examples: [ function () {
                return 'abc';
            } ],
            settings: { maxSize: 2 },
            test(value, sample) {
                evaluations += 1;
                sample.assert.equal(value.length, 3);
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.inconclusive, 1);
        scope.assert.equal(evaluations, 1);
        scope.assert.includes(JSON.stringify(result.perTest), 'generation exhausted');
        return scope.assert.collect();
    }),
    test('keeps generator callback exceptions as errors instead of rejections', async function (scope) {
        const node = property({
            title: 'broken callback',
            generator: gen.constant(1).map<number>(function brokenMapping() {
                throw new TypeError('mapping failed');
            }),
            test(value, sample) {
                sample.assert.equal(value, 1);
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result.perTest), 'body-error');
        scope.assert.includes(JSON.stringify(result.perTest), 'mapping failed');
        return scope.assert.collect();
    }),
    test('counts repeated values as accepted exploration', async function (scope) {
        let evaluated = 0;
        const node = property({
            title: 'singleton',
            generator: gen.constant(7),
            test(value, sample) {
                evaluated += 1;
                sample.assert.equal(value, 7);
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(evaluated, propertyExecutionDefaults.policy.newTrials);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
