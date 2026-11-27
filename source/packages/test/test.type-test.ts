import type { IsEqual } from 'type-fest';
import { suite as typeSuite, test as typeTest } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
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

export const testNode = typeSuite('test', [
    typeSuite('@overkill-dev/test authoring', [
        typeTest('defines reusable source-aware macros and parameterized bodies', function (typeScope) {
            const macro = defineMacro(function reusableCase(title: string, value: number) {
                typeScope.assert(sameType.withActual<string>(), title);
                typeScope.assert(sameType.withActual<number>(), value);

                return test(title, body);
            });
            const parameterizedBody = defineParameterizedTestBody<{ readonly value: number; }>(function bodyForData(
                scope,
                data
            ) {
                typeScope.assert(sameType<IsEqual<typeof scope, TestScope>, true>());
                typeScope.assert(sameType.withActual<number>(), data.value);

                return scope.assert.collect();
            });

            typeScope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(macro('value case', 1)));
            typeScope.assert(sameType.withActual<true>(), isEqualTo<TestBody>()(parameterizedBody({ value: 1 })));
            return typeScope.assert.collect();
        }),
        typeTest('creates neutral test facade nodes', function (typeScope) {
            const facade = createTestFacade({
                controls: authoringControls
            });

            typeScope.assert(sameType<IsEqual<typeof facade, TestFacade>, true>());
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<TestCase>()(facade.skippedTest('skips', 'unsupported platform'))
            );
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<TestCase>()(facade.skippedTest({
                    controls: { capture: 'live' },
                    reason: 'unsupported platform',
                    title: 'skips'
                }))
            );
            typeScope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(facade.test('passes', body)));
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<TestCase>()(facade.test({ body, controls: { capture: 'live' }, title: 'passes' }))
            );
            typeScope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(facade.suite('group', [ node ])));
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<Suite>()(
                    facade.suite({ children: [ node ], controls: { capture: 'buffered' }, title: 'group' })
                )
            );
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<Table>()(facade.table({
                    cases: [ { value: 1 } ],
                    controls: { capture: 'live' },
                    test: tableBody,
                    title: 'rows'
                }))
            );
            return typeScope.assert.collect();
        }),
        typeTest('creates neutral facade macro forms', function (typeScope) {
            const facade = createTestFacade({
                annotations
            });
            const macro = facade.defineMacro(function reusableCase(title: string) {
                return facade.test(title, body);
            });
            const parameterizedBody = facade.defineParameterizedTestBody<{ readonly value: number; }>(
                function bodyForData(
                    scope,
                    data
                ) {
                    typeScope.assert(sameType<IsEqual<typeof scope, TestScope>, true>());
                    typeScope.assert(sameType.withActual<number>(), data.value);

                    return scope.assert.collect();
                }
            );

            typeScope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(macro('value case')));
            typeScope.assert(sameType.withActual<true>(), isEqualTo<TestBody>()(parameterizedBody({ value: 1 })));
            return typeScope.assert.collect();
        }),
        typeTest('keeps neutral facades narrow', function (typeScope) {
            const facade = createTestFacade({
                annotations
            });

            typeScope.assert(sameType.withActual<false>(), hasKey<'doubleUsage'>()(facade));
            typeScope.assert(sameType.withActual<false>(), hasKey<'testDouble'>()(facade));
            typeScope.assert(sameType.withActual<false>(), hasKey<'defineHarness'>()(facade));
            typeScope.assert(sameType.withActual<false>(), hasKey<'defineCompositeAssertion'>()(facade));
            return typeScope.assert.collect();
        }),
        typeSuite('guards facade scope mapping against core scope keys', [
            typeTest('preserves explicit mapped scopes', function (typeScope) {
                const assertScopeOptions = {
                    mapScope(scope: TestScope) {
                        return { assert: scope.assert };
                    }
                };
                typeScope.assert(rejectsCall('no-matching-overload'), () => createTestFacade(assertScopeOptions));
                const collectScopeOptions = {
                    mapScope() {
                        return { collect: true };
                    }
                };
                typeScope.assert(rejectsCall('no-matching-overload'), () => createTestFacade(collectScopeOptions));
                const parametersScopeOptions = {
                    mapScope() {
                        return { parameters: { value: 1 } };
                    }
                };
                typeScope.assert(rejectsCall('no-matching-overload'), () => createTestFacade(parametersScopeOptions));
                return typeScope.assert.collect();
            }),
            typeTest('rejects shadowing core scope keys', function (typeScope) {
                const resourcesScopeOptions = {
                    mapScope() {
                        return { resources: {} };
                    }
                };
                typeScope.assert(rejectsCall('no-matching-overload'), () => createTestFacade(resourcesScopeOptions));
                const runtimesScopeOptions = {
                    mapScope() {
                        return { runtimes: {} };
                    }
                };
                typeScope.assert(rejectsCall('no-matching-overload'), () => createTestFacade(runtimesScopeOptions));
                typeScope.assert(acceptsCall, () =>
                    createTestFacadeUnderTest({
                        mapScope() {
                            return dynamicScopeMap;
                        }
                    }));
                return typeScope.assert.collect();
            })
        ]),
        typeSuite('creates test, suite, and table nodes from default root authoring forms', [
            typeTest('exposes default test and suite forms', function (typeScope) {
                typeScope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(test('passes', body)));
                typeScope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<TestCase>()(test({ annotations, body, controls: authoringControls, title: 'passes' }))
                );
                typeScope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<TestCase>()(skippedTest('skips', 'unsupported platform'))
                );
                typeScope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<TestCase>()(skippedTest({
                        annotations,
                        controls: authoringControls,
                        reason: 'unsupported platform',
                        title: 'skips'
                    }))
                );
                typeScope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(suite('group', [ node ])));
                return typeScope.assert.collect();
            }),
            typeTest('exposes default table forms', function (typeScope) {
                typeScope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<Suite>()(
                        suite({ annotations, children: [ node ], controls: authoringControls, title: 'group' })
                    )
                );
                const authoredTable = table({
                    annotations,
                    cases: [ { value: 1 } ],
                    caseTitle(parameters, index) {
                        typeScope.assert(sameType.withActual<number>(), parameters.value);
                        typeScope.assert(sameType.withActual<number>(), index);

                        return String(parameters.value);
                    },
                    controls: authoringControls,
                    test: tableBody,
                    title: 'rows'
                });
                typeScope.assert(sameType.withActual<true>(), isEqualTo<Table>()(authoredTable));
                typeScope.assert(sameType<
                    [{
                        readonly cases: readonly [{ readonly value: number; }, { readonly value: number; }];
                        readonly test: TableTestBody<{ readonly value: number; }>;
                        readonly title: string;
                    }] extends [TableDefinition<{ readonly value: number; }>] ? true : false,
                    true
                >());
                typeScope.assert(
                    sameType<
                        [ParameterizedTestScope<{ readonly value: number; }>] extends [TestScope] ? true : false,
                        true
                    >()
                );
                return typeScope.assert.collect();
            })
        ]),
        typeTest('rejects unstaged root authoring forms', function (typeScope) {
            typeScope.assert(rejectsCall('argument-count'), () => test('passes', annotations, body));
            typeScope.assert(rejectsCall('argument-type'), () => test({ body, name: 'passes' }));
            typeScope.assert(
                rejectsCall('argument-count'),
                () => skippedTest('skips', annotations, 'unsupported platform')
            );
            typeScope.assert(
                rejectsCall('argument-type'),
                () => skippedTest({ name: 'skips', reason: 'unsupported platform' })
            );
            typeScope.assert(rejectsCall('argument-count'), () => suite('group', annotations, [ node ]));
            typeScope.assert(rejectsCall('argument-type'), () => suite({ children: [ node ], name: 'group' }));
            typeScope.assert(rejectsCall('argument-type'), () =>
                suite('group', [ {
                    annotations: {},
                    controls: {},
                    kind: 'test',
                    title: 'plain'
                } ]));
            typeScope.assert(
                rejectsCall('argument-type'),
                () => table({ cases: [ { value: 1 } ], name: 'rows', test: tableBody })
            );
            return typeScope.assert.collect();
        }),
        typeTest('defines narrow high-level authoring test data', function (typeScope) {
            typeScope.assert(sameType<
                IsEqual<AuthoringAnnotations, {
                    readonly ownership?: readonly string[];
                    readonly tags?: readonly string[];
                }>,
                true
            >());
            typeScope.assert(sameType<IsAssignable<AuthoringAnnotations, TestAnnotationsInput>, true>());
            typeScope.assert(sameType<
                IsEqual<AuthoringControls, {
                    readonly capture?: 'buffered' | 'live';
                    readonly duplicateExecution?: 'forbidden' | 'idempotent';
                    readonly timeoutMilliseconds?: number;
                }>,
                true
            >());
            typeScope.assert(sameType<IsAssignable<AuthoringControls, TestControlsInput>, true>());
            return typeScope.assert.collect();
        }),
        typeTest('rejects removed high-level authoring metadata', function (typeScope) {
            typeScope.assert(rejectsCall('no-matching-overload'), () => createTestFacade({ metadata: annotations }));
            typeScope.assert(rejectsCall('no-matching-overload'), () =>
                createTestFacade({
                    testFamily: 'microtest'
                }));
            typeScope.assert(
                rejectsCall('argument-type'),
                () => test({ body, metadata: { kind: 'microtest' }, title: 'passes' })
            );
            typeScope.assert(rejectsCall('argument-type'), () =>
                suite({
                    children: [ node ],
                    metadata: { ownership: [ '@runtime' ] },
                    title: 'group'
                }));
            typeScope.assert(acceptsCall, () =>
                table({
                    cases: [ { value: 1 } ],
                    controls: { capture: 'live' },
                    test: tableBody,
                    title: 'rows'
                }));
            typeScope.assert(acceptsCall, async () =>
                runIfMain(import.meta, node, {
                    root: {
                        controls: engineControls,
                        title: 'root'
                    }
                }));
            return typeScope.assert.collect();
        })
    ])
]);
