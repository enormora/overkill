import { describe, expect, test as typeTest } from 'tstyche';
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
    type CaptureAuthoringControls,
    type createTestFacade,
    runIfMain,
    type RunIfMainOptions as RootRunIfMainOptions,
    type RunIfMainRootOptions as RootRunIfMainRootOptions,
    skippedTest,
    type MicrotestAuthoringControls,
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
declare const captureControls: CaptureAuthoringControls;
declare const microtestControls: MicrotestAuthoringControls;
declare const node: TestNode;
declare const outputRenderer: DefinedOutputRenderer;
declare const reporter: DefinedReporter;

describe('@overkill-dev/test capture and direct execution types', function () {
    typeTest('types capture controls by authored family', function () {
        expect<typeof createTestFacade>().type.toBeCallableWith({
            controls: captureControls,
            testFamily: 'integration'
        });
        expect<typeof createTestFacade>().type.not.toBeCallableWith({
            controls: { capture: 'live' },
            testFamily: 'microtest'
        });
        expect(test).type.not.toBeCallableWith({
            body,
            controls: { capture: 'live' },
            title: 'passes'
        });
        expect(skippedTest).type.not.toBeCallableWith({
            controls: { capture: 'live' },
            reason: 'unsupported platform',
            title: 'skips'
        });
    });

    typeTest('re-exports high-level authoring types from the engine', function () {
        expect<RootRunIfMainOptions>().type.toBe<{
            readonly outputRenderer?: DefinedOutputRenderer;
            readonly reporters?: readonly DefinedReporter[];
            readonly root?: RootRunIfMainRootOptions;
        }>();
        expect<RootRunIfMainRootOptions>().type.toBe<{
            readonly annotations?: AuthoringAnnotations;
            readonly controls?: MicrotestAuthoringControls;
            readonly title: string;
        }>();
        expect<RootInFlightTask<string>>().type.toBe<InFlightTask<string>>();
        expect<RootSuite>().type.toBe<Suite>();
        expect<RootTable>().type.toBe<Table>();
        expect<RootTestBody>().type.toBe<TestBody>();
        expect<RootTestCase>().type.toBe<TestCase>();
        expect<RootTestNode>().type.toBe<TestNode>();
        expect<RootTestScope>().type.toBe<TestScope>();
        expect<RootTestScopeAssertContext>().type.toBe<TestScopeAssertContext>();
    });

    typeTest('runs direct entrypoints with runner-owned options', function () {
        expect(runIfMain).type.toBeCallableWith(import.meta, node);
        expect(runIfMain).type.toBeCallableWith(import.meta, node, {
            outputRenderer,
            reporters: [ reporter ],
            root: {
                annotations,
                controls: microtestControls,
                title: 'root'
            }
        });
        expect(runIfMain).type.not.toBeCallableWith(import.meta, node, { runFacts: {} });
        expect(runIfMain).type.not.toBeCallableWith(import.meta, node, { profile: 'microtest' });
        expect(runIfMain).type.not.toBeCallableWith(import.meta, node, { cwd: 'project' });
    });
});
