import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createDefaultWorkId } from '../engine/identity.ts';
import { reporterEventSchema } from './reporter-event-schema.ts';
import { executionCommandFields } from './run-command-schema.ts';
import { childProcessEnvelope, envelopeMessage } from './child-process-protocol.ts';
import { supervisedChildMessageSchema } from './supervised-protocol-schema.ts';
import { workerPoolHostCommandSchema, workerPoolHostMessageSchema } from './worker-pool-host-protocol-schema.ts';

import type { SupervisedChildMessage } from './supervised-protocol.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
function decode(
    message: unknown
): SupervisedChildMessage | null {
    return envelopeMessage(childProcessEnvelope('run', message), 'run', supervisedChildMessageSchema);
}
export const testNode = createSuite({
    title: 'child process payload schemas',
    ...metadata,
    children: [
        createTestCase({
            title: 'known envelopes reject unrecognized fields before payload validation',
            ...metadata,
            body(scope) {
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
            }
        }),

        createTestCase({
            title: 'legacy collected cases retain suite identity and receive a default work identity',
            ...metadata,
            body(scope: TestScope) {
                const annotations = { ownership: [], tags: [] };
                const controls = { capture: null, duplicateExecution: null, timeoutMilliseconds: null };
                const file = {
                    file: 'legacy.test.ts',
                    cases: [ {
                        annotations,
                        controls,
                        definitionLocations: metadata.definitionLocations,
                        params: null,
                        resourceAttachments: { directResources: [], resourceGraph: [], runtimeGraphs: [] },
                        suitePath: [ { title: 'suite', definitionLocations: metadata.definitionLocations } ],
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
        }),

        createTestCase({
            title: 'command roots preserve explicit annotation and control values',
            ...metadata,
            body(scope) {
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
            }
        }),
        createTestCase({
            title: 'legacy reporter events receive a complete default work identity',
            ...metadata,
            body(scope) {
                const caseId = { file: null, params: null, suite: [], title: 'legacy' };
                const event = reporterEventSchema.parse({
                    attempt: 0,
                    case: caseId,
                    definitionLocations: metadata.definitionLocations,
                    kind: 'test-start',
                    suitePath: []
                });
                scope.assert.deepEqual(event, {
                    attempt: 0,
                    case: caseId,
                    definitionLocations: metadata.definitionLocations,
                    kind: 'test-start',
                    suitePath: [],
                    workId: createDefaultWorkId(caseId)
                });
                return scope.assert.collect();
            }
        }),

        createTestCase({
            title: 'rejects a malformed nested resource sample before narrowing',
            ...metadata,
            body(scope) {
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
            }
        }),
        createTestCase({
            title: 'validates serialized assertion results and rejects malformed nested case identities',
            ...metadata,
            body(scope) {
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
            }
        }),
        createTestCase({
            title: 'host task payloads cannot claim an unchecked work identity',
            ...metadata,
            body(scope) {
                const parsed = workerPoolHostCommandSchema.safeParse({
                    kind: 'run-task',
                    taskId: 'task',
                    task: { kind: 'run', assignedWork: [ { file: 'case.ts', index: 0 } ] }
                });
                scope.assert.false(parsed.success);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'host diagnostics are validated while task results remain explicitly opaque',
            ...metadata,
            body(scope) {
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
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
