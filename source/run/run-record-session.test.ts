import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { doubleUsage, rule, suite, test, testDouble } from '@overkill-dev/test';

import { withExecutionObservation } from '../engine/execution-observation.ts';
import { fakeWorkerPoolRuntimeDependencies } from '../test-support/worker-pool-runtime-fixtures.ts';
import {
    type RecordSessionSnapshot,
    recordFixture,
    drawEntropy,
    recordFixtureWithPersistenceProbes,
    recordUnresolvedSeed,
    recordId,
    profile,
    facts
} from '../test-support/run-record-session-fixture.ts';
import { trackRunnerErrorDelivery } from '../engine/reporter-error-delivery-tracking.ts';

import type { RunResult } from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createRuntimeCapabilityPolicy } from './capability-policy.ts';

const recordingEnvironment = {};

const assertStartedRecord = defineCompositeAssertion({
    name: 'started record',
    assert(check, record: RecordSessionSnapshot | undefined, recordPath: string) {
        if (record === undefined) {
            return check.defined(record);
        }
        return check.group([
            check.deepEqual({
                facts: record.facts,
                runtime: record.runtime,
                seed: record.request.seed,
                startedAt: record.startedAt,
                version: record.versions.engine
            }, {
                facts: null,
                runtime: null,
                seed: { value: '42' },
                startedAt: '1970-01-01T00:00:00.000Z',
                version: null
            }),
            check.equal(recordPath, `/project/state/runs/${recordId}.json`)
        ]);
    }
});

const assertCompletedRecord = defineCompositeAssertion({
    name: 'completed record',
    assert(check, record: RecordSessionSnapshot | undefined, result: RunResult) {
        if (record === undefined) {
            return check.defined(record);
        }
        return check.group([
            check.equal(record.status, 'completed'),
            check.deepEqual<unknown, unknown>(record.facts, facts),
            check.deepEqual<unknown, unknown>(record.execution, profile.execution),
            check.deepEqual<unknown, unknown>(record.result, result)
        ]);
    }
});

const assertInterruptedRecord = defineCompositeAssertion({
    name: 'interrupted record',
    assert(check, record: RecordSessionSnapshot | undefined) {
        if (record === undefined) {
            return check.defined(record);
        }
        if (record.result === null) {
            return check.defined(record.result);
        }
        return check.group([
            check.equal(record.status, 'interrupted'),
            check.deepEqual<unknown, unknown>(record.facts, facts),
            check.equal(record.result.summary.passed, 3),
            check.equal(record.result.runnerErrors.at(-1)?.message, 'Run interrupted before completion.'),
            check.deepEqual<unknown, unknown>(record.result.runnerErrors[0]?.cause, { kind: 'bigint', value: '42' })
        ]);
    }
});

export const testNode = suite('Run record session', [
    test(
        'record persistence excludes runner entropy while retaining user randomness checks',
        async function (scope) {
            return await withExecutionObservation(async function recordingPolicyBoundary() {
                const probe = testDouble<() => Promise<void>>({
                    fallback: rule.calls(async function drawInfrastructureEntropy() {
                        await drawEntropy(8);
                    })
                });
                const fixture = recordFixtureWithPersistenceProbes([], { storage: probe, history: probe });
                const policy = createRuntimeCapabilityPolicy({
                    dependencies: {
                        ...fakeWorkerPoolRuntimeDependencies().runtimeCapabilityPolicy,
                        readEnvironment() {
                            return recordingEnvironment;
                        }
                    },
                    observedStderr: false,
                    observedStdout: false
                });
                await policy.runLoad(async function recordCollectedFacts() {
                    await fixture.session.start(null);
                    await fixture.session.recordFacts(facts, null);
                    await fixture.session.complete(runResultFactory.build());
                });
                scope.assert.deepEqual(policy.takePendingRunErrors(), []);
                scope.assert.equal(fixture.writes.length, 3);
                scope.assert(doubleUsage.callCount, probe, 6);
                await policy.runLoad(async function drawUserEntropy() {
                    await drawEntropy(8);
                });
                scope.assert.deepEqual(
                    policy.takeRunErrors().map(function policyError(error) {
                        return error.subtype;
                    }),
                    [ 'runtime-policy' ]
                );
                return scope.assert.collect();
            });
        }
    ),
    test('recording rejects unresolved seeds', function (scope) {
        scope.assert.throws(recordUnresolvedSeed, { message: 'Run recording requires a resolved seed.' });
        return scope.assert.collect();
    }),
    test(
        'records request and metadata before resolution, then checkpoints and completes',
        async function (scope) {
            const { session, writes } = recordFixture([]);
            const coverage = {
                directory: `state/runs/${recordId}/coverage`,
                policy: profile.coverage,
                rawDataDirectory: `state/runs/${recordId}/coverage/raw`
            };
            await session.start(coverage);
            scope.assert(assertStartedRecord, writes[0], session.path);
            await session.recordFacts(facts, null);
            const result = runResultFactory.build();
            await session.checkpointResult(result);
            scope.assert.deepEqual(await session.complete(result), {
                context: {
                    id: recordId,
                    startedAt: '1970-01-01T00:00:00.000Z',
                    facts
                },
                ...result,
                maintenanceDiagnostics: []
            });
            scope.assert(assertCompletedRecord, writes[3], result);
            return scope.assert.collect();
        }
    ),
    test('start and facts persistence failures reject before execution', async function (scope) {
        const startFailure = recordFixture([ 1 ]);
        await scope.assert.rejects(async function startRecord() {
            await startFailure.session.start(null);
        }, { message: `Failed to persist run record during start: ${startFailure.session.path}.` });
        const factsFailure = recordFixture([ 2 ]);
        await factsFailure.session.start(null);
        await scope.assert.rejects(async function recordFacts() {
            await factsFailure.session.recordFacts(facts, null);
        }, { message: `Failed to persist run record during facts: ${factsFailure.session.path}.` });
        scope.assert.equal(factsFailure.writes[0]?.facts, null);
        return scope.assert.collect();
    }),
    test(
        'checkpoint failure fails the result and preserves one bounded diagnostic write',
        async function (scope) {
            const { session, writes } = recordFixture([ 2 ]);
            await session.start(null);
            const result = await session.checkpointResult(runResultFactory.build());
            scope.assert.equal(result.status, 'failed');
            scope.assert.equal(result.runnerErrors[0]?.subtype, 'runtime-state');
            scope.assert.deepEqual<unknown, unknown>(result.runnerErrors[0]?.diagnostics, [
                { label: 'Run record phase', value: 'checkpoint' },
                { label: 'Run record path', value: session.path }
            ]);
            scope.assert.equal(writes[1]?.result?.status, 'failed');
            scope.assert.equal(writes[1]?.status, 'started');
            return scope.assert.collect();
        }
    ),
    test(
        'terminal write failures remain visible to CLI fallback when preservation also fails',
        async function (scope) {
            const { session, writes } = recordFixture([ 2, 3 ]);
            await session.start(null);
            const delivery = await trackRunnerErrorDelivery(async function finishRecord() {
                return await session.complete(runResultFactory.build());
            });
            scope.assert.equal(delivery.result.status, 'failed');
            scope.assert.deepEqual(delivery.undeliveredRunnerErrors, delivery.result.runnerErrors);
            scope.assert.equal(writes.length, 1);
            scope.assert.equal(writes[0]?.status, 'started');
            return scope.assert.collect();
        }
    ),
    test('interruption preserves known facts and checkpoint outcomes', async function (scope) {
        const { session, writes } = recordFixture([]);
        await session.start(null);
        await session.recordFacts(facts, null);
        const result = runResultFactory.build({
            summary: { passed: 3 },
            runnerErrors: [ { cause: 42n, message: 'Known failure' } ]
        });
        await session.checkpointResult(result);
        await session.interrupt(new Error('Reporter failed'));
        scope.assert(assertInterruptedRecord, writes[3]);
        return scope.assert.collect();
    }),
    test('early interruptions retain absent facts', async function (scope) {
        const early = recordFixture([]);
        await early.session.start(null);
        await early.session.interrupt(42n);
        scope.assert.equal(early.writes[1]?.facts, null);
        scope.assert.equal(early.writes[1]?.status, 'interrupted');
        return scope.assert.collect();
    })
]);
