import { once } from 'node:events';
import { runIfMain } from '#test-runner';
import { defineCompositeAssertion } from '../packages/assert/assert.entry-point.ts';
import type { AssertionResult, TestScope } from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { testNode as shrinking } from './property-shrinking.test.ts';
import type { PropertyForall, PropertySampleScope } from './property-definition.ts';
import { property, withProperties } from './property-authoring.ts';
import { gen } from './generators.ts';

export const testNode = suite('property trial scopes', [
    shrinking,
    test('stops at a sample assertion-plan mismatch', async function (scope) {
        const values: number[] = [];
        const node = property({
            title: 'sample plan',
            generator: gen.constant(1),
            test(value, sample) {
                values.push(value);
                sample.plan(2);
                sample.assert.equal(value, 1);
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result.perTest), 'plan-mismatch');
        scope.assert.deepEqual(values, [ 1 ]);
        return scope.assert.collect();
    }),
    test('rejects malformed nested invocation definitions', async function (scope) {
        for (const definition of [ gen.constant(1), { generator: gen.constant(1), test: null } ]) {
            const node = test(
                'invalid nested invocation',
                withProperties(async function (parent) {
                    await Reflect.apply(parent.forall, parent, [ definition ]);
                    return parent.assert.collect();
                })
            );
            const result = await executePropertyNode(node, propertyExecutionDefaults);
            scope.assert.equal(result.summary.failed, 1);
            scope.assert.includes(JSON.stringify(result.perTest), 'Property invocation requires a test body.');
        }
        return scope.assert.collect();
    }),
    test('rejects invalid targeting and coverage before the next input', async function (scope) {
        for (const observation of [ 'target', 'cover' ] as const) {
            const values: number[] = [];
            const node = property({
                title: observation,
                generator: gen.constant(1),
                test(value, sample) {
                    values.push(value);
                    Reflect.apply(sample[observation], sample, [ 'label', observation === 'target' ? Number.NaN : 1 ]);
                    return sample.assert.collect();
                }
            });
            const result = await executePropertyNode(node, propertyExecutionDefaults);
            scope.assert.equal(result.summary.failed, 1);
            scope.assert.includes(
                JSON.stringify(result.perTest),
                observation === 'target' ? 'Property target scores must be finite numbers.' : 'expected boolean'
            );
            scope.assert.deepEqual(values, [ 1 ]);
        }
        return scope.assert.collect();
    }),
    test('retains the first failed composite child as the property boundary', async function (scope) {
        const comparison = defineCompositeAssertion({
            name: 'sample comparison',
            assert(check, value: number) {
                return check.group([
                    check.true(true),
                    check.equal(value, 0),
                    check.equal(value, 2)
                ]);
            }
        });
        const node = property({
            title: 'composite sample',
            generator: gen.constant(1),
            test(value, sample) {
                sample.assert(comparison, value);
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.failed, 1);
        const outcome = result.perTest[0]?.outcome;
        if (outcome?.kind !== 'fail' || outcome.failures[0].kind !== 'assertion') {
            throw new TypeError('Expected a failed property assertion.');
        }
        scope.assert.deepEqual(
            outcome.failures[0].checks.map(function primaryChildren(check) {
                return check.kind === 'composite'
                    ? check.children.map(function expected(child) {
                        return child.expected;
                    })
                    : [];
            }),
            [ [ { kind: 'number', value: 0 } ] ]
        );
        return scope.assert.collect();
    }),
    test('confirms failed requirements without admitting new generated samples', async function (scope) {
        const values: number[] = [];
        const node = property({
            title: 'required sample',
            generator: gen.constant(1),
            test(value: number, sample: PropertySampleScope) {
                values.push(value);
                sample.plan(2);
                sample.require.string(value);
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.deepEqual(values, [ 1, 1, 1 ]);
        scope.assert.equal(result.perTest[0]?.property?.invocations[0]?.shrinkStatus, 'search-exhausted');
        scope.assert.equal(result.perTest[0]?.outcome?.kind, 'fail');
        scope.assert.equal(JSON.stringify(result.perTest).includes('body-error'), false);
        scope.assert.equal(JSON.stringify(result.perTest).includes('plan-mismatch'), false);
        return scope.assert.collect();
    }),
    test('preserves deep-assertion operand contracts inside trials', async function (scope) {
        const node = property({
            title: 'invalid deep operand',
            generator: gen.constant(1),
            test(value, sample) {
                const actual: unknown = value;
                sample.assert.deepEqual(actual, { value });
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result.perTest), 'invalid-deep-assertion-operand');
        return scope.assert.collect();
    }),
    test('rejects invocations retained after their case scope closes', async function (scope: TestScope) {
        const retained: PropertyForall[] = [];
        const node = test(
            'closed scope',
            withProperties(function (parent) {
                retained.push(parent.forall);
                parent.assert.true(true);
                return parent.assert.collect();
            })
        );
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.passed, 1);
        const forall = retained[0];
        scope.require.defined(forall);
        await scope.assert.rejects(async function () {
            return await forall(gen.constant(1), function (value, sample) {
                sample.assert.equal(value, 1);
                return sample.assert.collect();
            });
        }, { message: 'Property invocation cannot start after its scope has closed.' });
        return scope.assert.collect();
    }),
    test('counts one boundary per nested invocation and preserves wrapper settings', async function (scope) {
        const values: number[] = [];
        const body = withProperties(async function (parent) {
            parent.plan(2);
            await parent.forall(gen.constant(1), function (value, sample) {
                values.push(value);
                sample.plan(2);
                sample.assert.equal(value, 1);
                sample.assert.equal(Number.isSafeInteger(value), true);
                return sample.assert.collect();
            });
            await parent.forall({
                generator: gen.constant<number>(2),
                examples: [ function () {
                    return 3;
                } ],
                test(value, sample) {
                    values.push(value);
                    sample.assert.true(value > 0);
                    return sample.assert.collect();
                }
            });
            return parent.assert.collect();
        }, { newTrials: 2 });
        const result = await executePropertyNode(test('nested', withProperties(body)), propertyExecutionDefaults);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.perTest.length, 1);
        scope.assert.deepEqual(values, [ 1, 1, 3, 2, 2 ]);
        return scope.assert.collect();
    }),
    test('rejects overlapping nested calls and finishes active cleanup', async function (scope) {
        const events: string[] = [];
        const started = Promise.withResolvers<undefined>();
        const node = test(
            'overlap',
            withProperties(async function (parent) {
                async function sampleBody(value: number, sample: PropertySampleScope): Promise<AssertionResult> {
                    sample.cleanup(function finish() {
                        events.push('cleanup');
                    });
                    started.resolve(undefined);
                    await once(sample.signal, 'abort');
                    sample.assert.equal(value, 1);
                    return sample.assert.collect();
                }
                const first = parent.forall(gen.constant<number>(1), sampleBody);
                await started.promise;
                await Promise.all([ first, parent.forall(gen.constant<number>(1), sampleBody) ]);
                return parent.assert.collect();
            })
        );
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result.perTest), 'property-scope');
        scope.assert.deepEqual(events, [ 'cleanup' ]);
        return scope.assert.collect();
    }),
    test('rejects an unfinished invocation before closing its case', async function (scope) {
        const events: string[] = [];
        const started = Promise.withResolvers<undefined>();
        const pending: Promise<AssertionResult>[] = [];
        const node = test(
            'unfinished',
            withProperties(async function (parent) {
                pending.push(parent.forall(gen.constant(1), async function (value, sample) {
                    sample.cleanup(function () {
                        events.push('cleanup');
                    });
                    started.resolve(undefined);
                    await once(sample.signal, 'abort');
                    sample.assert.equal(value, 1);
                    return sample.assert.collect();
                }));
                await started.promise;
                parent.assert.true(true);
                return parent.assert.collect();
            })
        );
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result.perTest), 'unfinished invocation');
        scope.assert.deepEqual(events, [ 'cleanup' ]);
        scope.assert.equal(pending.length, 1);
        return scope.assert.collect();
    }),
    test('preserves body and cleanup errors instead of assertion failures', async function (scope) {
        const bodyFailure = property({
            title: 'body',
            generator: gen.constant(1),
            test() {
                throw new TypeError('body failed');
            }
        });
        const cleanupFailure = property({
            title: 'cleanup',
            generator: gen.constant(1),
            test(value, sample) {
                sample.cleanup(function failCleanup() {
                    throw new Error('cleanup failed');
                });
                sample.assert.equal(value, 1);
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(
            suite('native errors', [ bodyFailure, cleanupFailure ]),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 2);
        scope.assert.includes(JSON.stringify(result.perTest[0]?.outcome), 'body-error');
        scope.assert.includes(JSON.stringify(result.perTest[1]?.outcome), 'cleanup-error');
        return scope.assert.collect();
    }),
    test('allows property cases to overlap while each case keeps sequential trials', async function (scope) {
        const events: string[] = [];
        const entrants = new Set<string>();
        const ready = Promise.withResolvers<undefined>();
        const properties = [ 'first', 'second' ].map(function concurrentProperty(title) {
            return property({
                title,
                generator: gen.constant(1),
                async test(value, sample) {
                    entrants.add(title);
                    if (entrants.size === 2) {
                        ready.resolve(undefined);
                    }
                    events.push(`${title}:body`);
                    await ready.promise;
                    sample.cleanup(function () {
                        events.push(`${title}:cleanup`);
                    });
                    sample.assert.equal(value, 1);
                    return sample.assert.collect();
                }
            });
        });
        const result = await executePropertyNode(suite('parallel', properties), {
            ...propertyExecutionDefaults,
            execution: { mode: 'concurrent-in-process', maxConcurrency: 2 }
        });
        scope.assert.equal(result.summary.passed, 2);
        scope.assert.deepEqual(
            events.slice(0, 2).toSorted(function alphabetical(left, right) {
                return left.localeCompare(right);
            }),
            [ 'first:body', 'second:body' ]
        );
        for (const title of [ 'first', 'second' ]) {
            scope.assert.deepEqual(
                events.filter(function belongsToProperty(event) {
                    return event.startsWith(title);
                }),
                [
                    `${title}:body`,
                    `${title}:cleanup`,
                    `${title}:body`,
                    `${title}:cleanup`,
                    `${title}:body`,
                    `${title}:cleanup`
                ]
            );
        }
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
