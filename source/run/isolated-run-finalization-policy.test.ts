import { table, type TestNode, suite } from '@overkill-dev/test';

import { passingIsolatedWorkerRun } from '../test-support/isolated-worker-run.ts';
import { attachmentRecording } from '../test-support/attachment-recording.ts';
import { runIsolatedProcessCommand } from './run-isolated-process.ts';
import type { RunResultSession } from './run-support.ts';

function baselineSession(
    record: (event: string) => void,
    reporterDispatcher: RunResultSession['reporterDispatcher']
): RunResultSession {
    return {
        reporterDispatcher,
        prepareResult(result) {
            record('prepare');
            return result;
        },
        async finalize(result) {
            record('finalize');
            return result;
        }
    };
}
export const testNode: TestNode = suite(
    'isolated run finalization ownership',
    [ table({
        title: 'finalizes worker results with recording and baselines',
        cases: [ false, true ].flatMap(function (record) {
            return [ false, true ].map(function (baseline) {
                return ({
                    caseDescription: `finalizes worker results with recording ${record} and baselines ${baseline}`,
                    record,
                    baseline
                });
            });
        }),
        caseTitle: (row) => row.caseDescription,
        async test(scope) {
            const { record, baseline } = scope.parameters;

            const require: typeof scope.require = scope.require;

            const fixture = passingIsolatedWorkerRun(false, false);
            const recording = await attachmentRecording(null);
            const events: string[] = [];
            const session = baselineSession(function (event) {
                events.push(event);
            }, fixture.dependencies.reporterDispatcher);
            const pending = runIsolatedProcessCommand(fixture.command, fixture.dependencies, {
                ...fixture.options,
                record: record ? recording.session : null,
                baseline: baseline ? session : null,
                signal: null
            }, fixture.input);
            require.defined(pending);
            const result = await pending;
            scope.assert.deepEqual({
                status: result.status,
                cases: result.perTest.length,
                events,
                recording: Array.from(recording.calls),
                checkpoints: recording.checkpoints.length
            }, {
                status: 'passed',
                cases: 1,
                events: baseline ? [ 'prepare', 'finalize' ] : [],
                recording: record ? [ 'resolved', 'placement', 'placement' ] : [],
                checkpoints: record ? 1 : 0
            });
            return scope.assert.collect();
        }
    }) ]
);
