import type { IsEqual } from 'type-fest';
import { suite, test as typeTest } from '@overkill-dev/test-type-authoring';
import { acceptsCall, rejectsCall, sameType } from '@overkill-dev/type-test';
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

export const testNode = suite('@overkill-dev/test capture and direct execution types', [
    typeTest('types capture controls as selected-profile policy', function (typeScope) {
        typeScope.assert(acceptsCall, () =>
            createTestFacadeUnderTest({
                controls: authoringControls
            }));
        typeScope.assert(acceptsCall, () =>
            test({
                body,
                controls: { capture: 'live' },
                title: 'passes'
            }));
        typeScope.assert(acceptsCall, () =>
            skippedTest({
                controls: { capture: 'live' },
                reason: 'unsupported platform',
                title: 'skips'
            }));
        return typeScope.assert.collect();
    }),
    suite('re-exports high-level authoring types from the engine', [
        typeTest('re-exports engine node and body types', function (typeScope) {
            typeScope.assert(sameType<
                IsEqual<RootRunIfMainOptions, {
                    readonly outputRenderer?: DefinedOutputRenderer;
                    readonly reporters?: readonly DefinedReporter[];
                    readonly root?: RootRunIfMainRootOptions;
                }>,
                true
            >());
            typeScope.assert(sameType<RootRunIfMainRootOptions, {
                readonly annotations?: AuthoringAnnotations;
                readonly controls?: AuthoringControls;
                readonly title: string;
            }>());
            typeScope.assert(sameType<RootInFlightTask<string>, InFlightTask<string>>());
            typeScope.assert(sameType<IsEqual<RootSuite, Suite>, true>());
            typeScope.assert(sameType<IsEqual<RootTable, Table>, true>());
            return typeScope.assert.collect();
        }),
        typeTest('re-exports engine annotation and planning types', function (typeScope) {
            typeScope.assert(sameType<IsEqual<RootTestBody, TestBody>, true>());
            typeScope.assert(sameType<IsEqual<RootTestCase, TestCase>, true>());
            typeScope.assert(sameType<IsEqual<RootTestNode, TestNode>, true>());
            typeScope.assert(sameType<IsEqual<RootTestScope, TestScope>, true>());
            typeScope.assert(sameType<RootTestScopeAssertContext, TestScopeAssertContext>());
            return typeScope.assert.collect();
        })
    ]),
    typeTest('runs direct entrypoints with runner-owned options', function (typeScope) {
        typeScope.assert(acceptsCall, async () => runIfMain(import.meta, node));
        typeScope.assert(acceptsCall, async () =>
            runIfMain(import.meta, node, {
                outputRenderer,
                reporters: [ reporter ],
                root: {
                    annotations,
                    controls: authoringControls,
                    title: 'root'
                }
            }));
        typeScope.assert(rejectsCall('argument-type'), async () => runIfMain(import.meta, node, { runFacts: {} }));
        typeScope.assert(
            rejectsCall('argument-type'),
            async () => runIfMain(import.meta, node, { profile: 'microtest' })
        );
        typeScope.assert(rejectsCall('argument-type'), async () => runIfMain(import.meta, node, { cwd: 'project' }));
        return typeScope.assert.collect();
    })
]);
