import { type TestNode, table, suite } from '@overkill-dev/test';

import { diagnosticRun } from '../test-support/diagnostic-run.ts';
import { debuggedWork, runHasAttachmentScopes } from './run-diagnostics.ts';
import type { RunDebugRequest } from './run-types.ts';

const debugModes: readonly RunDebugRequest[] = [ { mode: 'off', selectors: [] }, { mode: 'all', selectors: [] }, {
    mode: 'selected',
    selectors: [ 'title~case | title=first' ]
}, { mode: 'selected', selectors: [ 'title=missing' ] } ];
export const testNode: TestNode = suite('run diagnostic selection', [
    table({
        title: 'selects debug work according to locality and mode',
        cases: [ false, true ].flatMap(function (local) {
            return debugModes.map(function (debug) {
                const selected = debug.mode === 'all' ||
                    debug.mode === 'selected' && debug.selectors[0] !== 'title=missing';
                return ({
                    caseDescription: `${local}, ${JSON.stringify(debug)}`,
                    local,
                    debug,
                    selected
                });
            });
        }),
        caseTitle: (row) => row.caseDescription,
        test(scope) {
            const { local, debug, selected } = scope.parameters;

            const run = diagnosticRun('plain', local, debug);
            scope.assert.deepEqual(
                debuggedWork(run),
                selected
                    ? run
                        .facts
                        .cases
                        .map(function (entry) {
                            return entry.workId;
                        })
                    : []
            );
            return scope.assert.collect();
        }
    }),
    table({
        title: 'detects attachment requirements without executing measurements',
        cases: [ 'plain', 'process', 'module' ] as const,
        caseTitle(shape) {
            return `${shape}`;
        },
        test(scope) {
            const shape = scope.parameters;

            const run = diagnosticRun(shape, false, { mode: 'off', selectors: [] });
            scope.assert.equal(runHasAttachmentScopes(run), shape !== 'plain');
            return scope.assert.collect();
        }
    })
]);
