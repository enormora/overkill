import type { IsEqual } from 'type-fest';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { suite, test } from '@overkill-dev/test';
import { acceptsCall, assignableFrom, assignableTo, rejectsCall, sameType } from '@overkill-dev/type-test';
import type {
    AssertionResult,
    BodyImplementation,
    BodyReference,
    TestBody,
    TestCase,
    TestScope
} from '../engine/engine.entry-point.ts';
import * as standard from '../test/property.entry-point.ts';
import * as leaf from './property.entry-point.ts';

declare const namedGenerator: leaf.Generator<{ readonly name: string; }>;
declare const numberGenerator: leaf.Generator<number>;
declare const booleanGenerator: leaf.Generator<boolean>;
declare const propertyBody: BodyImplementation<leaf.PropertyCaseScope, ReturnType<TestBody>>;

export const testNode = suite('property', [
    suite('property authoring types', [
        test('accepts property body unions', function (typeScope) {
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<BodyReference | TestBody>()(leaf.withProperties(propertyBody))
            );
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<BodyReference | TestBody>()(standard.withProperties(propertyBody))
            );
            return typeScope.assert.collect();
        }),
        test('integration properties retain input inference', function (typeScope) {
            const node = leaf.property({
                testFamily: 'integration',
                title: 'project inputs',
                generator: numberGenerator,
                test(value, sample) {
                    typeScope.assert(sameType.withActual<number>(), value);
                    typeScope.assert(sameType<IsEqual<typeof sample, leaf.PropertySampleScope<number>>, true>());
                    sample.assert.equal(value, 1);
                    return sample.assert.collect();
                }
            });
            typeScope.assert(sameType<IsEqual<typeof node, TestCase>, true>());
            return typeScope.assert.collect();
        }),
        test('infers custom codec values on both entry points', function (typeScope) {
            const codec = leaf.defineCodec({
                name: 'numeric',
                version: 1,
                previousDecoders: [],
                encode(value: number) {
                    return value;
                },
                decode: Number
            });
            typeScope.assert(sameType.withActual<leaf.PropertyInputCodec<number>>(), codec);
            typeScope.assert(sameType<typeof standard.defineCodec, typeof leaf.defineCodec>());
            return typeScope.assert.collect();
        }),
        test('infers property inputs and injected sample scope', function (typeScope) {
            const generator = namedGenerator;
            const node = leaf.property({
                title: 'typed input',
                coverage: [ { label: 'empty', minimumPercent: 20 } ],
                generator,
                test(value, sample) {
                    typeScope.assert(sameType.withActual<{ readonly name: string; }>(), value);
                    typeScope.assert(
                        sameType<IsEqual<typeof sample, leaf.PropertySampleScope<{ readonly name: string; }>>, true>()
                    );
                    typeScope.assert(sameType.withActual<{ readonly name: string; }>(), sample.reconstructInput());
                    sample.failureKey('name');
                    sample.target('length', value.name.length);
                    sample.cover('empty', value.name === '');
                    sample.assert.equal(value.name, 'Ada');
                    return sample.assert.collect();
                }
            });
            typeScope.assert(sameType<IsEqual<typeof node, TestCase>, true>());
            typeScope.assert(sameType<IsEqual<typeof standard.property, typeof leaf.property>, true>());
            typeScope.assert(sameType<IsEqual<standard.Generator<string>, leaf.Generator<string>>, true>());
            typeScope.assert(sameType<IsEqual<standard.PropertyBody<string>, leaf.PropertyBody<string>>, true>());
            return typeScope.assert.collect();
        }),
        test('infers factory examples for first-class and nested properties', function (typeScope) {
            const node = leaf.property({
                title: 'examples',
                generator: namedGenerator,
                examples: [ function () {
                    return { name: 'Ada' };
                } ],
                test(value, sample) {
                    typeScope.assert(sameType.withActual<{ readonly name: string; }>(), value);
                    sample.assert.equal(value.name, 'Ada');
                    return sample.assert.collect();
                }
            });
            typeScope.assert(sameType<IsEqual<typeof node, TestCase>, true>());
            typeScope.assert(sameType<standard.PropertyExample<number>, leaf.PropertyExample<number>>());
            standard.withProperties(async function (scope) {
                const authoredValue = scope.forall({
                    generator: numberGenerator,
                    examples: [ function () {
                        return 0;
                    } ],
                    test(value, sample) {
                        typeScope.assert(sameType.withActual<number>(), value);
                        sample.assert.equal(value, 0);
                        return sample.assert.collect();
                    }
                });
                typeScope.assert(sameType.withActual<Promise<AssertionResult>>(), authoredValue);
                return scope.assert.collect();
            });
            function wrongExample() {
                return true;
            }
            typeScope.assert(rejectsCall('argument-type'), () =>
                leaf.property({
                    title: 'wrong example',
                    generator: numberGenerator,
                    examples: [ wrongExample ],
                    test(value: number, sample: leaf.PropertySampleScope) {
                        sample.assert.equal(value, 0);
                        return sample.assert.collect();
                    }
                }));
            return typeScope.assert.collect();
        }),
        test('nested authoring adds forall without changing the base scope', function (typeScope) {
            const generator = numberGenerator;
            const body = standard.withProperties(async function (scope) {
                typeScope.assert(sameType<IsEqual<typeof scope, leaf.PropertyCaseScope>, true>());
                const authoredValue2 = scope.forall(generator, function (value, sample) {
                    typeScope.assert(sameType.withActual<number>(), value);
                    sample.assert.equal(value, 1);
                    return sample.assert.collect();
                });
                typeScope.assert(sameType.withActual<Promise<AssertionResult>>(), authoredValue2);
                return scope.assert.collect();
            });
            typeScope.assert(sameType<IsEqual<typeof body, TestBody>, true>());
            typeScope.assert(assignableFrom.not<keyof TestScope, 'forall'>());
            typeScope.assert(assignableFrom.not<keyof TestScope, 'target'>());
            typeScope.assert(assignableFrom.not<keyof TestScope, 'cover'>());
            typeScope.assert(sameType<[() => void] extends [leaf.PropertyBody<number>] ? true : false, false>());
            return typeScope.assert.collect();
        }),
        test('accepts collected overrides without changing forall or the base scope', function (typeScope) {
            typeScope.assert(acceptsCall, () =>
                leaf.property({
                    title: 'configured',
                    generator: numberGenerator,
                    test(value: number, sample: leaf.PropertySampleScope) {
                        sample.assert.equal(value, 1);
                        return sample.assert.collect();
                    },
                    settings: { newTrials: 200, maxShrinkWork: 0 }
                }));
            typeScope.assert(acceptsCall, () =>
                leaf.withProperties(
                    function (scope: leaf.PropertyCaseScope) {
                        return scope.assert.collect();
                    },
                    { maxWork: 20_000 }
                ));
            typeScope.assert(assignableFrom.not<keyof leaf.PropertySettings, 'timeouts'>());
            typeScope.assert(assignableFrom.not<keyof leaf.PropertySettings, 'coverage'>());
            return typeScope.assert.collect();
        }),
        test('fluent generator composition preserves input types and branding', function (typeScope) {
            const generator = numberGenerator;
            typeScope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<string>>()(generator.map(String)));
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<leaf.Generator<boolean>>()(generator.flatMap(function () {
                    return booleanGenerator;
                }))
            );
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<leaf.Generator<number>>()(generator.filter(function (value) {
                    return value > 0;
                }))
            );
            typeScope.assert(acceptsCall, () =>
                generator.withCodec({
                    name: 'number',
                    version: 1,
                    previousDecoders: [],
                    encode(value: number) {
                        return value;
                    },
                    decode: Number
                }));
            typeScope.assert(
                assignableTo.not<
                    Pick<leaf.Generator<number>, 'filter' | 'flatMap' | 'map' | 'withCodec'>,
                    leaf.Generator<number>
                >()
            );
            typeScope.assert(assignableTo.not<() => number, leaf.Generator<number>>());
            return typeScope.assert.collect();
        })
    ]),
    suite('preview and relation types', [
        test('shares exports and infers relation inputs and asynchronous outputs', function (typeScope) {
            typeScope.assert(sameType<IsEqual<typeof standard.relation, typeof leaf.relation>, true>());
            typeScope.assert(sameType<IsEqual<typeof standard.sampleGenerator, typeof leaf.sampleGenerator>, true>());
            typeScope.assert(
                sameType.withActual<readonly number[]>(),
                leaf.sampleGenerator(numberGenerator, { seed: 42n, count: 2, size: 3, depth: 0 })
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
                        typeScope.assert(sameType.withActual<number>(), original.input);
                        typeScope.assert(sameType.withActual<string>(), original.output);
                        sample.assert.equal(original.output, '1');
                        return sample.assert.collect();
                    }
                })
            });
            return typeScope.assert.collect();
        })
    ])
]);
