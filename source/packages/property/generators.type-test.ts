import { suite, test } from '@overkill-dev/test-type-authoring';
import { assignableFrom, rejectsCall, sameType } from '@overkill-dev/type-test';
import type { IsEqual, Writable } from 'type-fest';
import type * as standard from '../test/property.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import * as leaf from './property.entry-point.ts';

type Tree = { readonly left: Tree; readonly right: Tree; } | null;

export const testNode = suite('fluent generator constructors', [
    test('infers primitive domains and scalar literals', function (typeScope) {
        typeScope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<boolean>>()(leaf.gen.boolean()));
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<number>>()(leaf.gen.integer({ min: 0, max: 100 }))
        );
        typeScope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<number>>()(leaf.gen.number()));
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<number>>()(leaf.gen.number({ min: -1, max: 1 }))
        );
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<bigint>>()(leaf.gen.bigint({ min: 0n, max: 100n }))
        );
        typeScope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<string>>()(leaf.gen.string()));
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<string>>()(leaf.gen.string({ minLength: 1, maxLength: 20 }))
        );
        typeScope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<Uint8Array>>()(leaf.gen.bytes()));
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<Uint8Array>>()(leaf.gen.bytes({ minLength: 0, maxLength: 20 }))
        );
        return typeScope.assert.collect();
    }),
    test('preserves scalar literal types', function (typeScope) {
        typeScope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<'value'>>()(leaf.gen.constant('value')));
        typeScope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<null>>()(leaf.gen.constant(null)));
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<undefined>>()(leaf.gen.constant(undefined))
        );
        const literal = 1n;
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<typeof literal>>()(leaf.gen.constant(literal))
        );
        return typeScope.assert.collect();
    }),
    test('preserves heterogeneous tuples, required fields, unions, and dependent outputs', function (typeScope) {
        const integer = leaf.gen.integer({ min: 0, max: 100 });
        typeScope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<number[]>>()(leaf.gen.array(integer)));
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<number[]>>()(leaf.gen.array(integer, { minLength: 0, maxLength: 4 }))
        );
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<['name', number]>>()(leaf.gen.tuple(leaf.gen.constant('name'), integer))
        );
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<Writable<{ readonly name: string; readonly age: number; }>>>()(
                leaf.gen.record({ name: leaf.gen.string(), age: integer })
            )
        );
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<number | string | null>>()(
                leaf.gen.choice(leaf.gen.constant(null), integer, leaf.gen.string())
            )
        );
        typeScope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<[]>>()(leaf.gen.tuple()));
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<Record<PropertyKey, never>>>()(leaf.gen.record({}))
        );
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<string[]>>()(integer.flatMap(function dependent(value) {
                return leaf.gen.array(leaf.gen.string(), { minLength: value, maxLength: value });
            }))
        );
        return typeScope.assert.collect();
    }),
    test('accepts union leaves and branches in bounded recursion', function (typeScope) {
        const tree = leaf.gen.recursive<Tree>({
            leaf: leaf.gen.constant(null),
            branch(child) {
                typeScope.assert(sameType<IsEqual<typeof child, leaf.Generator<Tree>>, true>());
                return leaf.gen.record({ left: child, right: child });
            },
            maxDepth: 4
        });
        typeScope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<Tree>>()(tree));
        typeScope.assert(
            sameType<standard.RecursiveGeneratorDefinition<Tree>, leaf.RecursiveGeneratorDefinition<Tree>>()
        );
        return typeScope.assert.collect();
    }),
    test('exposes identical types across property entry points without backend operations', function (typeScope) {
        typeScope.assert(sameType<typeof standard.gen, typeof leaf.gen>());
        typeScope.assert(sameType<standard.NumberBounds, leaf.NumberBounds>());
        typeScope.assert(sameType<standard.BigintBounds, leaf.BigintBounds>());
        typeScope.assert(sameType<standard.LengthBounds, leaf.LengthBounds>());
        typeScope.assert(sameType<standard.GeneratorConstant, leaf.GeneratorConstant>());
        typeScope.assert(assignableFrom.not<keyof leaf.Generator<number>, 'generate'>());
        typeScope.assert(assignableFrom.not<keyof leaf.Generator<number>, 'shrink'>());
        typeScope.assert(assignableFrom.not<keyof leaf.Generator<number>, 'prepare'>());
        return typeScope.assert.collect();
    }),
    suite('rejects incomplete constraints, empty choices, sampling functions, and mutable constants', [
        test('rejects incomplete constraints and mutable constants', function (typeScope) {
            typeScope.assert(rejectsCall('argument-count'), () => leaf.gen.integer());
            typeScope.assert(rejectsCall('argument-type'), () => leaf.gen.integer({ min: 0 }));
            typeScope.assert(rejectsCall('argument-type'), () => leaf.gen.bigint({ min: 0, max: 10 }));
            typeScope.assert(rejectsCall('argument-type'), () => leaf.gen.string({ maxLength: 10 }));
            typeScope.assert(rejectsCall('argument-type'), () => leaf.gen.bytes({ minLength: 1 }));
            return typeScope.assert.collect();
        }),
        test('rejects empty choices and invalid generators', function (typeScope) {
            typeScope.assert(rejectsCall('argument-type'), () => leaf.gen.constant({ value: 1 }));
            typeScope.assert(rejectsCall('argument-count'), () => leaf.gen.choice());
            function sample(): number {
                return 1;
            }
            typeScope.assert(rejectsCall('argument-type'), () => leaf.gen.array(sample));
            typeScope.assert(rejectsCall('argument-type'), () =>
                leaf.gen.recursive({
                    leaf: leaf.gen.constant(null),
                    branch: function branch(child: leaf.Generator<null>) {
                        return child;
                    }
                }));
            return typeScope.assert.collect();
        })
    ])
]);
