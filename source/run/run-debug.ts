import { z } from 'zod/v4';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import type { ExecuteDebugSelection } from '../engine/test-debug.ts';
import type { RunDebugRequest } from './run-types.ts';
import { matchesRunFilter } from './run-selection-filters.ts';
import { parseRunFilterExpression } from './run-filter-grammar.ts';

export const runDebugRequestSchema = z.union([
    z.strictObject({ mode: z.enum([ 'off', 'all' ]), selectors: z.tuple([]) }),
    z.strictObject({ mode: z.literal('selected'), selectors: z.tuple([ z.string() ]).rest(z.string()) })
]);
type DebugCandidate = Pick<TestPlanCase, 'annotations' | 'id' | 'workId'>;
export function resolveDebugSelection(debug: RunDebugRequest, cases: readonly DebugCandidate[]): ExecuteDebugSelection {
    if (debug.mode !== 'selected') {
        return { mode: debug.mode };
    }
    const filters = debug.selectors.map(parseRunFilterExpression);
    return {
        mode: 'selected',
        work: cases
            .filter(function selected(testCase) {
                return filters.some(function matches(filter) {
                    return matchesRunFilter(filter, testCase);
                });
            })
            .map(function identity(testCase) {
                return testCase.workId;
            })
    };
}
export class DebugArgumentError extends TypeError {
    public constructor(message: string, options: Readonly<ErrorOptions> | undefined) {
        super(message, options);
        this.name = 'DebugArgumentError';
    }
}
export function debugRequestArguments(debug: RunDebugRequest): readonly string[] {
    return debug.mode === 'all' ? [ '--debug' ] : debug.selectors.flatMap(function selector(value) {
        return [ '--debug-scope', value ];
    });
}
function selectedDebugRequest(selectors: NonEmptyReadonlyArray<string>): RunDebugRequest {
    try {
        selectors.forEach(function (selector) {
            parseRunFilterExpression(selector);
        });
    } catch (error: unknown) {
        throw new DebugArgumentError(error instanceof Error ? error.message : String(error), { cause: error });
    }
    return { mode: 'selected', selectors };
}
export function parseDebugRequest(all: boolean, selectors: readonly string[]): RunDebugRequest {
    const [ first, ...rest ] = selectors;
    if (first === undefined) {
        return { mode: all ? 'all' : 'off', selectors: [] };
    }
    if (all) {
        throw new DebugArgumentError('--debug and --debug-scope are mutually exclusive.', undefined);
    }
    return selectedDebugRequest([ first, ...rest ]);
}
