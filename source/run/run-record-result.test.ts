import {
    createSuite,
    createTestCase,
    type RunResult,
    type TestOutcome
} from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { recordedRunResult, serializeRunDiagnostics, parseSerializedRunDiagnostics } from './run-record-result.ts';

function opaqueFailure(): TestOutcome {
    const thrown = new Map<string, unknown>();
    thrown.set('self', thrown);
    thrown.set('seed', 42n);
    const error = { message: 'Failure', name: 'Error', stack: null, thrown };
    return {
        kind: 'fail',
        failures: [
            {
                kind: 'assertion',
                checks: [ {
                    kind: 'composite',
                    actual: { kind: 'null' },
                    expected: { kind: 'null' },
                    diff: null,
                    id: 'composite',
                    path: [],
                    source: 'assert',
                    sourceLocations: [ { kind: 'unknown' } ],
                    summary: 'foreign failure',
                    children: [ {
                        kind: 'foreign',
                        actual: { kind: 'null' },
                        expected: { kind: 'null' },
                        diff: null,
                        id: 'foreign',
                        path: [],
                        source: 'assert',
                        sourceLocations: [ { kind: 'unknown' } ],
                        summary: 'foreign failure',
                        error,
                        label: 'foreign'
                    } ]
                } ]
            },
            { error, kind: 'body-error' },
            { error, kind: 'cleanup-error' },
            {
                actual: 42n,
                code: 'invalid-plan',
                expected: 'valid plan',
                kind: 'test-contract',
                summary: 'Invalid plan'
            },
            { deadlineMilliseconds: 1, elapsedMilliseconds: 2, kind: 'timeout' }
        ]
    };
}

function resultWithOpaqueEvidence(): RunResult {
    const result = runResultFactory.build({ perTest: [ { outcome: { kind: 'pass' } } ] });
    const [ test ] = result.perTest;
    if (test === undefined) {
        throw new Error('Evidence fixture requires one test.');
    }
    const outcome = opaqueFailure();
    return {
        ...result,
        perTest: [ {
            ...test,
            definitionLocations: [ function () {
                return { kind: 'known', file: 'case.test.ts', line: 1, column: 1 };
            } ],
            attempts: [ {
                benchmark: null,
                attempt: { index: 0 },
                durationMicroseconds: 1,
                outcome,
                verdict: 'fail'
            } ],
            outcome
        }, { ...test, outcome: null } ],
        runnerErrors: [ {
            attributedToAttempt: null,
            attributedTo: null,
            cause: new Map([ [ 'seed', 42n ] ]),
            diagnostics: [],
            message: 'Opaque cause',
            subtype: 'crash'
        } ],
        artifacts: [ {
            id: {
                attempt: null,
                runtimes: [],
                scope: { kind: 'run' },
                sequence: 1,
                subtype: 'hedged-conflict',
                workload: null
            },
            payload: {
                authoritative: {
                    attachments: [],
                    attempts: [ {
                        benchmark: null,
                        attempt: { index: 0 },
                        durationMicroseconds: 1,
                        outcome,
                        verdict: 'fail'
                    } ],
                    outcome,
                    verdict: 'fail'
                },
                conflicting: {
                    attachments: [],
                    attempts: [ {
                        benchmark: null,
                        attempt: { index: 0 },
                        durationMicroseconds: 1,
                        outcome: null,
                        verdict: 'crashed'
                    } ],
                    outcome: null,
                    verdict: 'crashed'
                },
                kind: 'hedged-conflict',
                work: test.workId
            },
            source: 'native'
        }, {
            id: {
                attempt: null,
                runtimes: [],
                scope: { kind: 'run' },
                sequence: 2,
                subtype: 'log-capture',
                workload: null
            },
            payload: {
                byteLength: 3,
                capturedAtMicroseconds: 0,
                kind: 'captured-output',
                stream: 'stdout',
                text: 'log',
                truncated: false
            },
            source: 'native'
        } ]
    };
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/run-record-result.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'round trips bounded diagnostic evidence without serializing it twice',
            annotations: {},
            controls: {},
            body(scope) {
                const live = resultWithOpaqueEvidence();
                const diagnostics = serializeRunDiagnostics(live);
                const encoded = JSON.stringify(diagnostics);
                const restored = parseSerializedRunDiagnostics(JSON.parse(encoded));
                scope.assert.equal(JSON.stringify(restored), encoded);
                scope.assert.includes(encoded, '"file":"case.test.ts"');
                scope.assert.equal(typeof live.perTest[0]?.definitionLocations[0], 'function');
                scope.assert.throws(function rejectRawCause() {
                    parseSerializedRunDiagnostics({
                        ...diagnostics,
                        runnerErrors: [ {
                            attributedToAttempt: null,
                            attributedTo: null,
                            attributedToWork: null,
                            cause: 42,
                            diagnostics: [],
                            message: 'raw cause',
                            subtype: 'crash'
                        } ]
                    });
                }, { name: 'ZodError' });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'projects cyclic and bigint diagnostics without changing live outcomes or artifact identities',
            annotations: {},
            controls: {},
            body(scope) {
                const live = resultWithOpaqueEvidence();
                const recorded = recordedRunResult(live);
                const json = JSON.stringify(recorded);
                scope.assert.includes(json, '"kind":"bigint","value":"42"');
                scope.assert.includes(json, '"kind":"circular"');
                scope.assert.equal(recorded.perTest[1]?.outcome, null);
                scope.assert.deepEqual(
                    recorded.artifacts.map(function identity(artifact) {
                        return artifact.id;
                    }),
                    live.artifacts.map(function identity(artifact) {
                        return artifact.id;
                    })
                );
                scope.assert.equal(recorded.artifacts[1], live.artifacts[1]);
                scope.assert.equal(live.perTest[0]?.outcome?.kind, 'fail');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'serializes opaque attempt histories without mutating live evidence',
            annotations: {},
            controls: {},
            body(scope) {
                const live = resultWithOpaqueEvidence();
                const recorded = recordedRunResult(live);
                scope.assert.includes(JSON.stringify(recorded.perTest[0]?.attempts), '"kind":"bigint","value":"42"');
                scope.assert.includes(JSON.stringify(recorded.artifacts[0]), '"kind":"circular"');
                scope.assert.equal(live.perTest[0]?.attempts[0].outcome?.kind, 'fail');
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
