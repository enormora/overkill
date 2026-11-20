import { suite, test } from '@overkill-dev/test';

import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createDefaultWorkId } from '../engine/identity.ts';
import { reporterEventSchema } from './reporter-event-schema.ts';
import { executionCommandFields } from './run-command-schema.ts';
import { childProcessEnvelope, envelopeMessage } from './child-process-protocol.ts';
import { supervisedChildMessageSchema } from './supervised-child-message-schema.ts';
import { workerPoolHostCommandSchema, workerPoolHostMessageSchema } from './worker-pool-host-protocol-schema.ts';

import type { SupervisedChildMessage } from './supervised-protocol.ts';

const definitionLocations = [ { kind: 'unknown' } ] as const;
function decode(
    message: unknown
): SupervisedChildMessage | null {
    return envelopeMessage(childProcessEnvelope('run', message), 'run', supervisedChildMessageSchema);
}
export const testNode = suite('child process payload schemas', [
    test('known envelopes reject unrecognized fields before payload validation', function (scope) {
        scope.assert.throws(function invalidEnvelope() {
            envelopeMessage(
                {
                    ...childProcessEnvelope('run', { kind: 'result', result: runResultFactory.build() }),
                    unexpected: true
                },
                'run',
                supervisedChildMessageSchema
            );
        }, { message: 'Invalid child-process IPC payload.' });
        return scope.assert.collect();
    }),

    test(
        'legacy collected cases retain suite identity and receive a default work identity',
        function (scope: TestScope) {
            const annotations = { ownership: [], tags: [] };
            const controls = { capture: null, duplicateExecution: null, timeoutMilliseconds: null };
            const file = {
                file: 'legacy.test.ts',
                cases: [ {
                    benchmark: null,
                    workloadParameters: null,
                    annotations,
                    controls,
                    definitionLocations,
                    params: null,
                    resourceAttachments: { directResources: [], resourceGraph: [], runtimeGraphs: [] },
                    suitePath: [ { title: 'suite', definitionLocations } ],
                    testFamily: null,
                    title: 'case'
                } ]
            };
            const message = decode({
                kind: 'collected',
                runnerErrors: [],
                collectedPlan: {
                    defined: 1,
                    discoveredFiles: [ file ],
                    files: [ file ],
                    orphans: [],
                    root: { title: 'root', annotations, controls }
                }
            });
            scope.assert.equal(message?.kind, 'collected');
            if (message?.kind === 'collected') {
                const work = message.collectedPlan.files[0]?.cases[0]?.workId;
                scope.require.defined(work);
                scope.assert.deepEqual(
                    work,
                    createDefaultWorkId({ file: file.file, params: null, suite: [ 'suite' ], title: 'case' })
                );
            }
            return scope.assert.collect();
        }
    ),

    test('command roots preserve explicit annotation and control values', function (scope) {
        const root = {
            title: 'root',
            annotations: { ownership: [ 'team' ], tags: [ 'tag' ] },
            controls: { capture: 'buffered', duplicateExecution: 'idempotent', timeoutMilliseconds: 10 }
        };
        scope.assert.deepEqual(executionCommandFields.root.parse(root), root);
        scope.assert.deepEqual(
            executionCommandFields.root.parse({ title: 'root', annotations: {}, controls: {} }),
            { title: 'root', annotations: {}, controls: {} }
        );
        scope.assert.false(
            executionCommandFields
                .root
                .safeParse({ ...root, controls: { ...root.controls, capture: 'invalid' } })
                .success
        );
        return scope.assert.collect();
    }),
    test('retains executable variants and rejects incomplete live identity', function (scope) {
        const caseId = { file: null, params: null, suite: [], title: 'variant' };
        const workId = {
            case: caseId,
            runtimes: [],
            workload: { name: 'large', params: {} },
            familyVariant: { family: 'analysis', key: 'compiler-a' }
        };
        const event = { attempt: 0, case: caseId, workId, definitionLocations, kind: 'test-start', suitePath: [] };
        scope.assert.deepEqual(reporterEventSchema.parse(event), { ...event, case: { ...caseId, suite: [] } });
        scope.assert.false(reporterEventSchema.safeParse({ ...event, attempt: -1 }).success);
        scope.assert.false(reporterEventSchema.safeParse({ ...event, attempt: 0.5 }).success);
        const { familyVariant, ...incomplete } = workId;
        scope.assert.false(reporterEventSchema.safeParse({ ...event, workId: incomplete }).success);
        scope.assert.deepEqual(familyVariant, { family: 'analysis', key: 'compiler-a' });
        return scope.assert.collect();
    }),
    test('rejects reporter events without executable identity', function (scope) {
        const caseId = { file: null, params: null, suite: [], title: 'missing identity' };
        scope.assert.false(
            reporterEventSchema
                .safeParse({
                    attempt: 0,
                    case: caseId,
                    definitionLocations,
                    kind: 'test-start',
                    suitePath: []
                })
                .success
        );
        return scope.assert.collect();
    }),

    test('rejects a malformed nested process usage sample before narrowing', function (scope) {
        scope.assert.throws(function () {
            return decode({
                kind: 'sample',
                sample: {
                    activeResourceCount: 0,
                    activeResourceTypes: [],
                    capturedAtMicroseconds: 0,
                    javaScriptEngineHeapBytes: 0,
                    residentSetBytes: 'invalid'
                }
            });
        }, { message: 'Invalid child-process IPC payload.' });
        return scope.assert.collect();
    }),
    test('validates serialized assertion results and rejects malformed nested case identities', function (scope) {
        const result = runResultFactory.build({
            perTest: [ {
                outcome: { kind: 'fail', checks: [ { actual: { child: [ 1 ] }, expected: { child: [ 2 ] } } ] },
                verdict: 'fail'
            } ]
        });
        const serialized = JSON.stringify({ kind: 'result', result });
        const received: unknown = JSON.parse(serialized);
        scope.assert.equal(decode(received)?.kind, 'result');
        scope.assert.throws(function () {
            return decode({
                kind: 'result',
                result: {
                    ...result,
                    perTest: [ {
                        ...result.perTest[0],
                        id: { file: null, params: null, suite: 'invalid', title: 'case' }
                    } ]
                }
            });
        }, { message: 'Invalid child-process IPC payload.' });
        return scope.assert.collect();
    }),
    test('host task payloads cannot claim an unchecked work identity', function (scope) {
        const parsed = workerPoolHostCommandSchema.safeParse({
            kind: 'run-task',
            taskId: 'task',
            task: { workloadInputs: [], kind: 'run', assignedWork: [ { file: 'case.ts', index: 0 } ] }
        });
        scope.assert.false(parsed.success);
        return scope.assert.collect();
    }),
    test('host diagnostics are validated while task results remain explicitly opaque', function (scope) {
        scope.assert.false(
            workerPoolHostMessageSchema
                .safeParse({
                    kind: 'task-message',
                    taskId: 'task',
                    message: {
                        kind: 'event',
                        event: {
                            kind: 'test-start',
                            case: createDefaultWorkId({ file: null, params: null, suite: [], title: 'case' })
                                .case
                        }
                    }
                })
                .success
        );
        const result = { deliberatelyOpaque: [ 'value' ] };
        scope.assert.deepEqual(
            workerPoolHostMessageSchema.parse({ kind: 'task-result', taskId: 'task', result }),
            { kind: 'task-result', taskId: 'task', result }
        );
        return scope
            .assert
            .collect();
    })
]);
