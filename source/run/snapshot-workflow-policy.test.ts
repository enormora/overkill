import { type TestScope, suite, test } from '@overkill-dev/test';

import type { RunArtifact } from '../engine/run-result.ts';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';

import { snapshotWorkflow, snapshotEvent, snapshotUpdateFixture } from '../test-support/snapshot-workflow.ts';
import { baselineCaseResult } from '../test-support/baseline-case-fixture.ts';

import { baselineFilename } from './baseline-record.ts';

function isRuntimeAttachment(artifact: RunArtifact): artifact is RuntimeAttachmentArtifact {
    return artifact.payload.kind === 'runtime-attachment';
}
export const testNode = suite('snapshot baseline workflow', [
    test('updates matching snapshot baselines in stable publication order', async function (scope) {
        const { workflow, event, filenames } = await snapshotUpdateFixture();
        const evaluated = await workflow.evaluate(event);
        scope.assert.deepEqual(evaluated.errors, []);
        workflow.prepareResult(baselineCaseResult);
        scope.assert.deepEqual(
            workflow.changes.map(function (change) {
                return change.kind;
            }),
            [ 'update', 'update' ]
        );
        scope.assert.deepEqual(
            workflow.changes.map(function (change) {
                return baselineFilename(change.baseline);
            }),
            filenames
        );
        scope.assert.deepEqual(workflow.warnings, []);
        return scope.assert.collect();
    }),
    test('creates snapshot proposals when no stored baseline exists', async function (scope) {
        const workflow = await snapshotWorkflow([]);
        const event = await snapshotEvent([ { kind: 'text', name: 'response', actual: 'body' } ]);
        const evaluated = await workflow.evaluate(event);
        scope.assert.deepEqual(evaluated.errors, []);
        workflow.prepareResult(baselineCaseResult);
        scope.assert.equal(workflow.changes.length, 1);
        scope.assert.equal(workflow.changes[0]?.kind, 'create');
        return scope.assert.collect();
    }),
    test('preserves snapshot collection failures as attributed baseline errors', async function (scope: TestScope) {
        const workflow = await snapshotWorkflow([]);
        const event = await snapshotEvent([ { kind: 'text', name: 'response', actual: 'body' } ]);
        const artifact = event.artifacts[0];
        scope.require.defined(artifact);
        if (!isRuntimeAttachment(artifact)) {
            throw new Error('Expected snapshot attachment.');
        }
        const result = await workflow.evaluate({
            ...event,
            artifacts: [ {
                ...artifact,
                payload: { ...artifact.payload, content: { kind: 'omitted', limit: 1, reason: 'byte-limit' } as const }
            } ]
        });
        scope.assert.equal(result.errors.length, 1);
        scope.assert.deepEqual(workflow.changes, []);
        return scope.assert.collect();
    }),
    test('accepts successful cases without snapshot evidence', async function (scope) {
        const workflow = await snapshotWorkflow([]);
        const event = await snapshotEvent([]);
        const result = await workflow.evaluate(event);
        scope.assert.deepEqual(result.errors, []);
        workflow.prepareResult(baselineCaseResult);
        scope.assert.deepEqual(workflow.changes, []);
        return scope.assert.collect();
    })
]);
