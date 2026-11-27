import type { IsEqual } from 'type-fest';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { suite, test } from '@overkill-dev/test';
import { acceptsCall, rejectsCall, sameType } from '@overkill-dev/type-test';
import type * as ordinary from '../test/test.entry-point.ts';
import * as standard from '../test/bench.entry-point.ts';
import * as bench from './bench.entry-point.ts';

const parameterValue = 3;
declare const referencedBody: ordinary.BodyReference;

type TestCallSignatures = {
    (
        ...input: readonly [definition: {
            readonly annotations?: bench.AuthoringAnnotations;
            readonly body: bench.TestBody | ordinary.BodyReference;
            readonly controls?: bench.AuthoringControls;
            readonly title: string;
        }]
    ): bench.TestCase;
    (...input: readonly [title: string, body: bench.TestBody | ordinary.BodyReference]): bench.TestCase;
};
type SkippedTestCallSignatures = {
    (
        ...input: readonly [definition: {
            readonly annotations?: bench.AuthoringAnnotations;
            readonly controls?: bench.AuthoringControls;
            readonly reason: string;
            readonly title: string;
        }]
    ): bench.TestCase;
    (...input: readonly [title: string, reason: string]): bench.TestCase;
};
type SuiteCallSignatures = {
    (
        ...input: readonly [definition: {
            readonly annotations?: bench.AuthoringAnnotations;
            readonly children: readonly bench.TestNode[];
            readonly controls?: bench.AuthoringControls;
            readonly title: string;
        }]
    ): bench.Suite;
    (...input: readonly [title: string, children: readonly bench.TestNode[]]): bench.Suite;
};

export const testNode = suite('bench', [
    suite('@overkill-dev/bench', [
        test('exports explicit GC request and resolved policy types through both bench surfaces', function (typeScope) {
            typeScope.assert(
                sameType<
                    bench.BenchmarkLifecyclePolicy['garbageCollection'],
                    'after-sample' | 'off' | 'profile-default'
                >()
            );
            typeScope.assert(
                sameType<bench.ResolvedBenchmarkLifecyclePolicy['garbageCollection'], 'after-sample' | 'off'>()
            );
            typeScope.assert(
                sameType<standard.BenchmarkGarbageCollectionRequest, bench.BenchmarkGarbageCollectionRequest>()
            );
            typeScope.assert(
                sameType<standard.BenchmarkGarbageCollectionResult, bench.BenchmarkGarbageCollectionResult>()
            );
            return typeScope.assert.collect();
        }),
        test('preserves object and positional overloads', function (typeScope) {
            typeScope.assert(sameType<IsEqual<typeof bench.test, TestCallSignatures>, true>());
            typeScope.assert(acceptsCall, () => bench.test('referenced', referencedBody));
            typeScope.assert(acceptsCall, () => bench.test({ title: 'referenced', body: referencedBody }));
            typeScope.assert(sameType<IsEqual<typeof bench.skippedTest, SkippedTestCallSignatures>, true>());
            typeScope.assert(sameType<IsEqual<typeof bench.suite, SuiteCallSignatures>, true>());
            return typeScope.assert.collect();
        }),
        test('preserves ordinary authoring signatures and public types', function (typeScope) {
            typeScope.assert(sameType<IsEqual<typeof bench.test, typeof ordinary.test>, true>());
            typeScope.assert(sameType<IsEqual<typeof bench.skippedTest, typeof ordinary.skippedTest>, true>());
            typeScope.assert(sameType<IsEqual<typeof bench.suite, typeof ordinary.suite>, true>());
            typeScope.assert(sameType<IsEqual<typeof bench.table, typeof ordinary.table>, true>());
            typeScope.assert(sameType<IsEqual<typeof bench.defineMacro, typeof ordinary.defineMacro>, true>());
            typeScope.assert(
                sameType<
                    IsEqual<typeof bench.defineParameterizedTestBody, typeof ordinary.defineParameterizedTestBody>,
                    true
                >()
            );
            return typeScope.assert.collect();
        }),
        test('preserves annotation and table types', function (typeScope) {
            typeScope.assert(sameType<bench.AuthoringAnnotations, ordinary.AuthoringAnnotations>());
            typeScope.assert(sameType<bench.AuthoringControls, ordinary.AuthoringControls>());
            typeScope.assert(
                sameType<IsEqual<bench.ParameterizedTestScope<string>, ordinary.ParameterizedTestScope<string>>, true>()
            );
            typeScope.assert(
                sameType<IsEqual<bench.TableDefinition<string>, ordinary.TableDefinition<string>>, true>()
            );
            typeScope.assert(sameType<IsEqual<bench.TableTestBody<string>, ordinary.TableTestBody<string>>, true>());
            return typeScope.assert.collect();
        }),
        test('infers parameterized bodies and macro return types', function (typeScope) {
            const body = bench.defineParameterizedTestBody(function (scope, value: number) {
                typeScope.assert(sameType<IsEqual<typeof scope, bench.TestScope>, true>());
                scope.assert.equal(value, parameterValue);
                return scope.assert.collect();
            });
            const child = bench.test('value', body(parameterValue));
            const macro = bench.defineMacro(function (title: string) {
                return bench.suite(title, [ child ]);
            });

            typeScope.assert(sameType<IsEqual<typeof child, bench.TestCase>, true>());
            typeScope.assert(sameType.withActual<true>(), isEqualTo<bench.Suite>()(macro('suite')));
            typeScope.assert(rejectsCall('argument-type'), () => body('invalid'));
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<bench.TestCase>()(bench.test({ body: body(parameterValue), title: 'object form' }))
            );
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<bench.Suite>()(bench.suite({ children: [ child ], title: 'object form' }))
            );
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<bench.TestCase>()(bench.skippedTest('skip', 'unavailable'))
            );
            return typeScope.assert.collect();
        }),
        test('infers table parameters and preserves core node types', function (typeScope) {
            const rows = [ { value: parameterValue } ];
            typeScope.assert(sameType<IsEqual<bench.TestNode, ordinary.TestNode>, true>());
            typeScope.assert(sameType<IsEqual<bench.TestScope, ordinary.TestScope>, true>());
            typeScope.assert(sameType<bench.TestScopeAssertContext, ordinary.TestScopeAssertContext>());
            const authoredTable = bench.table({
                cases: rows,
                test(scope) {
                    typeScope.assert(sameType.withActual<typeof rows[number]>(), scope.parameters);
                    scope.assert.equal(scope.parameters.value, parameterValue);
                    return scope.assert.collect();
                },
                title: 'rows'
            });
            typeScope.assert(sameType<IsEqual<typeof authoredTable, bench.Table>, true>());
            typeScope.assert(sameType<IsEqual<bench.TestBody, ordinary.TestBody>, true>());
            return typeScope.assert.collect();
        })
    ]),
    suite('@overkill-dev/test/bench', [
        test('preserves leaf signatures, annotations, and table types', function (typeScope) {
            typeScope.assert(sameType<IsEqual<typeof standard, typeof bench>, true>());
            typeScope.assert(sameType<standard.AuthoringAnnotations, bench.AuthoringAnnotations>());
            typeScope.assert(sameType<standard.AuthoringControls, bench.AuthoringControls>());
            typeScope.assert(
                sameType<IsEqual<standard.ParameterizedTestScope<string>, bench.ParameterizedTestScope<string>>, true>()
            );
            typeScope.assert(
                sameType<IsEqual<standard.TableDefinition<string>, bench.TableDefinition<string>>, true>()
            );
            typeScope.assert(sameType<IsEqual<standard.TableTestBody<string>, bench.TableTestBody<string>>, true>());
            return typeScope.assert.collect();
        }),
        test('preserves engine node and scope types', function (typeScope) {
            typeScope.assert(sameType<IsEqual<standard.Suite, bench.Suite>, true>());
            typeScope.assert(sameType<IsEqual<standard.Table, bench.Table>, true>());
            typeScope.assert(sameType<IsEqual<standard.TestBody, bench.TestBody>, true>());
            typeScope.assert(sameType<IsEqual<standard.TestCase, bench.TestCase>, true>());
            typeScope.assert(sameType<IsEqual<standard.TestNode, bench.TestNode>, true>());
            typeScope.assert(sameType<IsEqual<standard.TestScope, bench.TestScope>, true>());
            typeScope.assert(sameType<standard.TestScopeAssertContext, bench.TestScopeAssertContext>());
            return typeScope.assert.collect();
        }),
        test('infers table rows and parameterized bodies through the standard subpath', function (typeScope) {
            const authoredTable2 = standard.table({
                cases: [ { value: parameterValue } ],
                test(scope) {
                    typeScope.assert(sameType.withActual<number>(), scope.parameters.value);
                    scope.assert.greaterThan(scope.parameters.value, 0);
                    return scope.assert.collect();
                },
                title: 'rows'
            });
            typeScope.assert(sameType<IsEqual<typeof authoredTable2, standard.Table>, true>());
            const body = standard.defineParameterizedTestBody<number>(function (scope, value) {
                scope.assert.equal(value, parameterValue);
                return scope.assert.collect();
            });

            typeScope.assert(rejectsCall('argument-type'), () => body('invalid'));
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<standard.TestCase>()(standard.test('parameterized', body(parameterValue)))
            );
            return typeScope.assert.collect();
        })
    ]),
    suite('workload types', [
        test('preserves named JSON inputs and deep immutability', function (typeScope) {
            const packages = 5;
            const firstValue = 1;
            const secondValue = 2;
            const small = bench.workload('small', { packages, nested: { values: [ firstValue, secondValue ] } });
            typeScope.assert(sameType.withActual<'small'>(), small.name);
            typeScope.assert(sameType.withActual<typeof packages>(), small.parameters.packages);
            typeScope.assert(
                sameType.withActual<readonly [typeof firstValue, typeof secondValue]>(),
                small.parameters.nested.values
            );
            const mutable = { nested: { values: [ firstValue, secondValue ] } };
            const snapshot = standard.workload('mutable', mutable);
            typeScope.assert(sameType.withActual<readonly number[]>(), snapshot.parameters.nested.values);
            return typeScope.assert.collect();
        }),
        test('rejects non-JSON input types and non-string names', function (typeScope) {
            const invalidName = 42;
            function workloadCallback() {
                return 1;
            }
            typeScope.assert(rejectsCall('argument-type'), () => bench.workload('bad', { callback: workloadCallback }));
            typeScope.assert(rejectsCall('argument-type'), () => bench.workload('bad', []));
            typeScope.assert(rejectsCall('argument-type'), () => bench.workload(invalidName, {}));
            return typeScope.assert.collect();
        })
    ])
]);
