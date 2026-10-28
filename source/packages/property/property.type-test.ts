import { describe, expect, test } from 'tstyche';
import type { AssertionResult, TestBody, TestCase, TestScope } from '../engine/engine.entry-point.ts';
import * as standard from '../test/property.entry-point.ts';
import * as leaf from './property.entry-point.ts';

declare const namedGenerator: leaf.Generator<{ readonly name: string; }>;
declare const numberGenerator: leaf.Generator<number>;
declare const booleanGenerator: leaf.Generator<boolean>;

describe('property authoring types', function () {
    test('infers property inputs and injected sample scope', function () {
        const generator = namedGenerator;
        const node = leaf.property({
            title: 'typed input',
            generator,
            test(value, sample) {
                expect(value).type.toBe<{ readonly name: string; }>();
                expect(sample).type.toBe<leaf.PropertySampleScope>();
                sample.target('length', value.name.length);
                sample.cover('empty', value.name === '');
                sample.assert.equal(value.name, 'Ada');
                return sample.assert.collect();
            }
        });
        expect(node).type.toBe<TestCase>();
        expect<typeof standard.property>().type.toBe<typeof leaf.property>();
        expect<standard.Generator<string>>().type.toBe<leaf.Generator<string>>();
        expect<standard.PropertyBody<string>>().type.toBe<leaf.PropertyBody<string>>();
    });
    test('infers factory examples for first-class and nested properties', function () {
        const node = leaf.property({
            title: 'examples',
            generator: namedGenerator,
            examples: [ function () {
                return { name: 'Ada' };
            } ],
            test(value, sample) {
                expect(value).type.toBe<{ readonly name: string; }>();
                sample.assert.equal(value.name, 'Ada');
                return sample.assert.collect();
            }
        });
        expect(node).type.toBe<TestCase>();
        expect<standard.PropertyExample<number>>().type.toBe<leaf.PropertyExample<number>>();
        standard.withProperties(async function (scope) {
            expect(scope.forall({
                generator: numberGenerator,
                examples: [ function () {
                    return 0;
                } ],
                test(value, sample) {
                    expect(value).type.toBe<number>();
                    sample.assert.equal(value, 0);
                    return sample.assert.collect();
                }
            }))
                .type
                .toBe<Promise<AssertionResult>>();
            return scope.assert.collect();
        });
        expect(leaf.property).type.not.toBeCallableWith({
            title: 'wrong example',
            generator: numberGenerator,
            examples: [ function () {
                return true;
            } ],
            test(value: number, sample: leaf.PropertySampleScope) {
                sample.assert.equal(value, 0);
                return sample.assert.collect();
            }
        });
    });
    test('nested authoring adds forall without changing the base scope', function () {
        const generator = numberGenerator;
        const body = standard.withProperties(async function (scope) {
            expect(scope).type.toBe<leaf.PropertyCaseScope>();
            expect(scope.forall(generator, function (value, sample) {
                expect(value).type.toBe<number>();
                sample.assert.equal(value, 1);
                return sample.assert.collect();
            }))
                .type
                .toBe<Promise<AssertionResult>>();
            return scope.assert.collect();
        });
        expect(body).type.toBe<TestBody>();
        expect<TestScope>().type.not.toHaveProperty('forall');
        expect<TestScope>().type.not.toHaveProperty('target');
        expect<TestScope>().type.not.toHaveProperty('cover');
        expect<() => void>().type.not.toBeAssignableTo<leaf.PropertyBody<number>>();
    });
    test('accepts collected overrides without changing forall or the base scope', function () {
        expect(leaf.property).type.toBeCallableWith({
            title: 'configured',
            generator: numberGenerator,
            test(value: number, sample: leaf.PropertySampleScope) {
                sample.assert.equal(value, 1);
                return sample.assert.collect();
            },
            settings: { newTrials: 200, maxShrinkWork: 0 }
        });
        expect(leaf.withProperties).type.toBeCallableWith(
            function (scope: leaf.PropertyCaseScope) {
                return scope.assert.collect();
            },
            { maxWork: 20_000 }
        );
        expect<leaf.PropertySettings>().type.not.toHaveProperty('timeouts');
        expect<leaf.PropertySettings>().type.not.toHaveProperty('coverage');
    });
    test('fluent generator composition preserves input types and branding', function () {
        const generator = numberGenerator;
        expect(generator.map(String))
            .type
            .toBe<leaf.Generator<string>>();
        expect(generator.flatMap(function () {
            return booleanGenerator;
        }))
            .type
            .toBe<leaf.Generator<boolean>>();
        expect(generator.filter(function (value) {
            return value > 0;
        }))
            .type
            .toBe<leaf.Generator<number>>();
        expect(generator.withCodec).type.toBeCallableWith({
            name: 'number',
            version: 1,
            previousDecoders: [],
            encode(value: number) {
                return value;
            },
            decode: Number
        });
        expect<Pick<leaf.Generator<number>, 'filter' | 'flatMap' | 'map' | 'withCodec'>>().type.not.toBeAssignableTo<
            leaf.Generator<number>
        >();
        expect<() => number>().type.not.toBeAssignableTo<leaf.Generator<number>>();
    });
});
