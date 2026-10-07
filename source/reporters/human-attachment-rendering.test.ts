import type { WorkId } from '../engine/identity.ts';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import type { AttachmentContent, RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { problemLines } from './human-reporter-rendering.ts';

const definition = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const contents: readonly { readonly content: AttachmentContent; readonly expected: string; }[] = [
    {
        content: { kind: 'text', text: 'ready', byteLength: 5, completion: { kind: 'complete' } },
        expected: 'attachment "evidence" (application/octet-stream, 5 bytes):'
    },
    {
        content: {
            kind: 'text',
            text: 'prefix',
            byteLength: 6,
            completion: { kind: 'truncated', reason: 'byte-limit' }
        },
        expected: 'attachment "evidence" (application/octet-stream, 6 bytes): truncated (byte-limit)'
    },
    {
        content: { kind: 'json', value: { ready: true }, byteLength: 14 },
        expected: 'attachment "evidence" (application/octet-stream, 14 bytes):'
    },
    {
        content: { kind: 'file', path: 'artifacts/screenshot.bin', byteLength: 4, completion: { kind: 'complete' } },
        expected: 'attachment "evidence" (application/octet-stream, 4 bytes): artifacts/screenshot.bin'
    },
    {
        content: {
            kind: 'file',
            path: 'artifacts/screenshot.bin',
            byteLength: 3,
            completion: { kind: 'incomplete', reason: 'interrupted' }
        },
        expected:
            'attachment "evidence" (application/octet-stream, 3 bytes): artifacts/screenshot.bin incomplete (interrupted)'
    },
    {
        content: { kind: 'omitted', limit: 3, reason: 'byte-limit' },
        expected: 'attachment "evidence" (application/octet-stream): omitted (byte-limit)'
    }
];

function attachment(content: AttachmentContent): RuntimeAttachmentArtifact {
    return {
        id: { attempt: null, runtimes: [], scope: { kind: 'run' }, sequence: 0, subtype: 'attachment', workload: null },
        source: 'instrumented',
        payload: {
            capture: 'opt-in',
            capturedAtMicroseconds: 0,
            content,
            kind: 'runtime-attachment',
            mediaType: 'application/octet-stream',
            name: 'evidence',
            producer: { kind: 'case' }
        }
    };
}

function variantWork(name: string): WorkId {
    return {
        case: { file: 'variants.test.ts', suite: [], title: 'same case', params: null },
        runtimes: [ { name, dimensions: {}, scenarios: {}, variantId: null } ],
        workload: null
    };
}
function assertVariantEvidence(scope: TestScope): void {
    const first = variantWork('first');
    const second = variantWork('second');
    const base = attachment({ kind: 'text', text: 'second', byteLength: 6, completion: { kind: 'complete' } });
    const artifact: RuntimeAttachmentArtifact = {
        ...base,
        id: {
            ...base.id,
            attempt: { index: 0 },
            runtimes: second.runtimes,
            scope: { kind: 'case', case: second.case, activeCases: [ second.case ], confidence: 'active-case' }
        }
    };
    const result = runResultFactory.build({
        artifacts: [ artifact ],
        perTest: [
            { id: first.case, workId: first, outcome: { kind: 'fail', checks: [ { summary: 'first failure' } ] } },
            { id: second.case, workId: second, outcome: { kind: 'fail', checks: [ { summary: 'second failure' } ] } }
        ]
    });
    const lines = problemLines(result, {
        relativizeLocationPath(location) {
            return location.file;
        }
    }, { verbose: false });
    scope.assert.equal(
        lines
            .filter(function evidence(line) {
                return line.includes('attachment "evidence"');
            })
            .length,
        1
    );
    scope.assert.true(
        lines.findIndex(function secondFailure(line) {
            return line.includes('second failure');
        }) < lines.findIndex(function evidence(line) {
            return line.includes('attachment "evidence"');
        })
    );
}
export const testNode = createSuite({
    ...definition,
    title: 'source/reporters/human-attachment-rendering.test.ts',
    children: [
        ...([ 'missing', 'crash', 'inconclusive' ] as const).map(function interruptedEvidence(outcome) {
            return createTestCase({
                ...definition,
                title: `shows retained evidence with ${outcome} case results`,
                body(scope: TestScope) {
                    const work = variantWork('interrupted');
                    const base = attachment({
                        kind: 'file',
                        path: 'witnesses/reproduction.json',
                        byteLength: 4,
                        completion: { kind: 'complete' }
                    });
                    const artifact: RuntimeAttachmentArtifact = {
                        ...base,
                        source: 'native',
                        id: {
                            ...base.id,
                            attempt: { index: 0 },
                            subtype: 'witness',
                            runtimes: work.runtimes,
                            scope: {
                                kind: 'case',
                                case: work.case,
                                activeCases: [ work.case ],
                                confidence: 'active-case'
                            }
                        }
                    };
                    const result = runResultFactory.build({
                        status: 'failed',
                        artifacts: [ artifact ],
                        perTest: outcome === 'missing'
                            ? []
                            : [ {
                                id: work.case,
                                workId: work,
                                verdict: 'crashed',
                                outcome: outcome === 'crash' ? null : { kind: 'inconclusive', reason: 'interrupted' }
                            } ]
                    });
                    const lines = problemLines(result, {
                        relativizeLocationPath(location) {
                            return location.file;
                        }
                    }, { verbose: false });
                    scope.assert.equal(
                        lines
                            .filter(function evidence(line) {
                                return line.includes('witness "evidence"') &&
                                    line.includes('witnesses/reproduction.json');
                            })
                            .length,
                        1
                    );
                    scope.assert.true(lines.some(function identity(line) {
                        return line.includes('same case');
                    }));
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            ...definition,
            title: 'groups runtime variants by their full work identity',
            body(scope: TestScope) {
                assertVariantEvidence(scope);
                return scope.assert.collect();
            }
        }),
        ...contents.map(function renderAttachment({ content, expected }) {
            return createTestCase({
                ...definition,
                title: expected,
                body(scope: TestScope) {
                    const result = runResultFactory.build({
                        artifacts: [ attachment(content) ],
                        summary: { failed: 1 }
                    });
                    const lines = problemLines(result, {
                        relativizeLocationPath(location) {
                            return location.file;
                        }
                    }, { verbose: false });
                    scope.assert.deepEqual(lines, [ 'Problems', `  ${expected}` ]);
                    return scope.assert.collect();
                }
            });
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
