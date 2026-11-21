import { defineMacro, suite, test } from '@overkill-dev/test';

import { z } from 'zod/v4';
import type { RunResult } from '../../../engine/run-result.ts';

import { localAttachmentRunFixture, type AttachmentRunFixture } from '../../../test-support/attachment-run-fixture.ts';
import { runResultFactory } from '../../../test-support/run-result-factory.ts';
import { attachmentsForProducer } from '../../../attachments/attachment-context.ts';
import { createRunRecordSession, type RunRecordSession } from '../../../run/run-record.ts';
import { executeWithRuntimeAttachments } from '../../../run/runtime-attachment-boundary.ts';
import { selectTestProfile } from '../../../run/test-profile.ts';

const snapshotSchema = z.object({
    status: z.enum([ 'started', 'completed', 'interrupted' ]),
    result: z.object({ artifacts: z.array(z.unknown()) }).nullable()
});
type Snapshot = Readonly<z.infer<typeof snapshotSchema>>;

function parentRecord(fixture: AttachmentRunFixture): RunRecordSession {
    const { resolved, dependencies } = fixture;
    return createRunRecordSession(resolved.cwd, {
        config: resolved.config,
        engine: resolved.engine,
        profile: selectTestProfile(resolved.request.profile, resolved.config),
        projectRoot: resolved.facts.environment.projectRoot,
        request: { ...resolved.request, record: true }
    }, {
        detail: 'detailed',
        async maintainHistory() {
            return [];
        },
        history: dependencies.createHistoryStorage(resolved.config.runtimeStateDir, resolved.config.history),
        createId() {
            return '01K00000000000000000000000';
        },
        node: dependencies.node,
        store: dependencies.runtimeStateStore,
        wallClock: dependencies.wallClock,
        versions: { engine: null, node: dependencies.node.version, packages: {} }
    });
}

function parentSnapshot(fixture: AttachmentRunFixture): Snapshot {
    const content = Array.from(fixture.writes.values()).at(-1);
    if (content === undefined || content === null) {
        throw new Error('Expected content to satisfy defined.');
    }
    return snapshotSchema.parse(JSON.parse(content));
}

async function captureAttachments(
    fixture: AttachmentRunFixture,
    record: RunRecordSession,
    fail: boolean
): Promise<RunResult> {
    const execute = async function execute(): Promise<RunResult> {
        return await executeWithRuntimeAttachments(fixture.resolved, fixture.dependencies, async function capture() {
            await attachmentsForProducer({ kind: 'resource', name: 'service' }).json(
                { name: 'setup', mediaType: 'application/json' },
                { ready: true }
            );
            if (fail) {
                throw new Error('Execution escaped.');
            }
            return runResultFactory.build();
        }, record);
    };
    return await execute();
}

async function finalizeParent(record: RunRecordSession, result: RunResult | null): Promise<void> {
    if (result === null) {
        await record.interrupt(new Error('Execution escaped.'));
    } else {
        await record.complete(result);
    }
}

const assertSharedRecord = defineMacro((title: string, fail: boolean) =>
    test(title, async (scope) => {
        const fixture = await localAttachmentRunFixture(scope.cleanup);
        const record = parentRecord(fixture);
        await record.start(null);
        let result: RunResult | null = null;
        if (fail) {
            await scope.assert.rejects(async () => {
                await captureAttachments(fixture, record, fail);
            }, { message: 'Execution escaped.' });
        } else {
            result = await captureAttachments(fixture, record, fail);
        }
        scope.assert.equal(fixture.writes.size, 1);
        scope.assert.equal(parentSnapshot(fixture).status, 'started');
        await finalizeParent(record, result);
        const final = parentSnapshot(fixture);
        scope.assert.equal(final.status, fail ? 'interrupted' : 'completed');
        scope.assert.equal(final.result?.artifacts.length, 1);

        return scope.assert.collect();
    })
);

export const testNode = suite('attachment recording shares its invocation record', [
    assertSharedRecord('successful attachments leave completion to the invocation owner', false),
    assertSharedRecord('escaping failures retain attachments until the invocation owner interrupts', true)
]);
