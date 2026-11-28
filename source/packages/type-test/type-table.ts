import { table } from '../../authoring/test-node-authoring.ts';
import {
    attachTestBodyOrigin,
    captureSourceLocation,
    type NonEmptyReadonlyArray,
    type Table,
    type TestBodyOrigin
} from '../engine/engine.entry-point.ts';
import type { TableDefinition } from '../test/table-authoring.ts';
import { isComparisonReference, type ComparisonReference } from './assertion-reference.ts';

type TypeTableCase = {
    readonly title: string;
    readonly assertions: NonEmptyReadonlyArray<ComparisonReference<unknown, unknown>>;
};

type TypeTableDefinition = Pick<TableDefinition<string>, 'annotations' | 'controls' | 'title'> & {
    readonly cases: readonly [TypeTableCase, TypeTableCase, ...readonly TypeTableCase[]];
};

const tableBodies = new WeakSet<TestBodyOrigin['body']>();

export function ownsTypeTableBody(body: TestBodyOrigin['body']): boolean {
    return tableBodies.has(body);
}

export function typeTable(definition: TypeTableDefinition): Table {
    const location = captureSourceLocation();
    for (const row of definition.cases) {
        if (
            !Array.isArray(row.assertions) || row.assertions.length === 0 ||
            !row.assertions.every(isComparisonReference)
        ) {
            throw new TypeError('Each type-table case requires at least one type comparison.');
        }
    }
    function requiresTypeTestFamily(): never {
        throw new Error('This table requires the type-test family. Run it with a type-test profile.');
    }
    tableBodies.add(requiresTypeTestFamily);
    return table({
        ...definition,
        cases: definition.cases.map(function title(row) {
            return row.title;
        }),
        caseTitle(title) {
            return title;
        },
        test: attachTestBodyOrigin(requiresTypeTestFamily, {
            body: requiresTypeTestFamily,
            location
        })
    });
}
