import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { attachmentFixture, attachmentWork, type AttachmentFixture } from '../test-support/attachment-fixture.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { runWithAttachmentExecution } from '../run/resource-lifecycle-state.ts';
import { createProcessEvidence, processEvidenceSchema } from './process-evidence.ts';
import { moduleImportResult } from './module-import-result.ts';
import { processOutput } from './process-output.ts';

const observation = {
    url: 'file:///fixture.mjs',
    nodeVersion: process.versions.node,
    nodeArguments: [],
    durationMicroseconds: 0,
    processStartupMilliseconds: 2,
    failure: null
};

const oversizedModuleUrl = `file:///${'x'.repeat(4096)}`;

async function retainModuleEvidence(scope: TestScope, maximumBytes: number, url: string): Promise<AttachmentFixture> {
    const fixture = await attachmentFixture(scope, {
        ...defaultAttachmentLimits,
        maxInlineBytes: maximumBytes,
        maxArtifactBytes: maximumBytes
    });
    await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
        await fixture.execution.runAttempt(attachmentWork, { index: 0 }, async function attempt() {
            const evidence = createProcessEvidence();
            evidence.append('measured', {
                status: 'failed',
                message: 'fixture failure',
                cleanupFailure: null,
                output: processOutput('pipes', 0).snapshot()
            });
            evidence.moduleImport({ ...observation, url });
            await evidence.retain();
            await evidence.retain();
        });
    });
    return fixture;
}

function retainedEvidence(fixture: AttachmentFixture): ReturnType<typeof processEvidenceSchema.parse> {
    const content = fixture.store.artifacts()[0]?.payload.content;
    if (content?.kind !== 'json') {
        throw new Error('Expected retained process evidence.');
    }
    return processEvidenceSchema.parse(content.value);
}

export const testNode = suite('module import evidence', [
    test('keeps zero-duration imports explicit without infinite throughput', function (scope) {
        const result = moduleImportResult(observation, processOutput('pipes', 0).snapshot(), {
            availability: 'available',
            value: 0,
            provenance: { collector: 'process-output-v1', scope: 'process', unit: 'bytes' }
        });
        scope.assert.partialDeepEqual(result.metrics.durationMicroseconds, { availability: 'available', value: 0 });
        scope.assert.equal(result.metrics.operationsPerSecond.availability, 'unavailable');
        scope.assert.partialDeepEqual(result.metrics.processStartupMilliseconds, {
            availability: 'available',
            value: 2
        });
        return scope.assert.collect();
    }),
    test('retains process evidence when module metadata exceeds its byte budget', async function (scope: TestScope) {
        const fixture = await retainModuleEvidence(scope, 1024, oversizedModuleUrl);
        const evidence = retainedEvidence(fixture);
        scope.assert.equal(evidence.entries.length, 1);
        scope.assert.equal(evidence.entries[0]?.module, null);
        scope.assert.equal(evidence.omitted, 1);
        scope.assert.equal(fixture.store.artifacts().length, 1);
        scope.assert.deepEqual(await fixture.execution.finish(), []);
        return scope.assert.collect();
    }),
    test(
        'counts omitted module metadata when its process entry could not be retained',
        async function (scope: TestScope) {
            const fixture = await retainModuleEvidence(scope, 128, oversizedModuleUrl);
            scope.assert.partialDeepEqual(retainedEvidence(fixture), { entries: [], omitted: 2 });
            scope.assert.equal(fixture.store.artifacts().length, 1);
            scope.assert.deepEqual(await fixture.execution.finish(), []);
            return scope.assert.collect();
        }
    ),
    test('retains module metadata beside its owned process entry', async function (scope: TestScope) {
        const fixture = await retainModuleEvidence(scope, 1024, observation.url);
        const evidence = retainedEvidence(fixture);
        scope.assert.equal(evidence.entries.length, 1);
        const module = evidence.entries[0]?.module;
        scope.require.defined(module);
        scope.assert.deepEqual(module, observation);
        scope.assert.equal(evidence.omitted, 0);
        scope.assert.deepEqual(await fixture.execution.finish(), []);
        return scope.assert.collect();
    })
]);
