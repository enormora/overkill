import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { attachmentRunFixture } from '../test-support/attachment-run-fixture.ts';
import { executeWithAttachments } from './attachment-run.ts';
import { currentAttachmentCoordinator } from './attachment-coordinator-context.ts';
import { createAttachmentConnection } from './attachment-connection.ts';

const definition = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const interruptedRecordSchema = z.object({
    status: z.literal('interrupted'),
    result: z.object({
        artifacts: z.array(z.object({
            payload: z.object({
                content: z.object({
                    kind: z.literal('file'),
                    path: z.string(),
                    byteLength: z.literal(3),
                    completion: z.object({ kind: z.literal('incomplete'), reason: z.literal('unclosed') })
                })
            })
        }))
    })
});

async function interruptRemoteWriter(): Promise<never> {
    const coordinator = currentAttachmentCoordinator();
    if (coordinator === null) {
        throw new Error('Expected an active attachment run.');
    }
    const connection = createAttachmentConnection(coordinator.endpoint);
    const opened = await connection.exchange({
        kind: 'open',
        branch: null,
        contentKind: 'binary',
        owner: { kind: 'run' },
        producer: { kind: 'resource', name: 'service' },
        metadata: { name: 'last screenshot', mediaType: 'image/png' }
    });
    if (opened.kind !== 'opened') {
        throw new Error('Expected an attachment writer.');
    }
    await connection.exchange({
        kind: 'write',
        writer: opened.writer,
        data: Buffer.from([ 1, 2, 3 ]).toString('base64')
    });
    throw new Error('Run interrupted after its last attachment write.');
}

async function assertInterruptedRecord(scope: TestScope): Promise<void> {
    const { resolved, dependencies, writes } = await attachmentRunFixture(scope);
    await scope.assert.rejects(async function runInterruptedSession() {
        await executeWithAttachments(resolved, dependencies, interruptRemoteWriter);
    }, { message: 'Run interrupted after its last attachment write.' });
    const content = Array.from(writes.values()).at(-1);
    scope.require.defined(content);
    const record = interruptedRecordSchema.parse(JSON.parse(content));
    scope.assert.equal(record.result.artifacts.length, 1);
    const artifact = record.result.artifacts[0];
    scope.require.defined(artifact);
    scope.assert.deepEqual(Array.from(await readFile(path.resolve(artifact.payload.content.path))), [ 1, 2, 3 ]);
}

export const testNode = createSuite({
    ...definition,
    title: 'source/run/runtime-attachment-record.test.ts',
    children: [
        createTestCase({
            ...definition,
            title: 'interrupted runs persist the final prefix and byte count of remote attachments',
            async body(scope: TestScope) {
                await assertInterruptedRecord(scope);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
