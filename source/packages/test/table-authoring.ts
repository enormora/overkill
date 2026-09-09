import {
    createTable,
    type SourceLocation,
    stampTestNodeFamily,
    type Table,
    type TableOptions,
    type TestAnnotationsInput,
    type TestBody,
    type TestControlsInput,
    type TestFamily,
    type TestScope
} from '../engine/engine.entry-point.ts';
import {
    createAuthoringAnnotations,
    createAuthoringControls,
    readAuthoringAnnotations,
    readAuthoringControls,
    type AuthoringAnnotations,
    type MicrotestAuthoringControls
} from './authoring-test-data.ts';
import {
    activeMacroSourceLocations,
    definitionLocationsForAuthoringCall,
    runWithForwardedSourceLocations
} from './authoring-source-locations.ts';
import {
    readAuthoringRecord,
    readAuthoringString,
    readAuthoringTestBody
} from './authoring-input.ts';

function stampedTable(table: Table, testFamily: TestFamily): Table {
    stampTestNodeFamily(table, testFamily);

    return table;
}

export type ParameterizedTestScope<Row> = TestScope & {
    readonly parameters: Row;
};

export type TableTestBody<Row> = (
    scope: ParameterizedTestScope<Row>
) => ReturnType<TestBody>;

export type TableDefinition<Row, ControlsType extends TestControlsInput = MicrotestAuthoringControls> = {
    readonly annotations?: AuthoringAnnotations;
    readonly caseTitle?: (parameters: Row, index: number) => string;
    readonly cases: readonly Row[];
    readonly controls?: ControlsType;
    readonly test: TableTestBody<Row>;
    readonly title: string;
};

type RuntimeTableDefinition<Row> = {
    readonly annotations: TestAnnotationsInput;
    readonly caseTitle: ((parameters: Row, index: number) => string) | null;
    readonly cases: readonly Row[];
    readonly controls: TestControlsInput;
    readonly test: TableTestBody<Row>;
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
    sourceLocations: readonly SourceLocation[]
): TestBody {
    return async function runTableCase(scope) {
        return await runWithForwardedSourceLocations(sourceLocations, async function runMacroGeneratedTableCase() {
            return await definition.test({ ...scope, parameters });
        });
    };
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

function readTableDefinition<Row, ControlsType extends TestControlsInput>(
    definition: TableDefinition<Row, ControlsType>
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
    definition: RuntimeTableDefinition<Row>
): TableCases {
    const sourceLocations = activeMacroSourceLocations();

    return definition.cases.map(function createTableCase(parameters, index) {
        return {
            annotations: {},
            body: tableCaseBody(definition, parameters, sourceLocations),
            controls: {},
            parameters,
            title: tableCaseTitle(definition.caseTitle, parameters, index)
        };
    });
}

export function createAuthoredTable<Row, ControlsType extends TestControlsInput>(
    testFamily: TestFamily,
    facadeAnnotations: TestAnnotationsInput,
    facadeControls: TestControlsInput,
    definition: TableDefinition<Row, ControlsType>
): Table {
    const tableDefinition = readTableDefinition(definition);

    return stampedTable(
        createTable({
            annotations: createAuthoringAnnotations(facadeAnnotations, tableDefinition.annotations),
            cases: tableCases(tableDefinition),
            controls: createAuthoringControls(testFamily, facadeControls, tableDefinition.controls),
            definitionLocations: definitionLocationsForAuthoringCall(),
            title: tableDefinition.title
        }),
        testFamily
    );
}
