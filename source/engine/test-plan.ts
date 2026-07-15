import { mergeMetadata, type Metadata, type Table, type TestBody, type TestCase, type TestNode } from './test-node.ts';

export type TestPlanCaseBody = TestBody;

export type TestPlanCase = {
    readonly id: string;
    readonly suitePath: readonly string[];
    readonly metadata: Metadata;
    readonly body: TestPlanCaseBody;
};

export type TestPlan = {
    readonly cases: readonly TestPlanCase[];
};

function caseId(suitePath: readonly string[], name: string): string {
    return [ ...suitePath, name ].join(' > ');
}

function collectTestCase(
    testCase: TestCase,
    suitePath: readonly string[],
    metadata: Metadata
): readonly TestPlanCase[] {
    const resolvedMetadata = mergeMetadata(metadata, testCase.metadata);

    return [
        {
            body: testCase.body,
            id: caseId(suitePath, testCase.name),
            metadata: resolvedMetadata,
            suitePath
        }
    ];
}

function collectTable(table: Table, suitePath: readonly string[], metadata: Metadata): readonly TestPlanCase[] {
    const tablePath = [ ...suitePath, table.name ];
    const tableMetadata = mergeMetadata(metadata, table.metadata);

    return table.cases.map(function collectTableCase(tableCase): TestPlanCase {
        const resolvedMetadata = mergeMetadata(tableMetadata, tableCase.metadata);

        return {
            body: tableCase.body,
            id: caseId(tablePath, tableCase.name),
            metadata: resolvedMetadata,
            suitePath: tablePath
        };
    });
}

function collectNode(node: TestNode, suitePath: readonly string[], metadata: Metadata): readonly TestPlanCase[] {
    if (node.kind === 'test') {
        return collectTestCase(node, suitePath, metadata);
    }

    if (node.kind === 'table') {
        return collectTable(node, suitePath, metadata);
    }

    const childPath = [ ...suitePath, node.name ];
    const childMetadata = mergeMetadata(metadata, node.metadata);

    return node.children.flatMap(function collectChild(child) {
        return collectNode(child, childPath, childMetadata);
    });
}

export function createTestPlan(root: TestNode): TestPlan {
    return {
        cases: collectNode(root, [], {})
    };
}
