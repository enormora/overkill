import type { IsEqual } from 'type-fest';
import { suite, test } from '../test/test.entry-point.ts';
import { acceptsCall, rejectsCall, sameType } from '../type-test/type-test.entry-point.ts';
import type * as ordinary from '../test/test.entry-point.ts';
import * as standard from '../test/bench.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
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

export const testNode = suite('Benchmark authoring and workload contracts', [
    suite('Benchmark suites, cases, and workloads', [
        test('exports explicit GC request and resolved policy types through both bench surfaces', function (scope) {
            scope.assert(
                sameType<
                    bench.BenchmarkLifecyclePolicy['garbageCollection'],
                    'after-sample' | 'off' | 'profile-default'
                >()
            );
            scope.assert(
                sameType<bench.ResolvedBenchmarkLifecyclePolicy['garbageCollection'], 'after-sample' | 'off'>()
            );
            scope.assert(
                sameType<
                    IsEqual<standard.BenchmarkGarbageCollectionRequest, bench.BenchmarkGarbageCollectionRequest>,
                    true
                >()
            );
            scope.assert(
                sameType<
                    IsEqual<standard.BenchmarkGarbageCollectionResult, bench.BenchmarkGarbageCollectionResult>,
                    true
                >()
            );
            return scope.assert.collect();
        }),
        test('preserves object and positional overloads', function (scope) {
            scope.assert(sameType<IsEqual<typeof bench.test, TestCallSignatures>, true>());
            scope.assert(acceptsCall, function () {
                return bench.test('referenced', referencedBody);
            });
            scope.assert(acceptsCall, function () {
                return bench.test({ title: 'referenced', body: referencedBody });
            });
            scope.assert(sameType<IsEqual<typeof bench.skippedTest, SkippedTestCallSignatures>, true>());
            scope.assert(sameType<IsEqual<typeof bench.suite, SuiteCallSignatures>, true>());
            return scope.assert.collect();
        }),
        test('preserves ordinary authoring signatures and public types', function (scope) {
            scope.assert(sameType<IsEqual<typeof bench.test, typeof ordinary.test>, true>());
            scope.assert(sameType<IsEqual<typeof bench.skippedTest, typeof ordinary.skippedTest>, true>());
            scope.assert(sameType<IsEqual<typeof bench.suite, typeof ordinary.suite>, true>());
            scope.assert(sameType<IsEqual<typeof bench.table, typeof ordinary.table>, true>());
            scope.assert(sameType<IsEqual<typeof bench.defineMacro, typeof ordinary.defineMacro>, true>());
            scope.assert(
                sameType<
                    IsEqual<typeof bench.defineParameterizedTestBody, typeof ordinary.defineParameterizedTestBody>,
                    true
                >()
            );
            return scope.assert.collect();
        }),
        test('preserves annotation and table types', function (scope) {
            scope.assert(sameType<IsEqual<bench.AuthoringAnnotations, ordinary.AuthoringAnnotations>, true>());
            scope.assert(sameType<IsEqual<bench.AuthoringControls, ordinary.AuthoringControls>, true>());
            scope.assert(
                sameType<IsEqual<bench.ParameterizedTestScope<string>, ordinary.ParameterizedTestScope<string>>, true>()
            );
            scope.assert(
                sameType<IsEqual<bench.TableDefinition<string>, ordinary.TableDefinition<string>>, true>()
            );
            scope.assert(sameType<IsEqual<bench.TableTestBody<string>, ordinary.TableTestBody<string>>, true>());
            return scope.assert.collect();
        }),
        test('infers parameterized bodies and macro return types', function (scope) {
            const body = bench.defineParameterizedTestBody(function (callbackScope, value: number) {
                scope.assert(sameType<IsEqual<typeof callbackScope, bench.TestScope>, true>());
                callbackScope.assert.equal(value, parameterValue);
                return callbackScope.assert.collect();
            });
            const child = bench.test('value', body(parameterValue));
            const macro = bench.defineMacro(function (title: string) {
                return bench.suite(title, [ child ]);
            });

            scope.assert(sameType<IsEqual<typeof child, bench.TestCase>, true>());
            scope.assert(sameType.withActual<true>(), isEqualTo<bench.Suite>()(macro('suite')));
            scope.assert(rejectsCall('argument-type'), function () {
                return body('invalid');
            });
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<bench.TestCase>()(bench.test({ body: body(parameterValue), title: 'object form' }))
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<bench.Suite>()(bench.suite({ children: [ child ], title: 'object form' }))
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<bench.TestCase>()(bench.skippedTest('skip', 'unavailable'))
            );
            return scope.assert.collect();
        }),
        test('infers table parameters and preserves core node types', function (scope) {
            const rows = [ { value: parameterValue } ];
            scope.assert(sameType<IsEqual<bench.TestNode, ordinary.TestNode>, true>());
            scope.assert(sameType<IsEqual<bench.TestScope, ordinary.TestScope>, true>());
            scope.assert(sameType<IsEqual<bench.TestScopeAssertContext, ordinary.TestScopeAssertContext>, true>());
            const authoredTable = bench.table({
                cases: rows,
                test(callbackScope) {
                    scope.assert(
                        sameType.withActual<true>(),
                        isEqualTo<typeof rows[number]>()(callbackScope.parameters)
                    );
                    callbackScope.assert.equal(callbackScope.parameters.value, parameterValue);
                    return callbackScope.assert.collect();
                },
                title: 'rows'
            });
            scope.assert(sameType.withActual<true>(), isEqualTo<bench.Table>()(authoredTable));
            scope.assert(sameType<IsEqual<bench.TestBody, ordinary.TestBody>, true>());
            return scope.assert.collect();
        })
    ]),
    suite('Benchmark authoring through the test facade', [
        test('preserves leaf signatures, annotations, and table types', function (scope) {
            scope.assert(sameType<IsEqual<typeof standard, typeof bench>, true>());
            scope.assert(sameType<IsEqual<standard.AuthoringAnnotations, bench.AuthoringAnnotations>, true>());
            scope.assert(sameType<IsEqual<standard.AuthoringControls, bench.AuthoringControls>, true>());
            scope.assert(
                sameType<IsEqual<standard.ParameterizedTestScope<string>, bench.ParameterizedTestScope<string>>, true>()
            );
            scope.assert(
                sameType<IsEqual<standard.TableDefinition<string>, bench.TableDefinition<string>>, true>()
            );
            scope.assert(sameType<IsEqual<standard.TableTestBody<string>, bench.TableTestBody<string>>, true>());
            return scope.assert.collect();
        }),
        test('preserves engine node and scope types', function (scope) {
            scope.assert(sameType<IsEqual<standard.Suite, bench.Suite>, true>());
            scope.assert(sameType<IsEqual<standard.Table, bench.Table>, true>());
            scope.assert(sameType<IsEqual<standard.TestBody, bench.TestBody>, true>());
            scope.assert(sameType<IsEqual<standard.TestCase, bench.TestCase>, true>());
            scope.assert(sameType<IsEqual<standard.TestNode, bench.TestNode>, true>());
            scope.assert(sameType<IsEqual<standard.TestScope, bench.TestScope>, true>());
            scope.assert(sameType<IsEqual<standard.TestScopeAssertContext, bench.TestScopeAssertContext>, true>());
            return scope.assert.collect();
        }),
        test('infers table rows and parameterized bodies through the standard subpath', function (scope) {
            const authoredTable2 = standard.table({
                cases: [ { value: parameterValue } ],
                test(callbackScope) {
                    scope.assert(sameType.withActual<number>(), callbackScope.parameters.value);
                    callbackScope.assert.greaterThan(callbackScope.parameters.value, 0);
                    return callbackScope.assert.collect();
                },
                title: 'rows'
            });
            scope.assert(sameType.withActual<true>(), isEqualTo<standard.Table>()(authoredTable2));
            const body = standard.defineParameterizedTestBody<number>(function (callbackScope, value) {
                callbackScope.assert.equal(value, parameterValue);
                return callbackScope.assert.collect();
            });

            scope.assert(rejectsCall('argument-type'), function () {
                return body('invalid');
            });
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<standard.TestCase>()(standard.test('parameterized', body(parameterValue)))
            );
            return scope.assert.collect();
        })
    ]),
    suite('workload types', [
        suite('preserves named JSON inputs and deep immutability', [
            test('preserves literal JSON inputs', function (scope) {
                const packages = 5;
                const firstValue = 1;
                const secondValue = 2;
                const small = bench.workload('small', { packages, nested: { values: [ firstValue, secondValue ] } });
                scope.assert(sameType.withActual<'small'>(), small.name);
                scope.assert(sameType.withActual<true>(), isEqualTo<typeof packages>()(small.parameters.packages));
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<readonly [typeof firstValue, typeof secondValue]>()(small.parameters.nested.values)
                );
                return scope.assert.collect();
            }),
            test('makes mutable JSON inputs readonly', function (scope) {
                const firstValue = 1;
                const secondValue = 2;
                const mutable = { nested: { values: [ firstValue, secondValue ] } };
                const snapshot = standard.workload('mutable', mutable);
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<readonly number[]>()(snapshot.parameters.nested.values)
                );
                return scope.assert.collect();
            })
        ]),
        test('rejects non-JSON input types and non-string names', function (scope) {
            const invalidName = 42;
            function workloadCallback(): number {
                return 1;
            }
            scope.assert(rejectsCall('argument-type'), function () {
                return bench.workload('bad', { callback: workloadCallback });
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return bench.workload('bad', []);
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return bench.workload(invalidName, {});
            });
            return scope.assert.collect();
        })
    ])
]);
