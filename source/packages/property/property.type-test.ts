import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { acceptsCall, assignableFrom, rejectsCall, sameType } from '@overkill-dev/type-test';
import type {
    AssertionResult,
    BodyImplementation,
    BodyReference,
    TestBody,
    TestCase,
    TestScope
} from '../engine/engine.entry-point.ts';
import * as standard from '../test/property.entry-point.ts';
import { isEqualTo, type IsAssignable } from '../../test-support/type-relations.ts';
import * as leaf from './property.entry-point.ts';

declare const namedGenerator: leaf.Generator<{ readonly name: string; }>;
declare const numberGenerator: leaf.Generator<number>;
declare const booleanGenerator: leaf.Generator<boolean>;
declare const propertyBody: BodyImplementation<leaf.PropertyCaseScope, ReturnType<TestBody>>;

export const testNode = suite('Property authoring, previews, and relations', [
    suite('property authoring types', [
        test('accepts property body unions', function (scope) {
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<BodyReference | TestBody>()(leaf.withProperties(propertyBody))
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<BodyReference | TestBody>()(standard.withProperties(propertyBody))
            );
            return scope.assert.collect();
        }),
        test('integration properties retain input inference', function (scope) {
            const node = leaf.property({
                testFamily: 'integration',
                title: 'project inputs',
                generator: numberGenerator,
                test(value, sample) {
                    scope.assert(sameType.withActual<number>(), value);
                    scope.assert(sameType<IsEqual<typeof sample, leaf.PropertySampleScope<number>>, true>());
                    sample.assert.equal(value, 1);
                    return sample.assert.collect();
                }
            });
            scope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(node));
            return scope.assert.collect();
        }),
        test('infers custom codec values on both entry points', function (scope) {
            const codec = leaf.defineCodec({
                name: 'numeric',
                version: 1,
                previousDecoders: [],
                encode(value: number) {
                    return value;
                },
                decode: Number
            });
            scope.assert(sameType.withActual<true>(), isEqualTo<leaf.PropertyInputCodec<number>>()(codec));
            scope.assert(sameType<IsEqual<typeof standard.defineCodec, typeof leaf.defineCodec>, true>());
            return scope.assert.collect();
        }),
        test('infers property inputs and injected sample scope', function (scope) {
            const generator = namedGenerator;
            const node = leaf.property({
                title: 'typed input',
                coverage: [ { label: 'empty', minimumPercent: 20 } ],
                generator,
                test(value, sample) {
                    scope.assert(sameType.withActual<true>(), isEqualTo<{ readonly name: string; }>()(value));
                    scope.assert(
                        sameType<IsEqual<typeof sample, leaf.PropertySampleScope<{ readonly name: string; }>>, true>()
                    );
                    scope.assert(
                        sameType.withActual<true>(),
                        isEqualTo<{ readonly name: string; }>()(sample.reconstructInput())
                    );
                    sample.failureKey('name');
                    sample.target('length', value.name.length);
                    sample.cover('empty', value.name === '');
                    sample.assert.equal(value.name, 'Ada');
                    return sample.assert.collect();
                }
            });
            scope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(node));
            scope.assert(sameType<IsEqual<typeof standard.property, typeof leaf.property>, true>());
            scope.assert(sameType<IsEqual<standard.Generator<string>, leaf.Generator<string>>, true>());
            scope.assert(sameType<IsEqual<standard.PropertyBody<string>, leaf.PropertyBody<string>>, true>());
            return scope.assert.collect();
        }),
        test('infers factory examples for first-class and nested properties', function (scope) {
            const node = leaf.property({
                title: 'examples',
                generator: namedGenerator,
                examples: [ function () {
                    return { name: 'Ada' };
                } ],
                test(value, sample) {
                    scope.assert(sameType.withActual<true>(), isEqualTo<{ readonly name: string; }>()(value));
                    sample.assert.equal(value.name, 'Ada');
                    return sample.assert.collect();
                }
            });
            scope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(node));
            scope.assert(sameType<IsEqual<standard.PropertyExample<number>, leaf.PropertyExample<number>>, true>());
            standard.withProperties(async function (callbackScope) {
                const authoredValue = callbackScope.forall({
                    generator: numberGenerator,
                    examples: [ function () {
                        return 0;
                    } ],
                    test(value, sample) {
                        scope.assert(sameType.withActual<number>(), value);
                        sample.assert.equal(value, 0);
                        return sample.assert.collect();
                    }
                });
                scope.assert(sameType.withActual<true>(), isEqualTo<Promise<AssertionResult>>()(authoredValue));
                return callbackScope.assert.collect();
            });
            function wrongExample(): boolean {
                return true;
            }
            scope.assert(rejectsCall('argument-type'), function () {
                return leaf.property({
                    title: 'wrong example',
                    generator: numberGenerator,
                    examples: [ wrongExample ],
                    test(value: number, sample: leaf.PropertySampleScope) {
                        sample.assert.equal(value, 0);
                        return sample.assert.collect();
                    }
                });
            });
            return scope.assert.collect();
        }),
        test('nested authoring adds forall without changing the base scope', function (scope) {
            const generator = numberGenerator;
            const body = standard.withProperties(async function (callbackScope) {
                scope.assert(sameType<IsEqual<typeof callbackScope, leaf.PropertyCaseScope>, true>());
                const authoredValue2 = callbackScope.forall(generator, function (value, sample) {
                    scope.assert(sameType.withActual<number>(), value);
                    sample.assert.equal(value, 1);
                    return sample.assert.collect();
                });
                scope.assert(sameType.withActual<true>(), isEqualTo<Promise<AssertionResult>>()(authoredValue2));
                return callbackScope.assert.collect();
            });
            scope.assert(sameType.withActual<true>(), isEqualTo<TestBody>()(body));
            scope.assert(assignableFrom.not<keyof TestScope, 'forall'>());
            scope.assert(assignableFrom.not<keyof TestScope, 'target'>());
            scope.assert(assignableFrom.not<keyof TestScope, 'cover'>());
            scope.assert(sameType<[() => void] extends [leaf.PropertyBody<number>] ? true : false, false>());
            return scope.assert.collect();
        }),
        test('accepts collected overrides without changing forall or the base scope', function (scope) {
            scope.assert(acceptsCall, function () {
                return leaf.property({
                    title: 'configured',
                    generator: numberGenerator,
                    test(value: number, sample: leaf.PropertySampleScope) {
                        sample.assert.equal(value, 1);
                        return sample.assert.collect();
                    },
                    settings: { newTrials: 200, maxShrinkWork: 0 }
                });
            });
            scope.assert(acceptsCall, function () {
                return leaf.withProperties(
                    function (callbackScope: leaf.PropertyCaseScope) {
                        return callbackScope.assert.collect();
                    },
                    { maxWork: 20_000 }
                );
            });
            scope.assert(assignableFrom.not<keyof leaf.PropertySettings, 'timeouts'>());
            scope.assert(assignableFrom.not<keyof leaf.PropertySettings, 'coverage'>());
            return scope.assert.collect();
        }),
        test('fluent generator composition preserves input types and branding', function (scope) {
            const generator = numberGenerator;
            scope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<string>>()(generator.map(String)));
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<leaf.Generator<boolean>>()(generator.flatMap(function () {
                    return booleanGenerator;
                }))
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<leaf.Generator<number>>()(generator.filter(function (value) {
                    return value > 0;
                }))
            );
            scope.assert(acceptsCall, function () {
                return generator.withCodec({
                    name: 'number',
                    version: 1,
                    previousDecoders: [],
                    encode(value: number) {
                        return value;
                    },
                    decode: Number
                });
            });
            scope.assert(
                sameType<
                    IsAssignable<
                        Pick<leaf.Generator<number>, 'filter' | 'flatMap' | 'map' | 'withCodec'>,
                        leaf.Generator<number>
                    >,
                    false
                >()
            );
            scope.assert(sameType<IsAssignable<() => number, leaf.Generator<number>>, false>());
            return scope.assert.collect();
        })
    ]),
    suite('preview and relation types', [
        test('shares exports and infers relation inputs and asynchronous outputs', function (scope) {
            scope.assert(sameType<IsEqual<typeof standard.relation, typeof leaf.relation>, true>());
            scope.assert(sameType<IsEqual<typeof standard.sampleGenerator, typeof leaf.sampleGenerator>, true>());
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<readonly number[]>()(
                    leaf.sampleGenerator(numberGenerator, { seed: 42n, count: 2, size: 3, depth: 0 })
                )
            );
            leaf.property({
                title: 'typed relation',
                generator: numberGenerator,
                test: leaf.relation({
                    transform(value) {
                        return -value;
                    },
                    async run(value) {
                        await Promise.resolve();
                        return String(value);
                    },
                    check({ original }, sample) {
                        scope.assert(sameType.withActual<number>(), original.input);
                        scope.assert(sameType.withActual<string>(), original.output);
                        sample.assert.equal(original.output, '1');
                        return sample.assert.collect();
                    }
                })
            });
            return scope.assert.collect();
        })
    ])
]);
