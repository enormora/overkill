import type { IsEqual } from 'type-fest';
import { acceptsCall, rejectsCall, sameType } from '../type-test/type-test.entry-point.ts';
import type {
    DefinedOutputRenderer,
    DefinedReporter,
    InFlightTask,
    Suite,
    Table,
    TestBody,
    TestCase,
    TestNode,
    TestScope,
    TestScopeAssertContext
} from '../engine/engine.entry-point.ts';
import {
    suite,
    type AuthoringAnnotations,
    type AuthoringControls,
    type createTestFacade,
    runIfMain,
    type RunIfMainOptions as RootRunIfMainOptions,
    type RunIfMainRootOptions as RootRunIfMainRootOptions,
    skippedTest,
    type InFlightTask as RootInFlightTask,
    type Suite as RootSuite,
    test,
    type Table as RootTable,
    type TestBody as RootTestBody,
    type TestCase as RootTestCase,
    type TestNode as RootTestNode,
    type TestScope as RootTestScope,
    type TestScopeAssertContext as RootTestScopeAssertContext
} from './test.entry-point.ts';

declare const body: TestBody;
declare const annotations: AuthoringAnnotations;
declare const authoringControls: AuthoringControls;
declare const node: TestNode;
declare const outputRenderer: DefinedOutputRenderer;
declare const reporter: DefinedReporter;

declare const createTestFacadeUnderTest: typeof createTestFacade;

export const testNode = suite('Test capture and direct execution', [
    test('types capture controls as selected-profile policy', function (scope) {
        scope.assert(acceptsCall, function () {
            return createTestFacadeUnderTest({
                controls: authoringControls
            });
        });
        scope.assert(acceptsCall, function () {
            return test({
                body,
                controls: { capture: 'live' },
                title: 'passes'
            });
        });
        scope.assert(acceptsCall, function () {
            return skippedTest({
                controls: { capture: 'live' },
                reason: 'unsupported platform',
                title: 'skips'
            });
        });
        return scope.assert.collect();
    }),
    suite('re-exports high-level authoring types from the engine', [
        test('re-exports engine node and body types', function (scope) {
            scope.assert(sameType<
                IsEqual<RootRunIfMainOptions, {
                    readonly outputRenderer?: DefinedOutputRenderer;
                    readonly reporters?: readonly DefinedReporter[];
                    readonly root?: RootRunIfMainRootOptions;
                }>,
                true
            >());
            scope.assert(sameType<
                IsEqual<RootRunIfMainRootOptions, {
                    readonly annotations?: AuthoringAnnotations;
                    readonly controls?: AuthoringControls;
                    readonly title: string;
                }>,
                true
            >());
            scope.assert(sameType<IsEqual<RootInFlightTask<string>, InFlightTask<string>>, true>());
            scope.assert(sameType<IsEqual<RootSuite, Suite>, true>());
            scope.assert(sameType<IsEqual<RootTable, Table>, true>());
            return scope.assert.collect();
        }),
        test('re-exports engine annotation and planning types', function (scope) {
            scope.assert(sameType<IsEqual<RootTestBody, TestBody>, true>());
            scope.assert(sameType<IsEqual<RootTestCase, TestCase>, true>());
            scope.assert(sameType<IsEqual<RootTestNode, TestNode>, true>());
            scope.assert(sameType<IsEqual<RootTestScope, TestScope>, true>());
            scope.assert(sameType<IsEqual<RootTestScopeAssertContext, TestScopeAssertContext>, true>());
            return scope.assert.collect();
        })
    ]),
    test('runs direct entrypoints with runner-owned options', function (scope) {
        scope.assert(acceptsCall, async function () {
            return runIfMain(import.meta, node);
        });
        scope.assert(acceptsCall, async function () {
            return runIfMain(import.meta, node, {
                outputRenderer,
                reporters: [ reporter ],
                root: {
                    annotations,
                    controls: authoringControls,
                    title: 'root'
                }
            });
        });
        scope.assert(rejectsCall('argument-type'), async function () {
            return runIfMain(import.meta, node, { runFacts: {} });
        });
        scope.assert(
            rejectsCall('argument-type'),
            async function () {
                return runIfMain(import.meta, node, { profile: 'microtest' });
            }
        );
        scope.assert(rejectsCall('argument-type'), async function () {
            return runIfMain(import.meta, node, { cwd: 'project' });
        });
        return scope.assert.collect();
    })
]);
