import {
    createSuite,
    createTestCase,
    type TestScope,
    type TestPlanCase
} from '../packages/engine/engine.entry-point.ts';
import { defineResource, withFailureArtifacts } from '../packages/test/resources.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { attachmentFixtureForWork } from '../test-support/attachment-fixture.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { runWithAttachmentContext } from '../attachments/attachment-context.ts';
import { prepareAttemptResource, prepareLifetimeResource } from './resource-failure-preparation.ts';
import type { ManagedResourceRecord } from './resource-lifecycle-session-acquirer.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
function selectedCase(): TestPlanCase {
    const engine = createTestEngine();
    const plan = engine.createTestPlan(
        engine.createRoot({
            ...metadata,
            title: 'root',
            children: [ engine.createTestCase({
                ...metadata,
                title: 'case',
                body(scope) {
                    scope.assert.true(true);
                    return scope.assert.collect();
                }
            }) ]
        })
    );
    return plan.cases[0];
}
function ownerRecord(scope: TestScope, recordCapture: (kind: string) => void): ManagedResourceRecord {
    const descriptor = withFailureArtifacts(
        defineResource({
            name: 'service',
            scope: 'per-run',
            requirements: [],
            dispose: null,
            acquire() {
                return { secret: 'owner' };
            },
            serializeHandle() {
                return { public: true };
            },
            deserializeHandle() {
                return { public: true };
            }
        }),
        async function prepareOwner(capture) {
            scope.assert.equal(capture.handle.secret, 'owner');
            recordCapture(capture.kind);
            await capture.attachments.json({ name: capture.kind, mediaType: 'application/json' }, {
                secret: capture.handle.secret
            });
        }
    );
    return {
        descriptor,
        boundary: { key: 'run:service', scope: 'per-run' },
        dependencyContext: {},
        external: false,
        ownerHandle: { secret: 'owner' },
        consumerHandle: { public: true }
    };
}
async function assertPreparationEligibility(scope: TestScope): Promise<void> {
    const captures: string[] = [];
    const record = ownerRecord(scope, function recordKind(kind) {
        captures.push(kind);
    });
    const testCase = selectedCase();
    const fixture = await attachmentFixtureForWork(scope, defaultAttachmentLimits, [ testCase.workId ]);
    await prepareAttemptResource(record, testCase, { index: 0 });
    await prepareLifetimeResource(record);
    await runWithAttachmentContext(fixture.execution.context, async function projectedConsumer() {
        await prepareAttemptResource({ ...record, external: true }, testCase, { index: 0 });
        await prepareLifetimeResource({ ...record, external: true });
    });
    scope.assert.deepEqual(captures, []);
    scope.assert.deepEqual(fixture.store.artifacts(), []);
}
async function assertOwnerPreparation(scope: TestScope): Promise<void> {
    const captures: string[] = [];
    const record = ownerRecord(scope, function recordKind(kind) {
        captures.push(kind);
    });
    const testCase = selectedCase();
    const fixture = await attachmentFixtureForWork(scope, defaultAttachmentLimits, [ testCase.workId ]);
    await runWithAttachmentContext(fixture.execution.context, async function ownedRun() {
        await fixture.execution.runAttempt(testCase.workId, { index: 0 }, async function ownedAttempt() {
            await prepareAttemptResource(record, testCase, { index: 0 });
        });
        await prepareLifetimeResource(record);
    });
    scope.assert.deepEqual(captures, [ 'attempt', 'lifetime' ]);
    scope.assert.deepEqual(
        fixture.store.artifacts().map(function scopeKind(artifact) {
            return artifact.id.scope.kind;
        }),
        [ 'case', 'run' ]
    );
}
export const testNode = createSuite({
    ...metadata,
    title: 'source/run/resource-failure-preparation.test.ts',
    children: [
        createTestCase({
            ...metadata,
            title: 'projected consumers and unmanaged sessions never invoke owner collectors',
            async body(scope: TestScope) {
                await assertPreparationEligibility(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'resource owners prepare exact attempt and lifetime evidence with private handles',
            async body(scope: TestScope) {
                await assertOwnerPreparation(scope);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
