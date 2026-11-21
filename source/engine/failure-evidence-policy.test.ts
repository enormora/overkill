import { table, suite, test, type TestScope } from '@overkill-dev/test';

import { defaultFailureArtifactPolicy, type RunnerError } from '../packages/engine/engine.entry-point.ts';

import {
    boundaryArtifacts,
    caseBoundaryArtifacts,
    currentProcessUsageSamplingInterval,
    recordBoundaryArtifact,
    withFailureArtifactContext
} from './execution-observation.ts';
import { createDefaultWorkId } from './identity.ts';
import { crashError as executionCrashError, type CrashCause } from './execution-supervision-state.ts';
import { throwWithCleanupErrors } from './execution-result.ts';
import {
    createBoundaryFailureArtifact,
    type ActiveBoundaryWork,
    type BoundaryFailureArtifact
} from './run-artifact.ts';

type EvidenceObservation = {
    readonly before: readonly BoundaryFailureArtifact[];
    readonly all: readonly BoundaryFailureArtifact[];
    readonly matching: readonly BoundaryFailureArtifact[];
    readonly foreign: readonly BoundaryFailureArtifact[];
    readonly retried: readonly BoundaryFailureArtifact[];
};
type TimeoutOwnership = Pick<RunnerError, 'attributedTo' | 'attributedToAttempt' | 'attributedToWork'> & {
    readonly activeWork: readonly ActiveBoundaryWork[];
};

const work = createDefaultWorkId({ file: 'example.test.ts', suite: [], title: 'owned', params: null });
const peer = createDefaultWorkId({ ...work.case, title: 'peer' });
const attempt = { index: 0 };
const timeoutOwners: readonly TimeoutOwnership[] = [
    { activeWork: [], attributedTo: null, attributedToAttempt: null, attributedToWork: null },
    {
        activeWork: [ { work, attempt } ],
        attributedTo: work.case,
        attributedToAttempt: attempt,
        attributedToWork: work
    },
    {
        activeWork: [ { work, attempt }, { work: peer, attempt: { index: 1 } } ],
        attributedTo: null,
        attributedToAttempt: null,
        attributedToWork: null
    }
];

function crashEvidence(activeWork: readonly ActiveBoundaryWork[]): BoundaryFailureArtifact {
    return createBoundaryFailureArtifact(
        {
            kind: 'worker-crash',
            reason: 'worker exited',
            exitCode: null,
            signal: null,
            coreDumpPath: null,
            nativeAddons: null
        },
        {
            source: 'native',
            workerId: null,
            nodeVersion: null,
            timestamp: '1970-01-01T00:00:00.000Z'
        },
        activeWork,
        0
    );
}

function observeAttemptEvidence(
    owned: BoundaryFailureArtifact,
    shared: BoundaryFailureArtifact
): EvidenceObservation {
    recordBoundaryArtifact(owned);
    const before = boundaryArtifacts();
    recordBoundaryArtifact(shared);
    return {
        before,
        all: boundaryArtifacts(),
        matching: caseBoundaryArtifacts(work, attempt),
        foreign: caseBoundaryArtifacts(peer, attempt),
        retried: caseBoundaryArtifacts(work, { index: 1 })
    };
}

async function rejectedExecution(error: Error, cleanupErrors: readonly unknown[]): Promise<unknown> {
    try {
        await throwWithCleanupErrors(error, async function cleanupExecution() {
            return cleanupErrors;
        });
    } catch (error_: unknown) {
        return error_;
    }
    throw new Error('Expected execution to reject.');
}

export const testNode = suite('failure artifact contexts', [
    table({
        title: 'attributes hard timeouts to active attempts',
        cases: timeoutOwners,
        caseTitle({ activeWork }) {
            return String(activeWork.length);
        },
        test(scope) {
            const { activeWork, ...attribution } = scope.parameters;

            const cause: CrashCause = {
                activeAttempts: activeWork.map(function (active) {
                    return active.attempt;
                }),
                activeCases: activeWork.map(function (active) {
                    return active.work.case;
                }),
                activeWork: activeWork.map(function (active) {
                    return active.work;
                }),
                reason: 'hard-timeout',
                termination: 'hard-timeout'
            };
            scope.assert.partialDeepEqual(executionCrashError(cause), {
                ...attribution,
                cause,
                subtype: 'crash'
            });
            return scope.assert.collect();
        }
    }),
    test('execution and cleanup failures retain their original causes in order', async function (scope: TestScope) {
        const error = new Error('execution failed');
        const cleanup = new Error('capture cleanup failed');
        const failure = await rejectedExecution(error, [ cleanup, null ]);
        scope.require.instanceOf(failure, AggregateError);
        scope.assert.deepEqual(failure.errors, [ error, cleanup, null ]);
        scope.assert.equal(failure.cause, error);
        scope.assert.equal(await rejectedExecution(error, []), error);
        return scope.assert.collect();
    }),
    test(
        'attempt evidence excludes foreign work and retries without mutating earlier snapshots',
        function (scope) {
            const owned = crashEvidence([ { work, attempt } ]);
            const shared = crashEvidence([ { work, attempt }, { work: peer, attempt } ]);
            const observed = withFailureArtifactContext(defaultFailureArtifactPolicy, function captureEvidence() {
                return observeAttemptEvidence(owned, shared);
            }, null);
            scope.assert.deepEqual(observed, {
                before: [ owned ],
                all: [ owned, shared ],
                matching: [ owned ],
                foreign: [],
                retried: []
            });
            return scope.assert.collect();
        }
    ),
    test('nested executions restore outer boundary evidence and sampling intervals', function (scope) {
        const previousInterval = currentProcessUsageSamplingInterval();
        const owned = crashEvidence([ { work, attempt } ]);
        const other = crashEvidence([ { work: peer, attempt } ]);
        const observed = withFailureArtifactContext(defaultFailureArtifactPolicy, function outerExecution() {
            recordBoundaryArtifact(owned);
            const inner = withFailureArtifactContext(defaultFailureArtifactPolicy, function innerExecution() {
                recordBoundaryArtifact(other);
                return boundaryArtifacts();
            }, 25);
            return { inner, outer: boundaryArtifacts(), interval: currentProcessUsageSamplingInterval() };
        }, 10);
        scope.assert.deepEqual(observed, { inner: [ other ], outer: [ owned ], interval: 10 });
        scope.assert.equal(currentProcessUsageSamplingInterval(), previousInterval);
        return scope.assert.collect();
    })
]);
