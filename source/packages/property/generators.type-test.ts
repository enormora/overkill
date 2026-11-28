import type { IsEqual, Writable } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { assignableFrom, rejectsCall, sameType } from '@overkill-dev/type-test';
import type * as standard from '../test/property.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import * as leaf from './property.entry-point.ts';

type Tree = { readonly left: Tree; readonly right: Tree; } | null;

export const testNode = suite('fluent generator constructors', [
    test('infers primitive domains and scalar literals', function (scope) {
        scope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<boolean>>()(leaf.gen.boolean()));
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<number>>()(leaf.gen.integer({ min: 0, max: 100 }))
        );
        scope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<number>>()(leaf.gen.number()));
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<number>>()(leaf.gen.number({ min: -1, max: 1 }))
        );
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<bigint>>()(leaf.gen.bigint({ min: 0n, max: 100n }))
        );
        scope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<string>>()(leaf.gen.string()));
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<string>>()(leaf.gen.string({ minLength: 1, maxLength: 20 }))
        );
        scope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<Uint8Array>>()(leaf.gen.bytes()));
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<Uint8Array>>()(leaf.gen.bytes({ minLength: 0, maxLength: 20 }))
        );
        return scope.assert.collect();
    }),
    test('preserves scalar literal types', function (scope) {
        scope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<'value'>>()(leaf.gen.constant('value')));
        scope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<null>>()(leaf.gen.constant(null)));
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<undefined>>()(leaf.gen.constant(undefined))
        );
        const literal = 1n;
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<typeof literal>>()(leaf.gen.constant(literal))
        );
        return scope.assert.collect();
    }),
    test('preserves heterogeneous tuples, required fields, unions, and dependent outputs', function (scope) {
        const integer = leaf.gen.integer({ min: 0, max: 100 });
        scope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<number[]>>()(leaf.gen.array(integer)));
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<number[]>>()(leaf.gen.array(integer, { minLength: 0, maxLength: 4 }))
        );
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<['name', number]>>()(leaf.gen.tuple(leaf.gen.constant('name'), integer))
        );
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<Writable<{ readonly name: string; readonly age: number; }>>>()(
                leaf.gen.record({ name: leaf.gen.string(), age: integer })
            )
        );
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<number | string | null>>()(
                leaf.gen.choice(leaf.gen.constant(null), integer, leaf.gen.string())
            )
        );
        scope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<[]>>()(leaf.gen.tuple()));
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<Record<PropertyKey, never>>>()(leaf.gen.record({}))
        );
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<leaf.Generator<string[]>>()(integer.flatMap(function dependent(value) {
                return leaf.gen.array(leaf.gen.string(), { minLength: value, maxLength: value });
            }))
        );
        return scope.assert.collect();
    }),
    test('accepts union leaves and branches in bounded recursion', function (scope) {
        const tree = leaf.gen.recursive<Tree>({
            leaf: leaf.gen.constant(null),
            branch(child) {
                scope.assert(sameType<IsEqual<typeof child, leaf.Generator<Tree>>, true>());
                return leaf.gen.record({ left: child, right: child });
            },
            maxDepth: 4
        });
        scope.assert(sameType.withActual<true>(), isEqualTo<leaf.Generator<Tree>>()(tree));
        scope.assert(
            sameType<
                IsEqual<standard.RecursiveGeneratorDefinition<Tree>, leaf.RecursiveGeneratorDefinition<Tree>>,
                true
            >()
        );
        return scope.assert.collect();
    }),
    test('exposes identical types across property entry points without backend operations', function (scope) {
        scope.assert(sameType<IsEqual<typeof standard.gen, typeof leaf.gen>, true>());
        scope.assert(sameType<IsEqual<standard.NumberBounds, leaf.NumberBounds>, true>());
        scope.assert(sameType<IsEqual<standard.BigintBounds, leaf.BigintBounds>, true>());
        scope.assert(sameType<IsEqual<standard.LengthBounds, leaf.LengthBounds>, true>());
        scope.assert(sameType<IsEqual<standard.GeneratorConstant, leaf.GeneratorConstant>, true>());
        scope.assert(assignableFrom.not<keyof leaf.Generator<number>, 'generate'>());
        scope.assert(assignableFrom.not<keyof leaf.Generator<number>, 'shrink'>());
        scope.assert(assignableFrom.not<keyof leaf.Generator<number>, 'prepare'>());
        return scope.assert.collect();
    }),
    suite('rejects incomplete constraints, empty choices, sampling functions, and mutable constants', [
        test('rejects incomplete constraints and mutable constants', function (scope) {
            scope.assert(rejectsCall('argument-count'), function () {
                return leaf.gen.integer();
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return leaf.gen.integer({ min: 0 });
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return leaf.gen.bigint({ min: 0, max: 10 });
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return leaf.gen.string({ maxLength: 10 });
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return leaf.gen.bytes({ minLength: 1 });
            });
            return scope.assert.collect();
        }),
        test('rejects empty choices and invalid generators', function (scope) {
            scope.assert(rejectsCall('argument-type'), function () {
                return leaf.gen.constant({ value: 1 });
            });
            scope.assert(rejectsCall('argument-count'), function () {
                return leaf.gen.choice();
            });
            function sample(): number {
                return 1;
            }
            scope.assert(rejectsCall('argument-type'), function () {
                return leaf.gen.array(sample);
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return leaf.gen.recursive({
                    leaf: leaf.gen.constant(null),
                    branch: function branch(child: leaf.Generator<null>) {
                        return child;
                    }
                });
            });
            return scope.assert.collect();
        })
    ])
]);
