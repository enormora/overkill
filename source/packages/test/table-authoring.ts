import {
    createTable,
    type ResolvableSourceLocation,
    type Table,
    type TableOptions,
    type TestAnnotationsInput,
    type TestBody,
    type TestControlsInput,
    attachTestBodyResourceAttachments,
    hasTestBodyResourceAttachments,
    readTestBodyResourceAttachments,
    type TestScope
} from '../engine/engine.entry-point.ts';
import {
    createAuthoringAnnotations,
    createAuthoringControls,
    readAuthoringAnnotations,
    readAuthoringControls,
    type AuthoringAnnotations,
    type AuthoringControls
} from './authoring-test-data.ts';
import {
    activeMacroSourceLocations,
    definitionLocationsForAuthoringCall,
    runWithForwardedSourceLocations
} from './authoring-source-locations.ts';
import { readAuthoringRecord, readAuthoringString, readAuthoringTestBody } from './authoring-input.ts';
import { attachComposedResourceActions } from './resource-wrapper-composition.ts';
import {
    scopeWrapperStep,
    type ResourceWrapperAction
} from './resource-wrapper-data.ts';

export type ParameterizedTestScope<
    Row,
    Scope extends TestScope = TestScope
> = Scope & {
    readonly parameters: Row;
};

export type TableTestBody<
    Row,
    Scope extends TestScope = TestScope
> = (
    scope: ParameterizedTestScope<Row, Scope>
) => ReturnType<TestBody>;

type AnyTableTestBody = (scope: never) => ReturnType<TestBody>;

export type TableDefinition<
    Row,
    ControlsType extends TestControlsInput = AuthoringControls,
    Body extends AnyTableTestBody = TableTestBody<Row>
> = {
    readonly annotations?: AuthoringAnnotations;
    readonly caseTitle?: (parameters: Row, index: number) => string;
    readonly cases: readonly Row[];
    readonly controls?: ControlsType;
    readonly test: Body;
    readonly title: string;
};

type RuntimeTableDefinition<Row> = {
    readonly annotations: TestAnnotationsInput;
    readonly caseTitle: ((parameters: Row, index: number) => string) | null;
    readonly cases: readonly Row[];
    readonly controls: TestControlsInput;
    readonly test: AnyTableTestBody;
    readonly title: string;
};

type TableCases = TableOptions['cases'];

const tableArgumentsError = 'table() requires ({ title, cases, annotations?, controls?, caseTitle?, test }).';

function defaultCaseTitle(index: number): string {
    return `case ${index + 1}`;
}

function tableCaseTitle<Row>(
    caseTitle: ((parameters: Row, index: number) => string) | null,
    parameters: Row,
    index: number
): string {
    const title = caseTitle === null ? defaultCaseTitle(index) : caseTitle(parameters, index);

    if (typeof title !== 'string') {
        throw new TypeError('table() caseTitle must return a string.');
    }

    return title;
}

function tableCaseBody<Row>(
    definition: RuntimeTableDefinition<Row>,
    parameters: Row,
    sourceLocations: readonly ResolvableSourceLocation[],
    facadeActions: readonly ResourceWrapperAction[]
): TestBody {
    const caseBody = attachComposedResourceActions(
        [
            ...facadeActions,
            scopeWrapperStep('table() parameters', function addTableParameters() {
                return { parameters };
            }, 'replace-existing')
        ],
        definition.test,
        'table'
    );
    const body: TestBody = async function runTableCase(scope: TestScope) {
        return await runWithForwardedSourceLocations(sourceLocations, async function runMacroGeneratedTableCase() {
            return await caseBody(scope);
        });
    };

    return hasTestBodyResourceAttachments(caseBody)
        ? attachTestBodyResourceAttachments(body, readTestBodyResourceAttachments(caseBody))
        : body;
}

function ensureTableDefinitionShape(definition: Readonly<Record<string, unknown>>): void {
    if (definition.caseTitle !== undefined && typeof definition.caseTitle !== 'function') {
        throw new TypeError(tableArgumentsError);
    }

    if (!Array.isArray(definition.cases)) {
        throw new TypeError(tableArgumentsError);
    }

    readAuthoringTestBody(definition.test);
}

function readTableDefinition<
    Row,
    ControlsType extends TestControlsInput,
    Body extends AnyTableTestBody
>(
    definition: TableDefinition<Row, ControlsType, Body>
): RuntimeTableDefinition<Row> {
    const runtimeDefinition = readAuthoringRecord(definition, tableArgumentsError);
    ensureTableDefinitionShape(runtimeDefinition);

    return {
        annotations: readAuthoringAnnotations(runtimeDefinition.annotations ?? {}),
        caseTitle: definition.caseTitle ?? null,
        cases: definition.cases,
        controls: readAuthoringControls(runtimeDefinition.controls ?? {}),
        test: definition.test,
        title: readAuthoringString(runtimeDefinition.title, tableArgumentsError)
    };
}

function tableCases<Row>(
    definition: RuntimeTableDefinition<Row>,
    facadeActions: readonly ResourceWrapperAction[]
): TableCases {
    const sourceLocations = activeMacroSourceLocations();

    return definition.cases.map(function createTableCase(parameters, index) {
        return {
            annotations: {},
            body: tableCaseBody(definition, parameters, sourceLocations, facadeActions),
            controls: {},
            parameters,
            title: tableCaseTitle(definition.caseTitle, parameters, index)
        };
    });
}

export function createAuthoredTable<
    Row,
    ControlsType extends TestControlsInput,
    Body extends AnyTableTestBody = TableTestBody<Row>
>(
    facadeAnnotations: TestAnnotationsInput,
    facadeControls: TestControlsInput,
    definition: TableDefinition<Row, ControlsType, Body>,
    facadeActions: readonly ResourceWrapperAction[] = []
): Table {
    const tableDefinition = readTableDefinition(definition);

    return createTable({
        annotations: createAuthoringAnnotations(facadeAnnotations, tableDefinition.annotations),
        cases: tableCases(tableDefinition, facadeActions),
        controls: createAuthoringControls(facadeControls, tableDefinition.controls),
        definitionLocations: definitionLocationsForAuthoringCall(),
        title: tableDefinition.title
    });
}
