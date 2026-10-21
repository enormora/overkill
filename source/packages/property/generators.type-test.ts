import { describe, expect, test } from 'tstyche';
import type { Writable } from 'type-fest';
import type * as standard from '../test/property.entry-point.ts';
import * as leaf from './property.entry-point.ts';

type Tree = { readonly left: Tree; readonly right: Tree; } | null;

describe('fluent generator constructors', function () {
    test('infers primitive domains and scalar literals', function () {
        expect(leaf.gen.boolean()).type.toBe<leaf.Generator<boolean>>();
        expect(leaf.gen.integer({ min: 0, max: 100 })).type.toBe<leaf.Generator<number>>();
        expect(leaf.gen.number()).type.toBe<leaf.Generator<number>>();
        expect(leaf.gen.number({ min: -1, max: 1 })).type.toBe<leaf.Generator<number>>();
        expect(leaf.gen.bigint({ min: 0n, max: 100n })).type.toBe<leaf.Generator<bigint>>();
        expect(leaf.gen.string()).type.toBe<leaf.Generator<string>>();
        expect(leaf.gen.string({ minLength: 1, maxLength: 20 })).type.toBe<leaf.Generator<string>>();
        expect(leaf.gen.bytes()).type.toBe<leaf.Generator<Uint8Array>>();
        expect(leaf.gen.bytes({ minLength: 0, maxLength: 20 })).type.toBe<leaf.Generator<Uint8Array>>();
    });

    test('preserves scalar literal types', function () {
        expect(leaf.gen.constant('value')).type.toBe<leaf.Generator<'value'>>();
        expect(leaf.gen.constant(null)).type.toBe<leaf.Generator<null>>();
        expect(leaf.gen.constant(undefined)).type.toBe<leaf.Generator<undefined>>();
        const literal = 1n;
        expect(leaf.gen.constant(literal)).type.toBe<leaf.Generator<typeof literal>>();
    });

    test('preserves heterogeneous tuples, required fields, unions, and dependent outputs', function () {
        const integer = leaf.gen.integer({ min: 0, max: 100 });
        expect(leaf.gen.array(integer)).type.toBe<leaf.Generator<number[]>>();
        expect(leaf.gen.array(integer, { minLength: 0, maxLength: 4 })).type.toBe<leaf.Generator<number[]>>();
        expect(leaf.gen.tuple(leaf.gen.constant('name'), integer)).type.toBe<leaf.Generator<['name', number]>>();
        expect(leaf.gen.record({ name: leaf.gen.string(), age: integer })).type.toBe<
            leaf.Generator<Writable<{ readonly name: string; readonly age: number; }>>
        >();
        expect(leaf.gen.choice(leaf.gen.constant(null), integer, leaf.gen.string())).type.toBe<
            leaf.Generator<number | string | null>
        >();
        expect(leaf.gen.tuple()).type.toBe<leaf.Generator<[]>>();
        expect(leaf.gen.record({})).type.toBe<leaf.Generator<Record<PropertyKey, never>>>();
        expect(integer.flatMap(function dependent(value) {
            return leaf.gen.array(leaf.gen.string(), { minLength: value, maxLength: value });
        }))
            .type
            .toBe<leaf.Generator<string[]>>();
    });

    test('accepts union leaves and branches in bounded recursion', function () {
        const tree = leaf.gen.recursive<Tree>({
            leaf: leaf.gen.constant(null),
            branch(child) {
                expect(child).type.toBe<leaf.Generator<Tree>>();
                return leaf.gen.record({ left: child, right: child });
            },
            maxDepth: 4
        });
        expect(tree).type.toBe<leaf.Generator<Tree>>();
        expect<standard.RecursiveGeneratorDefinition<Tree>>().type.toBe<leaf.RecursiveGeneratorDefinition<Tree>>();
    });

    test('exposes identical types across property entry points without backend operations', function () {
        expect<typeof standard.gen>().type.toBe<typeof leaf.gen>();
        expect<standard.NumberBounds>().type.toBe<leaf.NumberBounds>();
        expect<standard.BigintBounds>().type.toBe<leaf.BigintBounds>();
        expect<standard.LengthBounds>().type.toBe<leaf.LengthBounds>();
        expect<standard.GeneratorConstant>().type.toBe<leaf.GeneratorConstant>();
        expect<leaf.Generator<number>>().type.not.toHaveProperty('generate');
        expect<leaf.Generator<number>>().type.not.toHaveProperty('shrink');
        expect<leaf.Generator<number>>().type.not.toHaveProperty('prepare');
    });

    test('rejects incomplete constraints, empty choices, sampling functions, and mutable constants', function () {
        expect(leaf.gen.integer).type.not.toBeCallableWith();
        expect(leaf.gen.integer).type.not.toBeCallableWith({ min: 0 });
        expect(leaf.gen.bigint).type.not.toBeCallableWith({ min: 0, max: 10 });
        expect(leaf.gen.string).type.not.toBeCallableWith({ maxLength: 10 });
        expect(leaf.gen.bytes).type.not.toBeCallableWith({ minLength: 1 });
        expect(leaf.gen.constant).type.not.toBeCallableWith({ value: 1 });
        expect(leaf.gen.choice).type.not.toBeCallableWith();
        expect(leaf.gen.array).type.not.toBeCallableWith(function sample() {
            return 1;
        });
        expect(leaf.gen.recursive).type.not.toBeCallableWith({
            leaf: leaf.gen.constant(null),
            branch: function branch(child: leaf.Generator<null>) {
                return child;
            }
        });
    });
});
