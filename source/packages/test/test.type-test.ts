import { describe, expect, test as typeTest } from 'tstyche';
import type {
    Metadata,
    RunIfMainOptions,
    RunIfMainRootOptions,
    Suite,
    Table,
    TestBody,
    TestCase,
    TestNode,
    TestScope,
    TestScopeAssertContext
} from '../engine/engine.entry-point.ts';
import {
    type createTestFacade,
    type defineMacro,
    type Metadata as RootMetadata,
    type runIfMain,
    type RunIfMainOptions as RootRunIfMainOptions,
    type RunIfMainRootOptions as RootRunIfMainRootOptions,
    type Suite as RootSuite,
    type table,
    type Table as RootTable,
    type TestBody as RootTestBody,
    type TestCase as RootTestCase,
    type TestNode as RootTestNode,
    type TestScope as RootTestScope,
    type TestScopeAssertContext as RootTestScopeAssertContext,
    suite,
    test
} from './test.entry-point.ts';

type UnavailableAuthoringApi = (...parameters: readonly unknown[]) => never;
declare const body: TestBody;
declare const metadata: Metadata;
declare const node: TestNode;
type RootRuntimeExport = keyof {
    readonly createTestFacade: typeof createTestFacade;
    readonly defineMacro: typeof defineMacro;
    readonly runIfMain: typeof runIfMain;
    readonly suite: typeof suite;
    readonly table: typeof table;
    readonly test: typeof test;
};

describe('@overkill-dev/test', function () {
    typeTest('exposes root authoring names', function () {
        expect<RootRuntimeExport>().type.toBe<
            keyof {
                readonly createTestFacade: true;
                readonly defineMacro: true;
                readonly runIfMain: true;
                readonly suite: true;
                readonly table: true;
                readonly test: true;
            }
        >();
        expect<typeof createTestFacade>().type.toBe<UnavailableAuthoringApi>();
        expect<typeof defineMacro>().type.toBe<UnavailableAuthoringApi>();
        expect<typeof runIfMain>().type.toBe<UnavailableAuthoringApi>();
        expect<typeof table>().type.toBe<UnavailableAuthoringApi>();
    });

    typeTest('creates test and suite nodes from default root authoring forms', function () {
        expect(test('passes', body)).type.toBe<TestCase>();
        expect(test({ body, metadata, name: 'passes' })).type.toBe<TestCase>();
        expect(suite('group', [ node ])).type.toBe<Suite>();
        expect(suite({ children: [ node ], metadata, name: 'group' })).type.toBe<Suite>();
    });

    typeTest('rejects unstaged root authoring forms', function () {
        expect(test).type.not.toBeCallableWith('passes', metadata, body);
        expect(test).type.not.toBeCallableWith({ body, name: 'passes' });
        expect(suite).type.not.toBeCallableWith('group', metadata, [ node ]);
        expect(suite).type.not.toBeCallableWith({ children: [ node ], name: 'group' });
        expect(suite).type.not.toBeCallableWith('group', [ { kind: 'test', metadata: {}, name: 'plain' } ]);
    });

    typeTest('re-exports high-level authoring types from the engine', function () {
        expect<RootMetadata>().type.toBe<Metadata>();
        expect<RootRunIfMainOptions>().type.toBe<RunIfMainOptions>();
        expect<RootRunIfMainRootOptions>().type.toBe<RunIfMainRootOptions>();
        expect<RootSuite>().type.toBe<Suite>();
        expect<RootTable>().type.toBe<Table>();
        expect<RootTestBody>().type.toBe<TestBody>();
        expect<RootTestCase>().type.toBe<TestCase>();
        expect<RootTestNode>().type.toBe<TestNode>();
        expect<RootTestScope>().type.toBe<TestScope>();
        expect<RootTestScopeAssertContext>().type.toBe<TestScopeAssertContext>();
    });
});
