import {
    createSuite,
    createTestCase,
    type TestScope,
    type Engine,
    type TestNode
} from '../packages/engine/engine.entry-point.ts';
import { defineResource, withResources } from '../packages/test/resources.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { attachmentFixtureForWork } from '../test-support/attachment-fixture.ts';
import { createResourceLifecycleRuntimePolicy } from './resource-lifecycle.ts';
import { runWithAttachmentExecution } from './resource-lifecycle-state.ts';

const definition = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const evidence = { name: 'phase', mediaType: 'application/json' };

function resourceLifecycleCase(engine: Engine): TestNode {
    const service = defineResource({
        name: 'service',
        scope: 'per-case',
        requirements: [],
        async acquire({ attachments }) {
            await attachments.json(evidence, { phase: 'acquire' });
            return { ready: true };
        },
        async dispose(handle, { attachments }) {
            await attachments.json(evidence, { phase: 'dispose', ready: handle.ready });
        }
    });
    return engine.createTestCase({
        ...definition,
        title: 'case',
        body: withResources({ service }, async function captureCaseEvidence(scope) {
            await scope.attachments.json(evidence, { phase: 'body' });
            await scope.assert.rejects(async function rejectInvalidEvidence() {
                await scope.attachments.json(evidence, Number.NaN);
            }, { name: 'AttachmentOperationError' });
            scope.assert.equal(scope.resources.service.ready, true);
            return scope.assert.collect();
        })
    });
}

async function assertLifecycleEvidence(scope: TestScope): Promise<void> {
    const engine = createTestEngine();
    const plan = engine.createTestPlan(
        engine.createRoot({ ...definition, title: 'lifecycle', children: [ resourceLifecycleCase(engine) ] })
    );
    const { execution, store } = await attachmentFixtureForWork(
        scope,
        defaultAttachmentLimits,
        plan.cases.map(function selectedWork(testCase) {
            return testCase.workId;
        })
    );
    const result = await runWithAttachmentExecution(execution, async function executeLifecycle() {
        return engine.execute(plan, {
            execution: { mode: 'serial-in-process' },
            reporters: [],
            retryPolicy: { maxAttempts: 1 },
            runFacts: {},
            startedAt: '1970-01-01T00:00:00.000Z',
            runtimePolicy: createResourceLifecycleRuntimePolicy(plan.cases, null)
        });
    });
    scope.assert.equal(result.status, 'failed');
    scope.assert.equal(result.runnerErrors.length, 1);
    scope.assert.equal(result.runnerErrors[0]?.subtype, 'artifact');
    scope.assert.deepEqual(
        store.artifacts().map(function capturedPhase(artifact) {
            return artifact.payload.content.kind === 'json' ? artifact.payload.content.value : null;
        }),
        [ { phase: 'acquire' }, { phase: 'body' }, { phase: 'dispose', ready: true } ]
    );
    scope.assert.equal(
        store.artifacts().every(function caseOwned(artifact) {
            return artifact.id.scope.kind === 'case' && artifact.id.attempt?.index === 0;
        }),
        true
    );
}

export const testNode = createSuite({
    ...definition,
    title: 'source/run/runtime-attachment-lifecycle.test.ts',
    children: [
        createTestCase({
            ...definition,
            title: 'fixture lifecycle evidence remains case owned and caught errors fail the attempt',
            async body(scope: TestScope) {
                await assertLifecycleEvidence(scope);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
