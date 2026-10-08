import type { TestScope, TestBody, RunResult } from '../packages/engine/engine.entry-point.ts';
import type { AttachmentLimits } from '../engine/runtime-attachment.ts';
import { createResourceLifecycleRuntimePolicy } from '../run/resource-lifecycle.ts';
import { runWithAttachmentExecution } from '../run/resource-lifecycle-state.ts';
import { createTestEngine } from './create-test-engine.ts';
import { attachmentFixtureForWork, type AttachmentFixture } from './attachment-fixture.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
export async function executeEvidence(
    scope: TestScope,
    body: TestBody,
    attempts: number,
    limits: AttachmentLimits
): Promise<AttachmentFixture & { readonly result: RunResult; }> {
    const engine = createTestEngine();
    const plan = engine.createTestPlan(engine.createRoot({
        ...metadata,
        title: 'root',
        children: [ engine.createTestCase({ ...metadata, title: 'case', body }) ]
    }));
    const fixture = await attachmentFixtureForWork(
        scope,
        limits,
        plan.cases.map(function work(entry) {
            return entry.workId;
        })
    );
    const result = await runWithAttachmentExecution(fixture.execution, async function executeManagedResources() {
        return await engine.execute(plan, {
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
