import type {
    TestAnnotationsInput,
    TestBody,
    TestControlsInput,
    TestNode,
    TestScope
} from '../engine/engine.entry-point.ts';
import type {
    ResourceMap,
    RuntimeGraph
} from '../resources/resources.entry-point.ts';
import {
    createAuthoredSkippedTest,
    createAuthoredSuite,
    createAuthoredTest,
    defineMacro,
    defineParameterizedTestBody,
    type SkippedTestAuthor,
    type SuiteAuthor,
    type TableAuthor,
    type TestAuthor
} from '../../authoring/test-node-authoring.ts';
import {
    readTestFacadeDefinition,
    type AuthoringControls,
    type FacadeScope,
    type ReadTestFacadeDefinitionResult,
    type RunIfMain,
    type RunIfMainOptions,
    type TestFacadeDefinition
} from './authoring-test-data.ts';
import {
    createAuthoredTable,
    type ParameterizedTestScope,
    type TableDefinition
} from './table-authoring.ts';
import {
    resourcesWrapperStep,
    runtimeWrapperStep,
    scopeWrapperStep,
    type ResourceWrapperAction
} from './resource-wrapper-data.ts';

export type TestFacade<
    ControlsType extends TestControlsInput = AuthoringControls,
    Scope extends TestScope = TestScope
> = {
    readonly defineMacro: typeof defineMacro;
    readonly defineParameterizedTestBody: typeof defineParameterizedTestBody;
    readonly runIfMain: RunIfMain;
    readonly skippedTest: SkippedTestAuthor<ControlsType>;
    readonly suite: SuiteAuthor<ControlsType>;
    readonly table: TableAuthor<ControlsType, Scope>;
    readonly test: TestAuthor<ControlsType, Scope>;
};

export async function runIfMain(
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options?: RunIfMainOptions
): Promise<void> {
    if (!meta.main) {
        return;
    }

    const runModule = await import('../run/run.entry-point.ts');

    await runModule.runIfMain(meta, testNode, options);
}

type ResolvedTestFacadeDefinition = {
    readonly annotations: TestAnnotationsInput;
    readonly actions: readonly ResourceWrapperAction[];
    readonly controls: TestControlsInput;
};

function createFacadeActions(
    facadeDefinition: ReadTestFacadeDefinitionResult
): readonly ResourceWrapperAction[] {
    const actions: ResourceWrapperAction[] = [];

    if (facadeDefinition.runtime !== null) {
        actions.push(runtimeWrapperStep(facadeDefinition.runtime));
    }

    if (facadeDefinition.resources !== null) {
        actions.push(resourcesWrapperStep(facadeDefinition.resources));
    }

    if (facadeDefinition.mapScope !== null) {
        actions.push(scopeWrapperStep('createTestFacade() mapScope', facadeDefinition.mapScope));
    }

    return Object.freeze(actions);
}

function createTestFacadeFromDefinition<
    Scope extends TestScope
>(facadeDefinition: ResolvedTestFacadeDefinition): TestFacade<AuthoringControls, Scope> {
    return {
        defineMacro,
        defineParameterizedTestBody,
        runIfMain,
        skippedTest(...input) {
            return createAuthoredSkippedTest(
                facadeDefinition.annotations,
                facadeDefinition.controls,
                ...input
            );
        },
        suite(...input) {
            return createAuthoredSuite(
                facadeDefinition.annotations,
                facadeDefinition.controls,
                ...input
            );
        },
        table<Row>(
            tableDefinition: TableDefinition<
                Row,
                AuthoringControls,
                (scope: ParameterizedTestScope<Row, Scope>) => ReturnType<TestBody>
            >
        ) {
            return createAuthoredTable(
                facadeDefinition.annotations,
                facadeDefinition.controls,
                tableDefinition,
                facadeDefinition.actions
            );
        },
        test(...input) {
            return createAuthoredTest(
                facadeDefinition.annotations,
                facadeDefinition.controls,
                facadeDefinition.actions,
                ...input
            );
        }
    };
}

export function createTestFacade(
    definition?: TestFacadeDefinition<null, Readonly<Record<string, never>>, Readonly<Record<string, never>>>
): TestFacade;
export function createTestFacade<
    Runtime extends RuntimeGraph | null = null,
    Resources extends ResourceMap = Readonly<Record<string, never>>,
    MappedScope extends Readonly<Record<string, unknown>> = Readonly<Record<string, never>>
>(
    definition: TestFacadeDefinition<Runtime, Resources, MappedScope>
): TestFacade<AuthoringControls, FacadeScope<Runtime, Resources, MappedScope>>;
export function createTestFacade(definition?: TestFacadeDefinition): TestFacade {
    const facadeDefinition = readTestFacadeDefinition(definition);

    return createTestFacadeFromDefinition({
        ...facadeDefinition,
        actions: createFacadeActions(facadeDefinition)
    });
}
