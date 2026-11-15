import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { createDefaultWorkId } from '../engine/identity.ts';
import { createBoundaryFailureArtifact } from '../engine/run-artifact.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import type { PerTestResult, ReporterEvent, RunnerError, RunArtifact } from './run-engine-primitives.ts';
import type { CollectedRunPlan } from './run-types.ts';
import { reportTerminalCases } from './run-result-reporting.ts';

const id = { file: 'example.test.ts', suite: [ 'service' ], title: 'crashes', params: null };
const work = createDefaultWorkId(id);
const pending: PerTestResult = {
    id,
    workId: work,
    definitionLocations: [ { kind: 'unknown' } ],
    property: null,
    benchmark: null,
    outcome: null,
    verdict: 'crashed',
    durationMicroseconds: 10,
    retried: null,
    attempts: [ {
        attempt: { index: 1 },
        property: null,
        benchmark: null,
        outcome: null,
        verdict: 'crashed',
        durationMicroseconds: 10
    } ]
};
const emptyPlan: CollectedRunPlan = {
    family: null,
    defined: 0,
    discoveredFiles: [],
    files: [],
    orphans: [],
    root: {
        title: 'root',
        annotations: { tags: [], ownership: [] },
        controls: { capture: null, duplicateExecution: null, timeoutMilliseconds: null }
    }
};

const reporterError: RunnerError = {
    attributedTo: null,
    attributedToWork: null,
    attributedToAttempt: null,
    cause: null,
    diagnostics: [],
    message: 'Reporter disconnected.',
    subtype: 'reporter'
};

function onlyTerminalEvent(events: readonly ReporterEvent[]): Extract<ReporterEvent, { readonly kind: 'test-end'; }> {
    const [ event ] = events;
    if (events.length !== 1 || event?.kind !== 'test-end') {
        throw new Error('Expected exactly one terminal case event.');
    }
    return event;
}

function crashArtifact(attempt: number): RunArtifact {
    return createBoundaryFailureArtifact(
        {
            kind: 'worker-crash',
            reason: 'worker exited',
            exitCode: 1,
            signal: null,
            coreDumpPath: null,
            nativeAddons: null
        },
        {
            source: 'boundary-captured',
            nodeVersion: null,
            workerId: null,
            timestamp: '1970-01-01T00:00:00.000Z'
        },
        [ { work, attempt: { index: attempt } } ],
        attempt
    );
}

export const testNode = suite('terminal failure reporting', [
    test('reports pending crashes absent from the final result and collected plan', async function (scope) {
        const events: ReporterEvent[] = [];
        const result = runResultFactory.build();
        const reported = await reportTerminalCases(result, [ pending, pending ], emptyPlan, {
            async reportEvent(event) {
                events.push(event);
                return [];
            }
        });
        scope.assert.partialDeepEqual(onlyTerminalEvent(events), {
            kind: 'test-end',
            completion: 'final',
            case: id,
            workId: work,
            attempt: 1,
            durationMicroseconds: 10,
            verdict: 'crashed',
            suitePath: [ { title: 'service', definitionLocations: [ { kind: 'unknown' } ] } ]
        });
        scope.assert.deepEqual(reported, result);
        return scope.assert.collect();
    }),
    test('reports the final attempt and its artifacts while retaining reporter errors', async function (scope) {
        const events: ReporterEvent[] = [];
        const finalAttempt = { ...pending.attempts[0], attempt: { index: 2 }, durationMicroseconds: 20 };
        const completed: PerTestResult = {
            ...pending,
            durationMicroseconds: 30,
            attempts: [ ...pending.attempts, finalAttempt ]
        };
        const artifact = crashArtifact(2);
        const result = {
            ...runResultFactory.build(),
            perTest: [ completed ],
            artifacts: [ crashArtifact(1), artifact ]
        };
        const reported = await reportTerminalCases(result, [ pending ], emptyPlan, {
            async reportEvent(event) {
                events.push(event);
                return [ reporterError ];
            }
        });
        scope.assert.partialDeepEqual(onlyTerminalEvent(events), {
            attempt: 2,
            durationMicroseconds: 20,
            artifacts: [ artifact ]
        });
        scope.assert.partialDeepEqual(reported, {
            runnerErrors: [ reporterError ],
            perTest: [ completed ],
            status: 'failed'
        });
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
