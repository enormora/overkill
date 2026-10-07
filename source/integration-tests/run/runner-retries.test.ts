import {
    createSuite,
    createTestCase,
    defineReporter,
    type ReporterEvent,
    type DefinedReporter,
    type RunResult,
    type TestScope
} from '../../packages/engine/engine.entry-point.ts';
import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import type { RunIntegrationExecution, RunCommand, RunTimeoutPolicy } from '../../run/run-types.ts';
import type { RetryArtifactPolicy } from '../../run/run-execution-config.ts';
import {
    defaultIntegrationProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';
import { runIfMain } from '../direct-launcher.test.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';

type RetryFixture = { readonly path: string; readonly timeouts: RunTimeoutPolicy | null; };
const fixture: RetryFixture = { path: 'source/integration-tests/run/fixtures/retry-policy.test.ts', timeouts: null };
const hardTimeoutFixture: RetryFixture = {
    path: 'source/integration-tests/run/fixtures/retry-hard-timeout.test.ts',
    timeouts: { collectionMilliseconds: 5000, softMilliseconds: 500, hardMilliseconds: 1000 }
};
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const workerExecution: RunIntegrationExecution = {
    assignmentPolicy: 'case-count-balanced',
    dispatchPolicy: 'dynamic-lease',
    hedging: { mode: 'off' },
    hostProcess: { kind: 'direct' },
    maxConcurrency: 1,
    maxWorkers: 1,
    processModel: 'worker-pool',
    scheduling: 'serial',
    workDistribution: { mode: 'case' },
    workerLifecycle: 'reuse'
};
const executions: readonly RunIntegrationExecution[] = [
    { maxConcurrency: 1, processModel: 'supervised-process', scheduling: 'serial' },
    workerExecution,
    { ...workerExecution, hostProcess: { kind: 'child', nodeArguments: [] } },
    { ...workerExecution, workerLifecycle: 'fresh-worker-per-unit' },
    { ...workerExecution, dispatchPolicy: 'static-assignment', scheduling: 'concurrent' }
];

const artifactPolicies: readonly RetryArtifactPolicy[] = [ 'first-failure-and-final', 'last-failure-and-final', 'all' ];
const retainedAttemptIndexes: Readonly<Record<RetryArtifactPolicy, readonly number[]>> = {
    'first-failure-and-final': [ 0, 2 ],
    'last-failure-and-final': [ 1, 2 ],
    all: [ 0, 1, 2 ]
};

function eventReporter(record: (event: ReporterEvent) => void): DefinedReporter {
    return defineReporter(function () {
        return {
            dispose: null,
            kind: 'real-time',
            name: 'retry-events',
            sinks: [ { kind: 'memory' } ],
            onFinish: null,
            onEvent: record
        };
    });
}

function retryCommand(
    execution: RunIntegrationExecution,
    reporter: DefinedReporter,
    artifacts: RetryArtifactPolicy,
    selectedFixture: RetryFixture
): RunCommand {
    const profile = {
        ...defaultIntegrationProfile({
            execution,
            files: { include: [ selectedFixture.path ], exclude: [] },
            ...selectedFixture.timeouts === null ? {} : { timeouts: selectedFixture.timeouts }
        }),
        retries: { maxAttempts: 3, artifacts }
    };
    return {
        config: defaultRunConfig({
            profiles: { integration: profile },
            reporters: [ reporter ],
            runtimeStateDir: 'target/retry-integration-state'
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            profile: 'integration',
            paths: [ selectedFixture.path ],
            order: 'lexical',
            workers: execution.processModel === 'worker-pool' ? 1 : null
        })
    };
}

function assertRecoveredHistory(scope: TestScope, result: RunResult): void {
    scope.assert.equal(result.status, 'passed', { message: JSON.stringify(result.runnerErrors) });
    scope.assert.equal(result.summary.passed, 1);
    scope.assert.equal(result.summary.failed, 0);
    scope.assert.equal(result.perTest.length, 1);
    const first = result.perTest[0];
    scope.require.defined(first);
    scope.require.defined(first.retried);
    scope.assert.deepEqual(first.retried, { attempts: 3, finalVerdict: 'pass' });
    scope.assert.deepEqual(
        first.attempts.map(function attempt(attemptResult) {
            return [ attemptResult.attempt.index, attemptResult.verdict ];
        }),
        [ [ 0, 'fail' ], [ 1, 'fail' ], [ 2, 'pass' ] ]
    );
}

type RetryEvidence = readonly [number, string];

function retainedRetryEvidence(result: RunResult): readonly RetryEvidence[] {
    return result
        .artifacts
        .flatMap(function retryEvidence(artifact) {
            if (artifact.id.attempt === null || artifact.payload.kind !== 'runtime-attachment') {
                return [];
            }
            const { content, name } = artifact.payload;
            if (content.kind !== 'text' || name !== 'retry-evidence') {
                return [];
            }
            return [ [ artifact.id.attempt.index, content.text ] as const ];
        })
        .toSorted(function attemptOrder(first, second) {
            return first[0] - second[0];
        });
}

function assertRetryEvidence(
    scope: TestScope,
    result: RunResult,
    events: readonly ReporterEvent[],
    policy: RetryArtifactPolicy
): void {
    scope.assert.deepEqual(
        retainedRetryEvidence(result),
        retainedAttemptIndexes[policy].map(function expectedEvidence(index) {
            return [ index, `retry evidence ${index + 1}` ] as const;
        })
    );
    scope.assert.deepEqual(
        events
            .filter(function ended(event) {
                return event.kind === 'test-end';
            })
            .map(function completion(event) {
                return [ event.attempt, event.completion ];
            }),
        [ [ 0, 'retry' ], [ 1, 'retry' ], [ 2, 'final' ] ]
    );
}

function assertHardTimeoutAttribution(scope: TestScope, result: RunResult): void {
    const error = result.runnerErrors.find(function crash(candidate) {
        return candidate.subtype === 'crash';
    });
    scope.require.defined(error);
    scope.assert.equal(error.attributedToAttempt?.index, 1);
}

function assertHardTimeoutEvidence(scope: TestScope, result: RunResult): void {
    const first = result.perTest[0];
    scope.require.defined(first);
    scope.require.defined(first.retried);
    scope.assert.equal(result.status, 'failed');
    scope.assert.equal(result.summary.crashed, 1);
    scope.assert.deepEqual(first.retried, { attempts: 2, finalVerdict: 'crashed' });
    scope.assert.deepEqual(
        first.attempts.map(function attempt(attemptResult) {
            return [ attemptResult.attempt.index, attemptResult.verdict ];
        }),
        [ [ 0, 'fail' ], [ 1, 'crashed' ] ]
    );
    scope.assert.deepEqual(retainedRetryEvidence(result), [ [ 0, 'retry evidence 1' ], [ 1, 'retry evidence 2' ] ]);
    assertHardTimeoutAttribution(scope, result);
}

export const testNode = createSuite({
    ...metadata,
    title: 'source/integration-tests/run/runner-retries.test.ts',
    children: [
        ...executions.flatMap(function retryExecution(execution, index) {
            return artifactPolicies.map(function artifactRetention(policy) {
                return createTestCase({
                    ...metadata,
                    title: `runner retries across execution envelope ${index + 1} with ${policy}`,
                    async body(scope: TestScope) {
                        const events: ReporterEvent[] = [];
                        const reporter = eventReporter(function recordEvent(event) {
                            events.push(event);
                        });
                        const command = retryCommand(execution, reporter, policy, fixture);
                        const resolved = await orchestrator.resolve(command);
                        scope.assert.equal(resolved.facts.execution.retries?.maxAttempts, 3);
                        scope.assert.true(Object.isFrozen(resolved.facts.execution.retries));
                        const result = await orchestrator.run(command);
                        assertRecoveredHistory(scope, result);
                        assertRetryEvidence(scope, result, events, policy);
                        return scope.assert.collect();
                    }
                });
            });
        }),
        ...executions.slice(0, 2).map(function hardTimeoutExecution(execution) {
            return createTestCase({
                ...metadata,
                title: `hard timeout preserves retry evidence under ${execution.processModel}`,
                async body(scope: TestScope) {
                    const reporter = eventReporter(function ignoreEvent() {
                        return undefined;
                    });
                    const result = await orchestrator.run(
                        retryCommand(execution, reporter, 'first-failure-and-final', hardTimeoutFixture)
                    );
                    assertHardTimeoutEvidence(scope, result);
                    return scope.assert.collect();
                }
            });
        })
    ]
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
