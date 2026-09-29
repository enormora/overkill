import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createDefaultWorkId, type CaseId } from '../engine/identity.ts';
import type { RunArtifact, RunResult } from '../engine/run-result.ts';
import {
    preciseTimingReport,
    runTimingSummary,
    type RunTimingSpan
} from '../engine/run-timings.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { problemLines } from './human-reporter-rendering.ts';
import { formatTimingOffenderLines } from './run-summary-rendering.ts';

const passingCaseId: CaseId = { file: null, params: null, suite: [], title: 'passes' };
const failingCaseId: CaseId = { file: 'source/fails.test.ts', params: null, suite: [ 'root' ], title: 'fails' };

function caseOutputArtifact(): RunArtifact {
    return {
        id: {
            scope: {
                activeCases: [ passingCaseId ],
                case: passingCaseId,
                confidence: 'active-case',
                kind: 'case'
            },
            sequence: 0,
            subtype: 'log-capture'
        },
        payload: {
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
            scope: {
                activeCases: [ passingCaseId ],
                case: passingCaseId,
                confidence: 'active-case',
                kind: 'case'
            },
            sequence: 1,
            subtype: 'log-capture'
        },
        payload: {
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
            scope: { kind: 'run' },
            sequence: 0,
            subtype: 'hedged-conflict'
        },
        payload: {
            authoritative: { outcome: { kind: 'pass' }, verdict: 'pass' },
            conflicting: { outcome: null, verdict: 'crashed' },
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

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/human-reporter-rendering.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'human timing output shows at most five spans strictly above 500 ms',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
                        'timeout): 1200 ms',
                        '  collection import for source/users.test.ts: 1100 ms',
                        '  worker pool ready (worker lane-2): 1000 ms',
                        '  resource acquire for database (per-run): 900 ms',
                        '  cleanup (failure): 800 ms'
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'human timing output omits the block without a qualifying precise span',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(formatTimingOffenderLines(runResultFactory.build()), []);
                scope.assert.deepEqual(
                    formatTimingOffenderLines(resultWithTimingSpans([
                        successfulTimingSpan('config.load', 500_000)
                    ])),
                    []
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'human reporter problem lines include verbose passing artifacts and attributed runner errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
