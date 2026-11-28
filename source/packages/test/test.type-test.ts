import type { IsEqual } from 'type-fest';
import { acceptsCall, rejectsCall, sameType } from '../type-test/type-test.entry-point.ts';
import type {
    Suite,
    Table,
    TestAnnotationsInput,
    TestBody,
    TestCase,
    TestControlsInput,
    TestNode,
    TestScope
} from '../engine/engine.entry-point.ts';
import { hasKey, isEqualTo, type IsAssignable } from '../../test-support/type-relations.ts';
import {
    type AuthoringAnnotations,
    type AuthoringControls,
    createTestFacade,
    defineMacro,
    defineParameterizedTestBody,
    type ParameterizedTestScope,
    runIfMain,
    skippedTest,
    table,
    type TableDefinition,
    type TableTestBody,
    type TestFacade,
    suite,
    test
} from './test.entry-point.ts';

declare const body: TestBody;
declare const annotations: AuthoringAnnotations;
declare const authoringControls: AuthoringControls;
declare const engineControls: TestControlsInput;
declare const dynamicScopeMap: Readonly<Record<string, unknown>>;
declare const node: TestNode;
declare const tableBody: TableTestBody<{ readonly value: number; }>;

declare const createTestFacadeUnderTest: typeof createTestFacade;

export const testNode = suite('Test authoring and facade contracts', [
    suite('Reusable bodies and facade nodes', [
        test('defines reusable source-aware macros and parameterized bodies', function (scope) {
            const macro = defineMacro(function reusableCase(title: string, value: number) {
                scope.assert(sameType.withActual<string>(), title);
                scope.assert(sameType.withActual<number>(), value);

                return test(title, body);
            });
            const parameterizedBody = defineParameterizedTestBody<{ readonly value: number; }>(function bodyForData(
                callbackScope,
                data
            ) {
                scope.assert(sameType<IsEqual<typeof callbackScope, TestScope>, true>());
                scope.assert(sameType.withActual<number>(), data.value);

                return callbackScope.assert.collect();
            });

            scope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(macro('value case', 1)));
            scope.assert(sameType.withActual<true>(), isEqualTo<TestBody>()(parameterizedBody({ value: 1 })));
            return scope.assert.collect();
        }),
        test('creates neutral test facade nodes', function (scope) {
            const facade = createTestFacade({
                controls: authoringControls
            });

            scope.assert(sameType<IsEqual<typeof facade, TestFacade>, true>());
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<TestCase>()(facade.skippedTest('skips', 'unsupported platform'))
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<TestCase>()(facade.skippedTest({
                    controls: { capture: 'live' },
                    reason: 'unsupported platform',
                    title: 'skips'
                }))
            );
            scope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(facade.test('passes', body)));
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<TestCase>()(facade.test({ body, controls: { capture: 'live' }, title: 'passes' }))
            );
            scope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(facade.suite('group', [ node ])));
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<Suite>()(
                    facade.suite({ children: [ node ], controls: { capture: 'buffered' }, title: 'group' })
                )
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<Table>()(facade.table({
                    cases: [ { value: 1 } ],
                    controls: { capture: 'live' },
                    test: tableBody,
                    title: 'rows'
                }))
            );
            return scope.assert.collect();
        }),
        test('creates neutral facade macro forms', function (scope) {
            const facade = createTestFacade({
                annotations
            });
            const macro = facade.defineMacro(function reusableCase(title: string) {
                return facade.test(title, body);
            });
            const parameterizedBody = facade.defineParameterizedTestBody<{ readonly value: number; }>(
                function bodyForData(
                    callbackScope,
                    data
                ) {
                    scope.assert(sameType<IsEqual<typeof callbackScope, TestScope>, true>());
                    scope.assert(sameType.withActual<number>(), data.value);

                    return callbackScope.assert.collect();
                }
            );

            scope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(macro('value case')));
            scope.assert(sameType.withActual<true>(), isEqualTo<TestBody>()(parameterizedBody({ value: 1 })));
            return scope.assert.collect();
        }),
        test('keeps neutral facades narrow', function (scope) {
            const facade = createTestFacade({
                annotations
            });

            scope.assert(sameType.withActual<false>(), hasKey<'doubleUsage'>()(facade));
            scope.assert(sameType.withActual<false>(), hasKey<'testDouble'>()(facade));
            scope.assert(sameType.withActual<false>(), hasKey<'defineHarness'>()(facade));
            scope.assert(sameType.withActual<false>(), hasKey<'defineCompositeAssertion'>()(facade));
            return scope.assert.collect();
        }),
        suite('guards facade scope mapping against core scope keys', [
            test('preserves explicit mapped scopes', function (scope) {
                const assertScopeOptions = {
                    mapScope(callbackScope: TestScope) {
                        return { assert: callbackScope.assert };
                    }
                };
                scope.assert(rejectsCall('no-matching-overload'), function () {
                    return createTestFacade(assertScopeOptions);
                });
                const collectScopeOptions = {
                    mapScope() {
                        return { collect: true };
                    }
                };
                scope.assert(rejectsCall('no-matching-overload'), function () {
                    return createTestFacade(collectScopeOptions);
                });
                const parametersScopeOptions = {
                    mapScope() {
                        return { parameters: { value: 1 } };
                    }
                };
                scope.assert(rejectsCall('no-matching-overload'), function () {
                    return createTestFacade(parametersScopeOptions);
                });
                return scope.assert.collect();
            }),
            test('rejects shadowing core scope keys', function (scope) {
                const resourcesScopeOptions = {
                    mapScope() {
                        return { resources: {} };
                    }
                };
                scope.assert(rejectsCall('no-matching-overload'), function () {
                    return createTestFacade(resourcesScopeOptions);
                });
                const runtimesScopeOptions = {
                    mapScope() {
                        return { runtimes: {} };
                    }
                };
                scope.assert(rejectsCall('no-matching-overload'), function () {
                    return createTestFacade(runtimesScopeOptions);
                });
                scope.assert(acceptsCall, function () {
                    return createTestFacadeUnderTest({
                        mapScope() {
                            return dynamicScopeMap;
                        }
                    });
                });
                return scope.assert.collect();
            })
        ]),
        suite('creates test, suite, and table nodes from default root authoring forms', [
            test('exposes default test and suite forms', function (scope) {
                scope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(test('passes', body)));
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<TestCase>()(test({ annotations, body, controls: authoringControls, title: 'passes' }))
                );
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<TestCase>()(skippedTest('skips', 'unsupported platform'))
                );
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<TestCase>()(skippedTest({
                        annotations,
                        controls: authoringControls,
                        reason: 'unsupported platform',
                        title: 'skips'
                    }))
                );
                scope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(suite('group', [ node ])));
                return scope.assert.collect();
            }),
            test('exposes default table forms', function (scope) {
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<Suite>()(
                        suite({ annotations, children: [ node ], controls: authoringControls, title: 'group' })
                    )
                );
                const authoredTable = table({
                    annotations,
                    cases: [ { value: 1 } ],
                    caseTitle(parameters, index) {
                        scope.assert(sameType.withActual<number>(), parameters.value);
                        scope.assert(sameType.withActual<number>(), index);

                        return String(parameters.value);
                    },
                    controls: authoringControls,
                    test: tableBody,
                    title: 'rows'
                });
                scope.assert(sameType.withActual<true>(), isEqualTo<Table>()(authoredTable));
                scope.assert(sameType<
                    [{
                        readonly cases: readonly [{ readonly value: number; }, { readonly value: number; }];
                        readonly test: TableTestBody<{ readonly value: number; }>;
                        readonly title: string;
                    }] extends [TableDefinition<{ readonly value: number; }>] ? true : false,
                    true
                >());
                scope.assert(
                    sameType<
                        [ParameterizedTestScope<{ readonly value: number; }>] extends [TestScope] ? true : false,
                        true
                    >()
                );
                return scope.assert.collect();
            })
        ]),
        test('rejects unstaged root authoring forms', function (scope) {
            scope.assert(rejectsCall('argument-count'), function () {
                return test('passes', annotations, body);
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return test({ body, name: 'passes' });
            });
            scope.assert(
                rejectsCall('argument-count'),
                function () {
                    return skippedTest('skips', annotations, 'unsupported platform');
                }
            );
            scope.assert(
                rejectsCall('argument-type'),
                function () {
                    return skippedTest({ name: 'skips', reason: 'unsupported platform' });
                }
            );
            scope.assert(rejectsCall('argument-count'), function () {
                return suite('group', annotations, [ node ]);
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return suite({ children: [ node ], name: 'group' });
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return suite('group', [ {
                    annotations: {},
                    controls: {},
                    kind: 'test',
                    title: 'plain'
                } ]);
            });
            scope.assert(
                rejectsCall('argument-type'),
                function () {
                    return table({ cases: [ { value: 1 } ], name: 'rows', test: tableBody });
                }
            );
            return scope.assert.collect();
        }),
        test('defines narrow high-level authoring test data', function (scope) {
            scope.assert(sameType<
                IsEqual<AuthoringAnnotations, {
                    readonly ownership?: readonly string[];
                    readonly tags?: readonly string[];
                }>,
                true
            >());
            scope.assert(sameType<IsAssignable<AuthoringAnnotations, TestAnnotationsInput>, true>());
            scope.assert(sameType<
                IsEqual<AuthoringControls, {
                    readonly capture?: 'buffered' | 'live';
                    readonly duplicateExecution?: 'forbidden' | 'idempotent';
                    readonly timeoutMilliseconds?: number;
                }>,
                true
            >());
            scope.assert(sameType<IsAssignable<AuthoringControls, TestControlsInput>, true>());
            return scope.assert.collect();
        }),
        test('rejects removed high-level authoring metadata', function (scope) {
            scope.assert(rejectsCall('no-matching-overload'), function () {
                return createTestFacade({ metadata: annotations });
            });
            scope.assert(rejectsCall('no-matching-overload'), function () {
                return createTestFacade({
                    testFamily: 'microtest'
                });
            });
            scope.assert(
                rejectsCall('argument-type'),
                function () {
                    return test({ body, metadata: { kind: 'microtest' }, title: 'passes' });
                }
            );
            scope.assert(rejectsCall('argument-type'), function () {
                return suite({
                    children: [ node ],
                    metadata: { ownership: [ '@runtime' ] },
                    title: 'group'
                });
            });
            scope.assert(acceptsCall, function () {
                return table({
                    cases: [ { value: 1 } ],
                    controls: { capture: 'live' },
                    test: tableBody,
                    title: 'rows'
                });
            });
            scope.assert(acceptsCall, async function () {
                return runIfMain(import.meta, node, {
                    root: {
                        controls: engineControls,
                        title: 'root'
                    }
                });
            });
            return scope.assert.collect();
        })
    ])
]);
