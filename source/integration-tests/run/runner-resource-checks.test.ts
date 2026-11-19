import { test, suite as authoredSuite } from '@overkill-dev/test';

import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import type { IntegrationExecution } from '../../config/types.ts';
import {
    defaultIntegrationProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';

const path = 'source/integration-tests/run/fixtures/resource-check-outcome.test.ts';
const worker: IntegrationExecution = {
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
    { processModel: 'supervised-process', scheduling: 'serial', maxConcurrency: 1 },
    worker,
    { ...worker, hostProcess: { kind: 'child', nodeArguments: [] } },
    { ...worker, workerLifecycle: 'fresh-worker-per-unit' }
];
export const testNode = authoredSuite(
    'runner resource check outcomes',
    executions.map(function executionMode(execution, index) {
        return test(
            `retains projected owner checks and live evidence under execution ${index}`,
            async function (scope) {
                const result = await orchestrator.run({
                    config: defaultRunConfig({
                        profiles: {
                            integration: {
                                ...defaultIntegrationProfile({ execution, files: { include: [ path ], exclude: [] } }),
                                retries: { maxAttempts: 3, artifacts: 'all' }
                            }
                        },
                        reporters: [],
                        runtimeStateDir: 'target/resource-check-integration-state'
                    }),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: defaultRunRequest({
                        profile: 'integration',
                        paths: [ path ],
                        order: 'lexical',
                        workers: execution.processModel === 'worker-pool'
                            ? 1
                            : null
                    })
                });
                scope.assert.equal(result.status, 'failed');
                scope.assert.equal(result.summary.failed, 2, { message: JSON.stringify(result.runnerErrors) });
                scope.assert.deepEqual(
                    result.perTest.map(function attempts(testResult) {
                        return testResult.attempts.length;
                    }),
                    [ 1, 1 ]
                );
                scope.assert.deepEqual(
                    result.perTest.map(function failures(testResult) {
                        return testResult.outcome?.kind === 'fail'
                            ? testResult
                                .outcome
                                .failures
                                .map(function failureIdentity(failure) {
                                    return failure.kind === 'resource-check' ? failure.resource : failure.kind;
                                })
                                .toSorted(function compareIdentities(first, second) {
                                    return first.localeCompare(second);
                                })
                            : [];
                    }),
                    [ [ 'per-case', 'per-run' ], [ 'per-run' ] ]
                );
                scope.assert.true(result.resourceChecks.some(function ownerFinding(snapshot) {
                    return snapshot.owner.scope === 'per-run' && snapshot.interval.kind === 'attempt' &&
                        snapshot.failures[0]?.target === 'owner-only';
                }));
                scope.assert.true(result.resourceChecks.every(function finalized(snapshot) {
                    return snapshot.status.kind === 'complete';
                }));
                scope.assert.true(result.artifacts.some(function evidence(artifact) {
                    return artifact.id.subtype === 'attachment';
                }));
                return scope.assert.collect();
            }
        );
    })
);
