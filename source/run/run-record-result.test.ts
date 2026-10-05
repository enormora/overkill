import {
    createSuite,
    createTestCase,
    type RunResult,
    type TestOutcome
} from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { recordedRunResult } from './run-record-result.ts';

function opaqueFailure(): TestOutcome {
    const thrown = new Map<string, unknown>();
    thrown.set('self', thrown);
    thrown.set('seed', 42n);
    const error = { message: 'Failure', name: 'Error', stack: null, thrown };
    return {
        kind: 'fail',
        failures: [
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
            attempts: [ { attempt: { index: 0 }, durationMicroseconds: 1, outcome, verdict: 'fail' } ],
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
                    attempts: [ { attempt: { index: 0 }, durationMicroseconds: 1, outcome, verdict: 'fail' } ],
                    outcome,
                    verdict: 'fail'
                },
                conflicting: {
                    attempts: [ {
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
