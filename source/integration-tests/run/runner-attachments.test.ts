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
import type { IntegrationExecution } from '../../config/types.ts';
import {
    defaultIntegrationProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';
import { runIfMain } from '../direct-launcher.test.ts';

const fixture = 'source/integration-tests/run/fixtures/runtime-attachments.test.ts';
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const workerExecution: IntegrationExecution = {
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
const executions: readonly IntegrationExecution[] = [
    { maxConcurrency: 1, processModel: 'supervised-process', scheduling: 'serial' },
    workerExecution,
    { ...workerExecution, workerLifecycle: 'fresh-worker-per-unit' },
    { ...workerExecution, hostProcess: { kind: 'child', nodeArguments: [] } }
];

async function runAttachmentFixture(
    execution: IntegrationExecution,
    runtimeStateDir: string
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
                    files: { include: [ fixture ], exclude: [] }
                })
            },
            reporters: [ reporter ],
            runtimeStateDir
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'integration', paths: [ fixture ], order: 'lexical' })
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

export const testNode = createSuite({
    ...metadata,
    title: 'source/integration-tests/run/runner-attachments.test.ts',
    children: executions.map(function executionTest(execution, index) {
        return createTestCase({
            ...metadata,
            title: `retains attachments through execution boundary ${index}`,
            async body(scope: TestScope) {
                const runtimeStateDir = `target/attachment-integration-${index}`;
                const { events, result } = await runAttachmentFixture(execution, runtimeStateDir);
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
    })
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
