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

export const testNode = createSuite({
    ...definition,
    title: 'source/reporters/human-attachment-rendering.test.ts',
    children: contents.map(function renderAttachment({ content, expected }) {
        return createTestCase({
            ...definition,
            title: expected,
            body(scope: TestScope) {
                const result = runResultFactory.build({ artifacts: [ attachment(content) ], summary: { failed: 1 } });
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
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
