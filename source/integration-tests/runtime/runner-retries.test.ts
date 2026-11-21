import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder } from '@overkill-dev/test/assert';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, suite } from '@overkill-dev/test';
import { executionTitle } from '../../test-support/execution-profile-title.ts';

import {
    defineReporter,
    type ReporterEvent,
    type DefinedReporter,
    type RunResult
} from '../../packages/engine/engine.entry-point.ts';

import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import type { RunCommand } from '../../run/run-types.ts';
import type { IntegrationExecution, TimeoutPolicy } from '../../config/types.ts';
import type { RetryArtifactPolicy } from '../../config/execution.ts';
import {
    defaultIntegrationProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';

type RetryFixture = { readonly path: string; readonly timeouts: TimeoutPolicy | null; };
const fixture: RetryFixture = {
    path: 'source/integration-tests/runtime/fixtures/retry-policy.test.ts',
    timeouts: null
};
const hardTimeoutFixture: RetryFixture = {
    path: 'source/integration-tests/runtime/fixtures/retry-hard-timeout.test.ts',
    timeouts: { collectionMilliseconds: 5000, softMilliseconds: 2000, hardMilliseconds: 3000 }
};

const workerExecution: IntegrationExecution = {
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
const executions: readonly IntegrationExecution[] = [
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
    execution: IntegrationExecution,
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

const assertRecoveredHistory = defineCompositeAssertion({
    name: 'recovered history',
    assert(check, result: RunResult) {
        const initialChecks = check.group([
            check.annotated(JSON.stringify(result.runnerErrors)).equal(result.status, 'passed'),
            check.equal(result.summary.passed, 1),
            check.equal(result.summary.failed, 0),
            check.equal(result.perTest.length, 1)
        ]);
        const first = result.perTest[0];
        if (first === undefined || first === null) {
            return check.group([ initialChecks, check.defined(first) ]);
        }
        const intermediateChecks = check.defined(first);
        if (first.retried === undefined || first.retried === null) {
            return check.group([ initialChecks, intermediateChecks, check.defined(first.retried) ]);
        }
        return check.group([
            initialChecks,
            intermediateChecks,
            check.defined(first.retried),
            check.deepEqual(first.retried, { attempts: 3, finalVerdict: 'pass' }),
            check.deepEqual(
                first.attempts.map(function attempt(attemptResult) {
                    return [ attemptResult.attempt.index, attemptResult.verdict ];
                }),
                [ [ 0, 'fail' ], [ 1, 'fail' ], [ 2, 'pass' ] ]
            )
        ]);
    }
});

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

const assertRetryEvidence = defineCompositeAssertion({
    name: 'retry evidence',
    assert(check, result: RunResult, events: readonly ReporterEvent[], policy: RetryArtifactPolicy) {
        return check.group([
            check.deepEqual(
                retainedRetryEvidence(result),
                retainedAttemptIndexes[policy].map(function expectedEvidence(index) {
                    return [ index, `retry evidence ${index + 1}` ] as const;
                })
            ),
            check.deepEqual(
                events
                    .filter(function ended(event) {
                        return event.kind === 'test-end';
                    })
                    .map(function completion(event) {
                        return [ event.attempt, event.completion ];
                    }),
                [ [ 0, 'retry' ], [ 1, 'retry' ], [ 2, 'final' ] ]
            )
        ]);
    }
});

const hardTimeoutAttributionChecks = (
    check: CompositeCheckBuilder<'assert'>,
    result: RunResult
): CompositeAssertionReturn<'assert'> => {
    const error = result.runnerErrors.find(function crash(candidate) {
        return candidate.subtype === 'crash';
    });
    if (error === undefined || error === null) {
        return check.defined(error);
    }
    return check.group([ check.equal(error.attributedToAttempt?.index, 1) ]);
};

const assertHardTimeoutEvidence = defineCompositeAssertion({
    name: 'hard timeout evidence',
    assert(check, result: RunResult) {
        const first = result.perTest[0];
        if (first === undefined || first === null) {
            return check.defined(first);
        }
        const initialChecks = check.defined(first);
        if (first.retried === undefined || first.retried === null) {
            return check.group([ initialChecks, check.defined(first.retried) ]);
        }
        return check.group([
            initialChecks,
            check.defined(first.retried),
            check.equal(result.status, 'failed'),
            check.equal(result.summary.crashed, 1),
            check.deepEqual(first.retried, { attempts: 2, finalVerdict: 'crashed' }),
            check.deepEqual(
                first.attempts.map(function attempt(attemptResult) {
                    return [ attemptResult.attempt.index, attemptResult.verdict ];
                }),
                [ [ 0, 'fail' ], [ 1, 'crashed' ] ]
            ),
            check.deepEqual(retainedRetryEvidence(result), [ [ 0, 'retry evidence 1' ], [ 1, 'retry evidence 2' ] ]),
            hardTimeoutAttributionChecks(check.annotated('hard timeout attribution'), result)
        ]);
    }
});

function isWorkerCrash(artifact: RunResult['artifacts'][number]): boolean {
    return artifact.payload.kind === 'worker-crash';
}

const assertHardTimeoutEvent = defineCompositeAssertion({
    name: 'hard timeout event',
    assert(check, result: RunResult, events: readonly ReporterEvent[]) {
        const completedEvent = events
            .filter(function caseFinished(event) {
                return event.kind === 'test-end';
            })
            .find(function finalAttempt(event) {
                return event.completion === 'final';
            });
        if (completedEvent === undefined || completedEvent === null) {
            return check.defined(completedEvent);
        }
        const artifacts = result.artifacts.filter(isWorkerCrash);
        return check.group([
            check.equal(artifacts.length, 1),
            check.equal(completedEvent.verdict, 'crashed'),
            check.deepEqual(completedEvent.artifacts.filter(isWorkerCrash), artifacts),
            check.equal(completedEvent.durationMicroseconds, result.perTest[0]?.attempts.at(-1)?.durationMicroseconds)
        ]);
    }
});

export const testNode = suite('Runner retries', [
    table({
        title: 'retries across execution envelopes',
        cases: executions.flatMap(function retryExecution(execution, index) {
            return artifactPolicies.map(function artifactRetention(policy) {
                return { execution, index, policy };
            });
        }),
        caseTitle({ execution, policy }) {
            return [ executionTitle(execution), policy ].join(', ');
        },
        async test(scope) {
            const events: ReporterEvent[] = [];
            const reporter = eventReporter(function recordEvent(event) {
                events.push(event);
            });
            const command = retryCommand(scope.parameters.execution, reporter, scope.parameters.policy, fixture);
            const resolved = await orchestrator.resolve(command);
            scope.assert.equal(resolved.facts.execution.retries?.maxAttempts, 3);
            scope.assert.true(Object.isFrozen(resolved.facts.execution.retries));
            const result = await orchestrator.run(command);
            scope.assert(assertRecoveredHistory, result);
            scope.assert(assertRetryEvidence, result, events, scope.parameters.policy);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'preserves retry evidence after hard timeouts',
        cases: executions.slice(0, 2),
        caseTitle(execution) {
            return execution.processModel;
        },
        async test(scope) {
            const execution = scope.parameters;

            const events: ReporterEvent[] = [];
            const reporter = eventReporter(function recordEvent(event) {
                events.push(event);
            });
            const result = await orchestrator.run(
                retryCommand(execution, reporter, 'first-failure-and-final', hardTimeoutFixture)
            );
            scope.assert(assertHardTimeoutEvidence, result);
            scope.assert(assertHardTimeoutEvent, result, events);
            return scope.assert.collect();
        }
    })
]);
