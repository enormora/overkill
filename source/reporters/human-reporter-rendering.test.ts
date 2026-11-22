import { suite, test } from '@overkill-dev/test';

import { defaultFailureArtifactPolicy } from '../packages/engine/engine.entry-point.ts';
import { createDefaultWorkId, type CaseId } from '../engine/identity.ts';
import type { RunResult, RunArtifact } from '../engine/run-result.ts';
import { preciseTimingReport, runTimingSummary, type RunTimingSpan } from '../engine/run-timings.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';

import { contextPrefix, problemLines } from './human-reporter-rendering.ts';
import { formatTimingOffenderLines } from './run-summary-rendering.ts';

const passingCaseId: CaseId = { file: null, params: null, suite: [], title: 'passes' };
const failingCaseId: CaseId = { file: 'source/fails.test.ts', params: null, suite: [ 'root' ], title: 'fails' };

function caseOutputArtifact(): RunArtifact {
    return {
        id: {
            familyVariant: null,
            attempt: { index: 0 },
            runtimes: [],
            scope: {
                activeCases: [ passingCaseId ],
                case: passingCaseId,
                confidence: 'active-case',
                kind: 'case'
            },
            sequence: 0,
            subtype: 'log-capture',
            workload: null
        },
        payload: {
            capture: 'automatic',
            completeness: 'best-effort',
            byteLength: 13,
            capturedAtMicroseconds: 1,
            kind: 'captured-output',
            stream: 'stdout',
            text: 'visible output',
            truncated: false
        },
        source: 'boundary-captured'
    };
}

function truncatedCaseOutputArtifact(): RunArtifact {
    return {
        id: {
            familyVariant: null,
            attempt: { index: 0 },
            runtimes: [],
            scope: {
                activeCases: [ passingCaseId ],
                case: passingCaseId,
                confidence: 'active-case',
                kind: 'case'
            },
            sequence: 1,
            subtype: 'log-capture',
            workload: null
        },
        payload: {
            capture: 'automatic',
            completeness: 'best-effort',
            byteLength: 0,
            capturedAtMicroseconds: 2,
            kind: 'captured-output',
            stream: 'stderr',
            text: '',
            truncated: true
        },
        source: 'boundary-captured'
    };
}

function ignoredRunArtifact(): RunArtifact {
    return {
        id: {
            familyVariant: null,
            attempt: null,
            runtimes: [],
            scope: { kind: 'run' },
            sequence: 0,
            subtype: 'hedged-conflict',
            workload: null
        },
        payload: {
            authoritative: {
                attachments: [],
                attempts: [ {
                    property: null,
                    benchmark: null,
                    attempt: { index: 0 },
                    durationMicroseconds: 0,
                    outcome: { kind: 'pass' },
                    verdict: 'pass'
                } ],
                outcome: { kind: 'pass' },
                verdict: 'pass'
            },
            conflicting: {
                attachments: [],
                attempts: [ {
                    property: null,
                    benchmark: null,
                    attempt: { index: 0 },
                    durationMicroseconds: 0,
                    outcome: null,
                    verdict: 'crashed'
                } ],
                outcome: null,
                verdict: 'crashed'
            },
            kind: 'hedged-conflict',
            work: createDefaultWorkId(passingCaseId)
        },
        source: 'native'
    };
}

function successfulTimingSpan(kind: RunTimingSpan['kind'], durationMicroseconds: number): RunTimingSpan {
    return {
        durationMicroseconds,
        kind,
        label: null,
        processId: null,
        resource: null,
        startOffsetMicroseconds: 0,
        startTimeUnixMicroseconds: 0,
        status: 'success',
        workerId: null
    };
}

function resultWithTimingSpans(spans: readonly RunTimingSpan[]): RunResult {
    return runResultFactory.build({
        timings: {
            precise: preciseTimingReport({
                aggregationMicroseconds: 3,
                observationWindow: { durationMicroseconds: 0, startTimeUnixMicroseconds: 0 },
                recordingMicroseconds: 4,
                slowestSpanLimit: 50,
                spanLimit: 5000,
                spans
            }),
            summary: runTimingSummary({
                testExecutionWallTimeMicroseconds: 0,
                totalWallTimeMicroseconds: 2_000_000
            })
        }
    });
}

export const testNode = suite('Human reporter rendering', [
    test('human context prefixes retain nested suites when color is requested', function (scope) {
        const prefix = contextPrefix([], null, [ 'root', 'child' ], { color: true, wrap: false });
        scope.assert.includes(prefix, 'root');
        scope.assert.includes(prefix, ' > child]');
        return scope.assert.collect();
    }),
    test('human problem output preserves workload attribution on runner errors', function (scope) {
        const result = runResultFactory.build({
            runnerErrors: [ {
                message: 'worker stopped',
                subtype: 'loader',
                attributedTo: failingCaseId,
                attributedToWork: {
                    ...createDefaultWorkId(failingCaseId),
                    workload: { name: 'large', params: {} }
                }
            } ]
        });
        scope.assert.deepEqual(
            problemLines(result, {
                failureArtifacts: defaultFailureArtifactPolicy,
                relativizeLocationPath(location) {
                    return location.file;
                }
            }, { verbose: true }),
            [
                'Problems',
                '  Runner error: worker stopped',
                '  type: loader',
                '  test: source/fails.test.ts: root > fails [workload=large]'
            ]
        );
        return scope.assert.collect();
    }),
    test('human problem output labels case artifacts without a corresponding result', function (scope) {
        const result = runResultFactory.build({ artifacts: [ caseOutputArtifact() ], perTest: [] });
        scope.assert.deepEqual(
            problemLines(result, {
                failureArtifacts: defaultFailureArtifactPolicy,
                relativizeLocationPath(location) {
                    return location.file;
                }
            }, { verbose: true }),
            [ 'Problems', '  passes', '    stdout:', '    visible output' ]
        );
        return scope.assert.collect();
    }),
    test('human timing output shows at most five spans strictly above 500 ms', function (scope) {
        const spans: readonly RunTimingSpan[] = [
            {
                ...successfulTimingSpan('resource.acquire', 1_200_000),
                label: 'startup',
                processId: '42',
                resource: { name: 'database', scope: 'per-run' },
                status: 'timeout',
                workerId: 'lane-1'
            },
            { ...successfulTimingSpan('collection.import', 1_100_000), label: 'source/users.test.ts' },
            { ...successfulTimingSpan('worker-pool.ready', 1_000_000), workerId: 'lane-2' },
            {
                ...successfulTimingSpan('resource.acquire', 900_000),
                resource: { name: 'database', scope: 'per-run' }
            },
            { ...successfulTimingSpan('cleanup', 800_000), status: 'failure' },
            successfulTimingSpan('reporter.finish', 700_000),
            successfulTimingSpan('reporter.deliver', 500_000)
        ];

        scope.assert.deepEqual(
            formatTimingOffenderLines(resultWithTimingSpans(spans)),
            [
                'Slow runner overhead:',
                '  resource acquire for startup (resource database, per-run, process 42, worker lane-1, ' +
                'timeout): 1.2 s',
                '  collection import for source/users.test.ts: 1.1 s',
                '  worker pool ready (worker lane-2): 1 s',
                '  resource acquire for database (per-run): 900 ms',
                '  cleanup (failure): 800 ms'
            ]
        );

        return scope.assert.collect();
    }),
    test('human timing output omits the block without a qualifying precise span', function (scope) {
        scope.assert.deepEqual(formatTimingOffenderLines(runResultFactory.build()), []);
        scope.assert.deepEqual(
            formatTimingOffenderLines(resultWithTimingSpans([
                successfulTimingSpan('config.load', 500_000)
            ])),
            []
        );

        return scope.assert.collect();
    }),
    test(
        'human reporter problem lines include verbose passing artifacts and attributed runner errors',
        async function (scope) {
            const result = runResultFactory.build({
                artifacts: [ caseOutputArtifact(), truncatedCaseOutputArtifact(), ignoredRunArtifact() ],
                perTest: [
                    {
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        id: passingCaseId,
                        outcome: { kind: 'pass' },
                        verdict: 'pass'
                    }
                ],
                runnerErrors: [
                    {
                        attributedTo: failingCaseId,
                        diagnostics: [ { label: 'phase', value: 'teardown' } ],
                        message: 'worker stopped',
                        subtype: 'runtime-policy'
                    }
                ],
                summary: { failed: 1, passed: 1 }
            });

            scope.assert.deepEqual(
                problemLines(result, {
                    failureArtifacts: defaultFailureArtifactPolicy,
                    relativizeLocationPath(location) {
                        return location.file;
                    }
                }, { verbose: true }),
                [
                    'Problems',
                    '  passes',
                    '    stdout:',
                    '    visible output',
                    '  passes',
                    '    stderr truncated:',
                    '  Runner error: worker stopped',
                    '  type: runtime-policy',
                    '  test: source/fails.test.ts: root > fails',
                    '  phase: teardown'
                ]
            );

            return scope.assert.collect();
        }
    ),
    test('human context prefixes render sorted runtime scenarios', function (scope) {
        const plainRuntime = {
            dimensions: {},
            name: 'api',
            scenarios: {},
            variantId: null
        };

        scope.assert.equal(
            contextPrefix([ plainRuntime ], null, [], { color: false, wrap: false }),
            '[api]'
        );
        scope.assert.equal(
            contextPrefix([ plainRuntime ], { name: 'small', params: {} }, [], { color: false, wrap: false }),
            '[api] [workload=small]'
        );
        scope.assert.includes(
            contextPrefix([ plainRuntime ], null, [], { color: true, wrap: false }),
            'api'
        );
        scope.assert.equal(
            contextPrefix(
                [ { ...plainRuntime, scenarios: { api: 'payments-500' } } ],
                null,
                [],
                { color: false, wrap: false }
            ),
            '[api:scenario.api=payments-500]'
        );
        scope.assert.equal(
            contextPrefix(
                [ { ...plainRuntime, variantId: 'node-26' } ],
                null,
                [],
                { color: false, wrap: false }
            ),
            '[api:node-26]'
        );
        scope.assert.equal(
            contextPrefix(
                [ {
                    dimensions: { node: '26' },
                    name: 'api',
                    scenarios: { database: 'empty', api: 'payments-500' },
                    variantId: null
                } ],
                null,
                [],
                { color: false, wrap: false }
            ),
            '[api:node=26,scenario.api=payments-500,scenario.database=empty]'
        );

        return scope.assert.collect();
    })
]);
