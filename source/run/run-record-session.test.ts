import { runIfMain } from '#test-runner';
import {
    type RecordSessionSnapshot,
    recordFixture,
    recordUnresolvedSeed,
    recordId,
    profile,
    facts
} from '../test-support/run-record-session-fixture.ts';
import { trackRunnerErrorDelivery } from '../engine/reporter-error-delivery-tracking.ts';
import type { RunResult } from '../engine/run-result.ts';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';

function assertStartedRecord(scope: TestScope, record: RecordSessionSnapshot | undefined, recordPath: string): void {
    scope.require.defined(record);
    scope.assert.deepEqual({
        facts: record.facts,
        runtime: record.runtime,
        seed: record.request.seed,
        startedAt: record.startedAt,
        version: record.versions.engine
    }, { facts: null, runtime: null, seed: { value: '42' }, startedAt: '1970-01-01T00:00:00.000Z', version: null });
    scope.assert.equal(recordPath, `/project/state/runs/${recordId}.json`);
}

function assertCompletedRecord(scope: TestScope, record: RecordSessionSnapshot | undefined, result: RunResult): void {
    scope.require.defined(record);
    scope.assert.equal(record.status, 'completed');
    scope.assert.deepEqual<unknown, unknown>(record.facts, facts);
    scope.assert.deepEqual<unknown, unknown>(record.execution, profile.execution);
    scope.assert.deepEqual<unknown, unknown>(record.result, result);
}

function assertInterruptedRecord(scope: TestScope, record: RecordSessionSnapshot | undefined): void {
    scope.require.defined(record);
    scope.require.defined(record.result);
    scope.assert.equal(record.status, 'interrupted');
    scope.assert.deepEqual<unknown, unknown>(record.facts, facts);
    scope.assert.equal(record.result.summary.passed, 3);
    scope.assert.equal(record.result.runnerErrors.at(-1)?.message, 'Run interrupted before completion.');
    scope.assert.deepEqual<unknown, unknown>(record.result.runnerErrors[0]?.cause, { kind: 'bigint', value: '42' });
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/run-record-session.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'recording rejects unresolved seeds',
            annotations: {},
            controls: {},
            body(scope) {
                scope.assert.throws(recordUnresolvedSeed, { message: 'Run recording requires a resolved seed.' });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'records request and metadata before resolution, then checkpoints and completes',
            annotations: {},
            controls: {},
            async body(scope) {
                const { session, writes } = recordFixture([]);
                const coverage = {
                    directory: `state/runs/${recordId}/coverage`,
                    policy: profile.coverage,
                    rawDataDirectory: `state/runs/${recordId}/coverage/raw`
                };
                await session.start(coverage);
                assertStartedRecord(scope, writes[0], session.path);
                await session.recordFacts(facts);
                const result = runResultFactory.build();
                await session.checkpointResult(result);
                scope.assert.equal(await session.complete(result), result);
                assertCompletedRecord(scope, writes[3], result);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'start and facts persistence failures reject before execution',
            annotations: {},
            controls: {},
            async body(scope) {
                const startFailure = recordFixture([ 1 ]);
                await scope.assert.rejects(async function startRecord() {
                    await startFailure.session.start(null);
                }, { message: `Failed to persist run record during start: ${startFailure.session.path}.` });
                const factsFailure = recordFixture([ 2 ]);
                await factsFailure.session.start(null);
                await scope.assert.rejects(async function recordFacts() {
                    await factsFailure.session.recordFacts(facts);
                }, { message: `Failed to persist run record during facts: ${factsFailure.session.path}.` });
                scope.assert.equal(factsFailure.writes[0]?.facts, null);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'checkpoint failure fails the result and preserves one bounded diagnostic write',
            annotations: {},
            controls: {},
            async body(scope) {
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
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'terminal write failures remain visible to CLI fallback when preservation also fails',
            annotations: {},
            controls: {},
            async body(scope) {
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
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'interruption preserves known facts and checkpoint outcomes',
            annotations: {},
            controls: {},
            async body(scope) {
                const { session, writes } = recordFixture([]);
                await session.start(null);
                await session.recordFacts(facts);
                const result = runResultFactory.build({
                    summary: { passed: 3 },
                    runnerErrors: [ { cause: 42n, message: 'Known failure' } ]
                });
                await session.checkpointResult(result);
                await session.interrupt(new Error('Reporter failed'));
                assertInterruptedRecord(scope, writes[3]);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'early interruptions retain absent facts',
            annotations: {},
            controls: {},
            async body(scope) {
                const early = recordFixture([]);
                await early.session.start(null);
                await early.session.interrupt(42n);
                scope.assert.equal(early.writes[1]?.facts, null);
                scope.assert.equal(early.writes[1]?.status, 'interrupted');
                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode);
