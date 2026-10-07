import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite,
    createTestCase,
    defineReporter,
    type TestScope,
    type RunResult,
    type RunArtifact,
    type ReporterEvent
} from '../../packages/engine/engine.entry-point.ts';
import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import type { RunIntegrationExecution } from '../../run/run-types.ts';
import {
    defaultIntegrationProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';
import { runIfMain } from '../direct-launcher.test.ts';

const fixture = 'source/integration-tests/run/fixtures/runtime-attachments.test.ts';
const failureFixture = 'source/integration-tests/run/fixtures/integration-failure-artifacts.test.ts';
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const workerExecution: RunIntegrationExecution = {
    assignmentPolicy: 'case-count-balanced',
    dispatchPolicy: 'dynamic-lease',
    hedging: { mode: 'off' },
    hostProcess: { kind: 'direct' },
    maxConcurrency: 1,
    maxWorkers: 1,
    processModel: 'worker-pool',
    scheduling: 'serial',
    workDistribution: { mode: 'case' },
    workerLifecycle: 'reuse'
};
const executions: readonly RunIntegrationExecution[] = [
    { maxConcurrency: 1, processModel: 'supervised-process', scheduling: 'serial' },
    workerExecution,
    { ...workerExecution, workerLifecycle: 'fresh-worker-per-unit' },
    { ...workerExecution, hostProcess: { kind: 'child', nodeArguments: [] } }
];

async function runAttachmentFixture(
    execution: RunIntegrationExecution,
    runtimeStateDir: string,
    file: string
): Promise<{ readonly result: RunResult; readonly events: readonly ReporterEvent[]; }> {
    const events: ReporterEvent[] = [];
    const reporter = defineReporter(function createAttachmentObserver() {
        return {
            dispose: null,
            kind: 'real-time',
            name: 'attachment-observer',
            onEvent(event: ReporterEvent) {
                events.push(event);
            },
            onFinish: null,
            sinks: [ { kind: 'memory' } ]
        };
    });
    const result = await orchestrator.run({
        config: defaultRunConfig({
            profiles: {
                integration: defaultIntegrationProfile({
                    execution,
                    files: { include: [ file ], exclude: [] }
                })
            },
            reporters: [ reporter ],
            runtimeStateDir
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'integration', paths: [ file ], order: 'lexical' })
    });
    return { events, result };
}

async function assertAttemptArtifacts(scope: TestScope, artifacts: readonly RunArtifact[]): Promise<void> {
    for (const artifact of artifacts) {
        scope.assert.equal(artifact.id.scope.kind, 'case');
        scope.require.defined(artifact.id.attempt);
        scope.assert.deepEqual(artifact.id.attempt, { index: 0 });
        if (artifact.payload.kind === 'runtime-attachment' && artifact.payload.name === 'service-file') {
            const { content } = artifact.payload;
            if (content.kind !== 'file') {
                throw new Error('Expected retained service file.');
            }
            scope.assert.equal(
                await readFile(path.resolve(content.path), 'utf8'),
                'retained after teardown'
            );
        }
    }
}

async function assertRecordExists(scope: TestScope, runtimeStateDir: string): Promise<void> {
    const recordNames = await readdir(path.join(runtimeStateDir, 'runs'));
    const records = recordNames.filter(function recordFile(name) {
        return name.endsWith('.json');
    });
    scope.assert.true(records.length > 0);
}

function assertReportedAttachments(
    scope: TestScope,
    artifacts: readonly RunArtifact[],
    events: readonly ReporterEvent[]
): void {
    scope.assert.equal(artifacts.length, 7);
    const completion = events.find(function completedCase(event) {
        return event.kind === 'test-end';
    });
    scope.require.defined(completion);
    scope.assert.equal(completion.artifacts.length, 7);
}

async function assertWitnessEvidence(scope: TestScope, artifact: RunArtifact): Promise<void> {
    if (artifact.payload.kind !== 'runtime-attachment' || artifact.payload.content.kind !== 'file') {
        throw new Error('Expected witness file.');
    }
    const witness: unknown = JSON.parse(await readFile(path.resolve(artifact.payload.content.path), 'utf8'));
    scope.assert.partialDeepEqual(witness, { version: 1, kind: 'simulation', seed: null, scenario: 'default' });
    scope.assert.true(artifact.payload.content.path.includes('witnesses/'));
}
async function assertFailureArtifact(scope: TestScope, artifact: RunArtifact): Promise<void> {
    if (artifact.payload.kind !== 'runtime-attachment') {
        throw new Error('Expected failure artifact.');
    }
    scope.assert.equal(artifact.payload.capture, 'automatic');
    if (artifact.payload.name === 'attempt' || artifact.payload.name === 'lifetime') {
        scope.assert.deepEqual(artifact.payload.content, {
            kind: 'json',
            value: { secret: 'owner-only' },
            byteLength: 23
        });
    }
    if (artifact.id.subtype === 'witness') {
        await assertWitnessEvidence(scope, artifact);
    }
    scope.assert.equal(artifact.id.scope.kind, artifact.payload.name === 'lifetime' ? 'run' : 'case');
}
async function assertFailureEvidence(scope: TestScope, artifacts: readonly RunArtifact[]): Promise<void> {
    const names = artifacts
        .map(function artifactName(artifact) {
            return artifact.payload.kind === 'runtime-attachment' ? artifact.payload.name : '';
        })
        .toSorted(function compareNames(left, right) {
            return left.localeCompare(right);
        });
    scope.assert.deepEqual(names, [ 'attempt', 'http-transcript', 'lifetime', 'scenario-witness', 'stderr', 'stdout' ]);
    for (const artifact of artifacts) {
        await assertFailureArtifact(scope, artifact);
    }
}

async function assertCrashEvidence(scope: TestScope, execution: RunIntegrationExecution, index: number): Promise<void> {
    const { result } = await runAttachmentFixture(
        execution,
        `target/failure-artifact-crash-${index}`,
        'source/integration-tests/run/fixtures/integration-artifact-crash.test.ts'
    );
    scope.assert.equal(result.status, 'failed');
    const artifact = result.artifacts.find(function capturedPrefix(entry) {
        return entry.payload.kind === 'runtime-attachment' && entry.payload.name === 'http-transcript';
    });
    if (artifact?.payload.kind !== 'runtime-attachment' || artifact.payload.content.kind !== 'text') {
        throw new Error('Owner crash must retain the checkpointed HTTP transcript prefix.');
    }
    scope.assert.true(artifact.payload.content.text.includes(Buffer.from('{"ready":true}').toString('base64')));
    scope.assert.deepEqual(artifact.payload.content.completion, { kind: 'incomplete', reason: 'interrupted' });
}

export const testNode = createSuite({
    ...metadata,
    title: 'source/integration-tests/run/runner-attachments.test.ts',
    children: [
        ...executions.map(function executionTest(execution, index) {
            return createTestCase({
                ...metadata,
                title: `retains attachments through execution boundary ${index}`,
                async body(scope: TestScope) {
                    const runtimeStateDir = `target/attachment-integration-${index}`;
                    const { events, result } = await runAttachmentFixture(execution, runtimeStateDir, fixture);
                    scope.assert.equal(result.status, 'passed', { message: JSON.stringify(result.runnerErrors) });
                    const artifacts = result.artifacts.filter(function runtimeArtifact(artifact) {
                        return artifact.payload.kind === 'runtime-attachment';
                    });
                    assertReportedAttachments(scope, artifacts, events);
                    await assertAttemptArtifacts(scope, artifacts);
                    await assertRecordExists(scope, runtimeStateDir);
                    return scope.assert.collect();
                }
            });
        }),
        ...executions.map(function failureExecutionTest(execution, index) {
            return createTestCase({
                ...metadata,
                title: `captures failed integration resource evidence through boundary ${index}`,
                async body(scope: TestScope) {
                    const { result } = await runAttachmentFixture(
                        execution,
                        `target/failure-artifact-integration-${index}`,
                        failureFixture
                    );
                    scope.assert.equal(result.status, 'failed');
                    scope.assert.deepEqual(result.runnerErrors, []);
                    const artifacts = result.artifacts.filter(function evidenceArtifact(artifact) {
                        return artifact.payload.kind === 'runtime-attachment';
                    });
                    scope.assert.equal(artifacts.length, 6, { message: JSON.stringify(result) });
                    await assertFailureEvidence(scope, artifacts);
                    return scope.assert.collect();
                }
            });
        }),
        ...executions.map(function crashExecutionTest(execution, index) {
            return createTestCase({
                ...metadata,
                title: `retains checkpointed HTTP prefixes after owner crash through boundary ${index}`,
                async body(scope: TestScope) {
                    await assertCrashEvidence(scope, execution, index);
                    return scope.assert.collect();
                }
            });
        })
    ]
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
