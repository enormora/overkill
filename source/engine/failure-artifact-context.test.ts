import { runIfMain } from '#test-runner';
import { executeMutationScript as executeNodeScript } from '../integration-tests/run/stryker-script.test.ts';
import type * as SerializationModule from '../compare/serialization-context.ts';
import {
    createSuite,
    createTestCase,
    defaultFailureArtifactPolicy,
    serializeValue,
    type RunnerError,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import type * as ObservationModule from './execution-observation.ts';
import {
    boundaryArtifacts,
    caseBoundaryArtifacts,
    currentFailureArtifactPolicy,
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

type ExecutionObservation = Readonly<typeof ObservationModule>;
type SerializationContext = Readonly<typeof SerializationModule>;
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

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const work = createDefaultWorkId({ file: 'example.test.ts', suite: [], title: 'owned', params: null });
const peer = createDefaultWorkId({ ...work.case, title: 'peer' });
const attempt = { index: 0 };
const text = 'abcdefgh';
const observationModuleUrl = new URL('./execution-observation.ts', import.meta.url);
const copiedObservationUrl = new URL('?artifact-context-copy', observationModuleUrl);
const copiedSerializationUrl = new URL('../compare/serialization-context.ts?artifact-context-copy', import.meta.url);
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

export const testNode = createSuite({
    ...metadata,
    title: 'failure artifact contexts',
    children: [
        ...timeoutOwners.map(function timeoutAttribution({ activeWork, ...attribution }) {
            return createTestCase({
                ...metadata,
                title: `hard timeout attribution follows ${activeWork.length} active attempts`,
                body(scope: TestScope) {
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
            });
        }),
        createTestCase({
            ...metadata,
            title: 'execution and cleanup failures retain their original causes in order',
            async body(scope: TestScope) {
                const error = new Error('execution failed');
                const cleanup = new Error('capture cleanup failed');
                const failure = await rejectedExecution(error, [ cleanup, null ]);
                scope.require.instanceOf(failure, AggregateError);
                scope.assert.deepEqual(failure.errors, [ error, cleanup, null ]);
                scope.assert.equal(failure.cause, error);
                scope.assert.equal(await rejectedExecution(error, []), error);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'module copies share execution and serialization budgets',
            async body(scope: TestScope) {
                const observation = await import(copiedObservationUrl.href) as ExecutionObservation;
                const serialization = await import(copiedSerializationUrl.href) as SerializationContext;
                const policy = {
                    ...defaultFailureArtifactPolicy,
                    serialization: { ...defaultFailureArtifactPolicy.serialization, stringBytes: 4 }
                };
                const observed = observation.withFailureArtifactContext(policy, function captureSharedPolicy() {
                    return { policy: currentFailureArtifactPolicy(), value: serializeValue(text) };
                }, null);
                scope.assert.deepEqual(observed.policy, policy);
                scope.assert.partialDeepEqual(observed.value, { kind: 'string', value: 'abcd' });
                scope.assert.partialDeepEqual(
                    serialization.withSerializationBudget(
                        { ...policy.serialization, stringBytes: 2 },
                        function captureSharedSerialization() {
                            return serializeValue(text);
                        }
                    ),
                    { kind: 'string', value: 'ab' }
                );
                scope.assert.partialDeepEqual(serializeValue(text), { kind: 'string', value: text });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'attempt evidence excludes foreign work and retries without mutating earlier snapshots',
            body(scope: TestScope) {
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
        }),
        createTestCase({
            ...metadata,
            title: 'nested executions restore outer boundary evidence and sampling intervals',
            body(scope: TestScope) {
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
            }
        }),
        createTestCase({
            ...metadata,
            title: 'out-of-execution capture ignores evidence and uses default budgets',
            async body(scope: TestScope) {
                const artifact = crashEvidence([ { work, attempt } ]);
                const script = `
                    import assert from 'node:assert/strict';
                    const {
                        recordBoundaryArtifact,boundaryArtifacts,
                        currentProcessUsageSamplingInterval,currentFailureArtifactPolicy
                    } = await import(${JSON.stringify(observationModuleUrl.href)});
                    const {currentSerializationBudget} = await import(${JSON.stringify(copiedSerializationUrl.href)});
                    recordBoundaryArtifact(JSON.parse(process.argv[1]));
                    assert.deepEqual(boundaryArtifacts(),[]);
                    assert.equal(currentProcessUsageSamplingInterval(),null);
                    assert.equal(currentFailureArtifactPolicy().capturedOutputBytes,1048576);
                    assert.equal(currentSerializationBudget().stringBytes,8192);
                    console.log('unowned capture ignored');
                `;
                const output = await executeNodeScript(script, [ JSON.stringify(artifact) ], process.cwd());
                scope.assert.equal(output, 'unowned capture ignored\n');
                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode);
