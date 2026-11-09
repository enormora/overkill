import type { RunResult, TestScope } from '../packages/engine/engine.entry-point.ts';
import { snapshot } from '../packages/baselines/baselines.entry-point.ts';
import type { SnapshotInput } from '../baselines/snapshot-context.ts';
import {
    defaultAttachmentLimits,
    runWithAttachmentContext
} from '../packages/resources/attachment-context.entry-point.ts';
import { runWithSnapshotRun } from '../run/execution-session-context.ts';
import { runSnapshotAttempt } from '../run/snapshot-attempt.ts';
import { snapshotIdentity } from '../run/snapshot-identity.ts';
import { captureSnapshot } from '../run/snapshot-value.ts';
import { createTestEngine } from './create-test-engine.ts';
import { attachmentFixture, attachmentWork, type AttachmentFixture } from './attachment-fixture.ts';

type SnapshotRun = NonNullable<Parameters<typeof runWithSnapshotRun>[0]>;
type RecordedSnapshot<Value> = {
    readonly value: Value;
    readonly artifacts: ReturnType<AttachmentFixture['store']['artifacts']>;
};
export const snapshotWire: SnapshotRun = { profile: 'integration', mode: 'none', maxBytes: 1024, entries: [] };

export function storedSnapshot(input: SnapshotInput): SnapshotRun['entries'][number] {
    return {
        ...snapshotIdentity(snapshotWire.profile, attachmentWork, input.name, input.kind),
        subtype: 'content-snapshot',
        version: 1,
        payload: captureSnapshot(input, snapshotWire.maxBytes)
    };
}

export async function recordSnapshotAttempt<Value>(
    scope: TestScope,
    wire: SnapshotRun,
    body: () => Promise<Value>
): Promise<RecordedSnapshot<Value>> {
    const fixture = await attachmentFixture(scope, defaultAttachmentLimits);
    async function capture(): Promise<Value> {
        return await runSnapshotAttempt(attachmentWork, body);
    }
    async function ownAttempt(): Promise<Value> {
        return await fixture.execution.runAttempt(attachmentWork, { index: 0 }, capture);
    }
    async function attach(): Promise<Value> {
        return await runWithAttachmentContext(fixture.execution.context, ownAttempt);
    }
    const value = await runWithSnapshotRun(wire, attach);
    return { value, artifacts: fixture.store.artifacts() };
}

export async function executeSnapshot(scope: TestScope, wire: SnapshotRun, input: SnapshotInput): Promise<RunResult> {
    const engine = createTestEngine();
    const plan = engine.createTestPlan(engine.createRoot({
        title: 'snapshot consumer',
        annotations: {},
        controls: {},
        children: [ engine.createTestCase({
            title: 'response',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(caseScope) {
                caseScope.plan(1);
                if (input.kind === 'text') {
                    await caseScope.assert(snapshot.text, input.name, input.actual);
                } else if (input.kind === 'bytes') {
                    await caseScope.assert(snapshot.bytes, input.name, input.actual);
                } else {
                    await caseScope.assert(snapshot.value, input.name, input.actual);
                }
                return caseScope.assert.collect();
            }
        }) ]
    }));
    const captured = await recordSnapshotAttempt(scope, wire, async function executeConsumer() {
        return await engine.execute(plan);
    });
    return captured.value;
}
