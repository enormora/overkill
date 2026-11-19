import { type TestScope, test, suite as authoredSuite } from '@overkill-dev/test';

import { diagnosticRun } from '../test-support/diagnostic-run.ts';
import { debuggedWork, runHasAttachmentScopes } from './run-diagnostics.ts';
import type { RunDebugRequest } from './run-types.ts';

const debugModes: readonly RunDebugRequest[] = [ { mode: 'off', selectors: [] }, { mode: 'all', selectors: [] }, {
    mode: 'selected',
    selectors: [ 'title~case | title=first' ]
}, { mode: 'selected', selectors: [ 'title=missing' ] } ];
export const testNode = authoredSuite('run diagnostic selection', [
    ...[ false, true ].flatMap(function (local) {
        return debugModes.map(function (debug) {
            const selected = debug.mode === 'all' ||
                debug.mode === 'selected' && debug.selectors[0] !== 'title=missing';
            return test(
                `selects debug work from local ${local} plan with ${JSON.stringify(debug)}`,
                function (scope: TestScope) {
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
            );
        });
    }),
    ...([ 'plain', 'process', 'module' ] as const).map(function (shape) {
        return test(
            `detects ${shape} attachment requirements without executing measurements`,
            function (scope: TestScope) {
                const run = diagnosticRun(shape, false, { mode: 'off', selectors: [] });
                scope.assert.equal(runHasAttachmentScopes(run), shape !== 'plain');
                return scope.assert.collect();
            }
        );
    })
]);
