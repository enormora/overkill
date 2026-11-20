import { type EngineCaseBody, createTestEngine } from './create-test-engine.ts';
import type { TestScope } from '@overkill-dev/test';

import type { RunResult, WorkId } from '../packages/engine/engine.entry-point.ts';
import type { AttachmentLimits } from '../engine/runtime-attachment.ts';
import { createResourceLifecycleRuntimePolicy } from '../run/resource-lifecycle.ts';
import { runWithAttachmentExecution } from '../run/resource-lifecycle-state.ts';

import { attachmentFixtureForWork, inlineAttachmentFixture, type AttachmentFixture } from './attachment-fixture.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
type EvidenceRun = AttachmentFixture & { readonly result: RunResult; };
type EvidenceAttachments = (work: readonly WorkId[]) => Promise<AttachmentFixture>;
async function executeWithEvidence(
    body: EngineCaseBody,
    attempts: number,
    attachments: EvidenceAttachments
): Promise<EvidenceRun> {
    const engine = createTestEngine();
    const plan = engine.createTestPlan(engine.createRoot({
        ...metadata,
        title: 'root',
        children: [ engine.createTestCase({ ...metadata, title: 'case', body }) ]
    }));
    const fixture = await attachments(plan.cases.map(function work(entry) {
        return entry.workId;
    }));
    const result = await runWithAttachmentExecution(fixture.execution, async function executeManagedResources() {
        return await engine.execute(plan, {
            debug: { mode: 'off' },
            execution: { mode: 'serial-in-process' },
            reporters: [],
            runFacts: {},
            startedAt: '1970-01-01T00:00:00.000Z',
            retryPolicy: { maxAttempts: attempts },
            runtimePolicy: createResourceLifecycleRuntimePolicy(plan.cases, null)
        });
    });
    fixture.store.settleResult(result);
    return { ...fixture, result };
}

export async function executeEvidence(
    scope: TestScope,
    body: EngineCaseBody,
    attempts: number,
    limits: AttachmentLimits
): Promise<EvidenceRun> {
    return await executeWithEvidence(body, attempts, async function (work) {
        return await attachmentFixtureForWork(scope, limits, work);
    });
}

export async function executeInlineEvidence(
    body: EngineCaseBody,
    attempts: number,
    limits: AttachmentLimits
): Promise<EvidenceRun> {
    return await executeWithEvidence(body, attempts, async function (work) {
        return inlineAttachmentFixture(limits, work);
    });
}
