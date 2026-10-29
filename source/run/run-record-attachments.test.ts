import { runIfMain } from '#test-runner';
import { z } from 'zod/v4';
import type { RunResult } from '../engine/run-result.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import {
    localAttachmentRunFixture,
    type AttachmentRunFixture
} from '../test-support/attachment-run-fixture.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { attachmentsForProducer } from '../attachments/attachment-context.ts';
import { createRunRecordSession, type RunRecordSession } from './run-record.ts';
import { executeWithRuntimeAttachments } from './runtime-attachment-boundary.ts';
import { selectTestProfile } from './test-profile.ts';

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

function parentSnapshot(scope: TestScope, fixture: AttachmentRunFixture): Snapshot {
    const content = Array.from(fixture.writes.values()).at(-1);
    scope.require.defined(content);
    return snapshotSchema.parse(JSON.parse(content));
}

async function captureAttachments(
    scope: TestScope,
    fixture: AttachmentRunFixture,
    record: RunRecordSession,
    fail: boolean
): Promise<RunResult | null> {
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
    if (fail) {
        await scope.assert.rejects(execute, { message: 'Execution escaped.' });
        return null;
    }
    return await execute();
}

async function finalizeParent(record: RunRecordSession, result: RunResult | null): Promise<void> {
    if (result === null) {
        await record.interrupt(new Error('Execution escaped.'));
    } else {
        await record.complete(result);
    }
}

async function assertSharedRecord(scope: TestScope, fail: boolean): Promise<void> {
    const fixture = await localAttachmentRunFixture(scope);
    const record = parentRecord(fixture);
    await record.start(null);
    const result = await captureAttachments(scope, fixture, record, fail);
    scope.assert.equal(fixture.writes.size, 1);
    scope.assert.equal(parentSnapshot(scope, fixture).status, 'started');
    await finalizeParent(record, result);
    const final = parentSnapshot(scope, fixture);
    scope.assert.equal(final.status, fail ? 'interrupted' : 'completed');
    scope.assert.equal(final.result?.artifacts.length, 1);
}

export const testNode = suite('attachment recording shares its invocation record', [
    test('successful attachments leave completion to the invocation owner', async function (scope) {
        await assertSharedRecord(scope, false);
        return scope.assert.collect();
    }),
    test('escaping failures retain attachments until the invocation owner interrupts', async function (scope) {
        await assertSharedRecord(scope, true);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
