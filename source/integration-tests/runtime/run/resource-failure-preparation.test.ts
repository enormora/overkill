import { suite, test } from '@overkill-dev/test';

import type { TestPlanCase } from '../../../packages/engine/engine.entry-point.ts';
import { defineResource, withFailureArtifacts } from '../../../packages/test/resources.entry-point.ts';
import { createTestEngine } from '../../../test-support/create-test-engine.ts';
import { attachmentFixtureForWork } from '../../../test-support/attachment-fixture.ts';
import { defaultAttachmentLimits } from '../../../engine/runtime-attachment.ts';
import { currentAttachmentContext, runWithAttachmentContext } from '../../../attachments/attachment-context.ts';
import { prepareAttemptResource, prepareLifetimeResource } from '../../../run/resource-failure-preparation.ts';
import type { ManagedResourceRecord } from '../../../run/resource-lifecycle-session-acquirer.ts';

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
type OwnerCapture = { readonly kind: string; readonly secret: unknown; };
function ownerRecord(recordCapture: (capture: OwnerCapture) => void): ManagedResourceRecord {
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
            recordCapture({ kind: capture.kind, secret: capture.handle.secret });
            await capture.attachments.json({ name: capture.kind, mediaType: 'application/json' }, {
                secret: capture.handle.secret
            });
        }
    );
    return {
        releaseOwner() {
            return undefined;
        },
        descriptor,
        checks: null,
        boundary: { key: 'run:service', scope: 'per-run' },
        dependencyContext: {},
        external: false,
        ownerHandle: { secret: 'owner' },
        replayScenario: null,
        consumerHandle: { public: true }
    };
}

export const testNode = suite('Resource failure preparation', [
    test('projected consumers and unmanaged sessions never invoke owner collectors', async (scope) => {
        const captures: OwnerCapture[] = [];
        const record = ownerRecord(function recordKind(kind) {
            captures.push(kind);
        });
        const testCase = selectedCase();
        const fixture = await attachmentFixtureForWork(scope.cleanup, defaultAttachmentLimits, [ testCase.workId ]);
        const outerContext = currentAttachmentContext();
        await runWithAttachmentContext(null, async function unmanagedSession() {
            await prepareAttemptResource(record, testCase, { index: 0 });
            await prepareLifetimeResource(record);
        });
        await runWithAttachmentContext(fixture.execution.context, async function projectedConsumer() {
            await prepareAttemptResource({ ...record, external: true }, testCase, { index: 0 });
            await prepareLifetimeResource({ ...record, external: true });
        });
        scope.assert.equal(currentAttachmentContext(), outerContext);
        scope.assert.deepEqual(captures, []);
        scope.assert.deepEqual(fixture.store.artifacts(), []);

        return scope.assert.collect();
    }),
    test('resource owners prepare exact attempt and lifetime evidence with private handles', async (scope) => {
        const captures: OwnerCapture[] = [];
        const record = ownerRecord(function recordKind(kind) {
            captures.push(kind);
        });
        const testCase = selectedCase();
        const fixture = await attachmentFixtureForWork(scope.cleanup, defaultAttachmentLimits, [ testCase.workId ]);
        await runWithAttachmentContext(fixture.execution.context, async function ownedRun() {
            await fixture.execution.runAttempt(testCase.workId, { index: 0 }, async function ownedAttempt() {
                await prepareAttemptResource(record, testCase, { index: 0 });
            });
            await prepareLifetimeResource(record);
        });
        scope.assert.deepEqual(captures, [ { kind: 'attempt', secret: 'owner' }, {
            kind: 'lifetime',
            secret: 'owner'
        } ]);
        scope.assert.deepEqual(
            fixture.store.artifacts().map(function scopeKind(artifact) {
                return artifact.id.scope.kind;
            }),
            [ 'case', 'run' ]
        );

        return scope.assert.collect();
    })
]);
