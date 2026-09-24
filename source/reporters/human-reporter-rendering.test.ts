import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createDefaultWorkId, type CaseId } from '../engine/identity.ts';
import type { RunArtifact } from '../engine/run-result.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { problemLines } from './human-reporter-rendering.ts';

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

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/human-reporter-rendering.test.ts',
    annotations: {},
    controls: {},
    children: [
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
