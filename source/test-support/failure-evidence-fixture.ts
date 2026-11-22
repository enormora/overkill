import { readFile } from 'node:fs/promises';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import type { TestScope } from '@overkill-dev/test';

import { parseWitnessFile, type RunResult, type WorkId } from '../packages/engine/engine.entry-point.ts';
import type { AttachmentLimits } from '../engine/runtime-attachment.ts';
import { createResourceLifecycleRuntimePolicy } from '../run/resource-lifecycle.ts';
import { runWithAttachmentExecution } from '../run/resource-lifecycle-state.ts';
import { type EngineCaseBody, createTestEngine } from './create-test-engine.ts';

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
    cleanup: TestScope['cleanup'],
    body: EngineCaseBody,
    attempts: number,
    limits: AttachmentLimits
): Promise<EvidenceRun> {
    return await executeWithEvidence(body, attempts, async function (work) {
        return await attachmentFixtureForWork(cleanup, limits, work);
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

export const assertPreparedFile = defineCompositeAssertion({
    name: 'prepared file',
    async assert(check, fixture: AttachmentFixture) {
        const artifact = fixture.store.selectedArtifacts()[0];
        if (artifact?.payload.content.kind !== 'file') {
            throw new TypeError('Expected retained evidence file.');
        }
        return check.group([ check.equal(await readFile(artifact.payload.content.path, 'utf8'), 'before cleanup') ]);
    }
});

export const assertNativeEvidence = defineCompositeAssertion({
    name: 'native evidence',
    async assert(check, fixture: AttachmentFixture) {
        const witness = fixture.store.selectedArtifacts().find(function nativeWitness(artifact) {
            return artifact.id.subtype === 'witness';
        });
        if (witness?.payload.content.kind !== 'file') {
            throw new Error('Expected native witness file.');
        }
        const value = parseWitnessFile(JSON.parse(await readFile(witness.payload.content.path, 'utf8')));
        return check.group([ check.partialDeepEqual(value, {
            version: 1,
            seed: null,
            simulation: { name: 'api' }
        }) ]);
    }
});

export const assertCapturedText = defineCompositeAssertion({
    name: 'captured text',
    assert(check, fixture: AttachmentFixture, name: string, expected: string) {
        const artifact = fixture.store.selectedArtifacts().find(function matchingOutput(entry) {
            return entry.payload.name === name;
        });
        if (artifact?.payload.content.kind !== 'text') {
            throw new Error('Expected retained service output.');
        }
        return check.group([ check.equal(artifact.payload.content.text, expected) ]);
    }
});

export const assertSeededWitness = defineCompositeAssertion({
    name: 'retains the seed and request fault configuration',
    async assert(check, fixture: AttachmentFixture) {
        const witness = fixture.store.selectedArtifacts().find(function (artifact) {
            return artifact.id.subtype === 'witness';
        });
        if (witness?.payload.content.kind !== 'file') {
            throw new Error('Expected seeded witness file.');
        }
        const value = parseWitnessFile(JSON.parse(await readFile(witness.payload.content.path, 'utf8')));
        return check.group([
            check.partialDeepEqual(value, {
                seed: '9007199254740993',
                scenario: 'fault',
                runtimeSnapshot: { phase: 'request' },
                faultConfiguration: { delay: 5 }
            }),
            check.deepEqual(fixture.result.runnerErrors, [])
        ]);
    }
});
