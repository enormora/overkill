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
import type {
    createTestFacade,
    defineMacro,
    Metadata as RootMetadata,
    runIfMain,
    RunIfMainOptions as RootRunIfMainOptions,
    RunIfMainRootOptions as RootRunIfMainRootOptions,
    suite,
    Suite as RootSuite,
    table,
    Table as RootTable,
    test,
    TestBody as RootTestBody,
    TestCase as RootTestCase,
    TestNode as RootTestNode,
    TestScope as RootTestScope,
    TestScopeAssertContext as RootTestScopeAssertContext
} from './test.entry-point.ts';

type UnavailableAuthoringApi = (...parameters: readonly unknown[]) => never;
type RootRuntimeExport = keyof {
    readonly createTestFacade: typeof createTestFacade;
    readonly defineMacro: typeof defineMacro;
    readonly runIfMain: typeof runIfMain;
    readonly suite: typeof suite;
    readonly table: typeof table;
    readonly test: typeof test;
};

describe('@overkill-dev/test', function () {
    typeTest('reserves root authoring names with placeholder signatures', function () {
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
        expect<typeof suite>().type.toBe<UnavailableAuthoringApi>();
        expect<typeof table>().type.toBe<UnavailableAuthoringApi>();
        expect<typeof test>().type.toBe<UnavailableAuthoringApi>();
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
