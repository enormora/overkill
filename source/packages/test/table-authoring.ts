import {
    createTable,
    type Metadata,
    type SourceLocation,
    type Table,
    type TableOptions,
    type TestBody,
    type TestFamily,
    type TestScope
} from '../engine/engine.entry-point.ts';
import { createAuthoringMetadata, readAuthoringMetadata, type AuthoringMetadata } from './authoring-metadata.ts';
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

export type ParameterizedTestScope<Row> = TestScope & {
    readonly parameters: Row;
};

export type TableTestBody<Row> = (
    scope: ParameterizedTestScope<Row>
) => ReturnType<TestBody>;

export type TableDefinition<Row, MetadataType extends Metadata = AuthoringMetadata> = {
    readonly caseTitle?: (parameters: Row, index: number) => string;
    readonly cases: readonly Row[];
    readonly metadata?: MetadataType;
    readonly test: TableTestBody<Row>;
    readonly title: string;
};

type RuntimeTableDefinition<Row> = {
    readonly caseTitle: ((parameters: Row, index: number) => string) | null;
    readonly cases: readonly Row[];
    readonly metadata: Metadata;
    readonly test: TableTestBody<Row>;
    readonly title: string;
};

type TableCases = TableOptions['cases'];

const tableArgumentsError = 'table() requires ({ title, cases, metadata?, caseTitle?, test }).';

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

function readTableDefinition<Row, MetadataType extends Metadata>(
    definition: TableDefinition<Row, MetadataType>
): RuntimeTableDefinition<Row> {
    const runtimeDefinition = readAuthoringRecord(definition, tableArgumentsError);
    ensureTableDefinitionShape(runtimeDefinition);

    return {
        caseTitle: definition.caseTitle ?? null,
        cases: definition.cases,
        metadata: readAuthoringMetadata(runtimeDefinition.metadata ?? {}),
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
            body: tableCaseBody(definition, parameters, sourceLocations),
            metadata: {},
            parameters,
            title: tableCaseTitle(definition.caseTitle, parameters, index)
        };
    });
}

export function createAuthoredTable<Row, MetadataType extends Metadata>(
    testFamily: TestFamily,
    facadeMetadata: Metadata,
    definition: TableDefinition<Row, MetadataType>
): Table {
    const tableDefinition = readTableDefinition(definition);

    return createTable({
        cases: tableCases(tableDefinition),
        definitionLocations: definitionLocationsForAuthoringCall(),
        metadata: createAuthoringMetadata(testFamily, facadeMetadata, tableDefinition.metadata),
        title: tableDefinition.title
    });
}
