import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import {
    createSuite,
    createTestCase,
    type RunResult,
    type TestScope
} from '../../packages/engine/engine.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import type { RetryArtifactPolicy } from '../../run/run-execution-config.ts';
import {
    defaultIntegrationProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';
import { runIfMain } from '../direct-launcher.test.ts';

const recordSchema = z.object({
    status: z.literal('completed'),
    result: z.object({ artifacts: z.array(z.unknown()) })
});

const fixture = 'source/integration-tests/run/fixtures/attachment-retention.test.ts';
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
async function retentionRun(title: string, policy: RetryArtifactPolicy, stateDirectory: string): Promise<RunResult> {
    return await orchestrator.run({
        config: defaultRunConfig({
            profiles: {
                integration: {
                    ...defaultIntegrationProfile({ files: { include: [ fixture ], exclude: [] } }),
                    retries: { artifacts: policy, maxAttempts: 3 }
                }
            },
            reporters: [],
            runtimeStateDir: stateDirectory
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            profile: 'integration',
            paths: [ fixture ],
            selection: { kind: 'filter', filter: { kind: 'equals', field: 'title', value: title } }
        })
    });
}
async function assertRetainedRetryFiles(scope: TestScope, attachments: RunResult['artifacts']): Promise<void> {
    for (const artifact of attachments) {
        if (artifact.payload.kind !== 'runtime-attachment' || artifact.payload.content.kind !== 'file') {
            throw new Error('Expected binary attachment.');
        }
        const bytes = await readFile(path.resolve(artifact.payload.content.path));
        const files = await readdir(path.dirname(path.resolve(artifact.payload.content.path)));
        scope.assert.equal(files.length, attachments.length);
        scope.assert.equal(
            bytes[0],
            artifact.id.attempt?.index
        );
    }
}
async function assertCompletedRecord(
    scope: TestScope,
    stateDirectory: string,
    artifacts: RunResult['artifacts']
): Promise<void> {
    const entries = await readdir(path.join(stateDirectory, 'runs'));
    const records = entries.filter(function record(name) {
        return name.endsWith('.json');
    });
    const current = records
        .toSorted(function (left, right) {
            return left.localeCompare(right);
        })
        .at(-1);
    scope.require.defined(current);
    const record: unknown = JSON.parse(await readFile(path.join(stateDirectory, 'runs', current), 'utf8'));
    const completed = recordSchema.parse(record);
    scope.assert.equal(JSON.stringify(completed.result.artifacts), JSON.stringify(artifacts));
}

async function assertRetryFiles(
    scope: TestScope,
    policy: RetryArtifactPolicy,
    indexes: readonly number[]
): Promise<void> {
    const stateDirectory = `target/attachment-retry-${policy}`;
    const result = await retentionRun('retries retain their own files', policy, stateDirectory);
    scope.assert.equal(result.status, 'passed', { message: JSON.stringify(result.runnerErrors) });
    const attachments = result.artifacts.filter(function attachment(artifact) {
        return artifact.payload.kind === 'runtime-attachment';
    });
    scope.assert.deepEqual(
        attachments.map(function attempt(artifact) {
            return artifact.id.attempt?.index;
        }),
        indexes
    );
    await assertRetainedRetryFiles(scope, attachments);
    await assertCompletedRecord(scope, stateDirectory, result.artifacts);
}
export const testNode = createSuite({
    ...metadata,
    title: 'source/integration-tests/run/runner-attachment-retention.test.ts',
    children: [
        ...([ [ 'first-failure-and-final', [ 0, 2 ] ], [ 'last-failure-and-final', [ 1, 2 ] ], [ 'all', [
            0,
            1,
            2
        ] ] ] as const)
            .map(function retryPolicyTest([ policy, indexes ]) {
                return createTestCase({
                    ...metadata,
                    title: `retains files with ${policy}`,
                    async body(scope: TestScope) {
                        await assertRetryFiles(scope, policy, indexes);
                        return scope.assert.collect();
                    }
                });
            }),
        createTestCase({
            ...metadata,
            title: 'unclosed attachment writers fail the runner and preserve text',
            async body(scope: TestScope) {
                const result = await retentionRun(
                    'unclosed writers retain their prefix',
                    'all',
                    'target/attachment-unclosed'
                );
                scope.assert.equal(result.status, 'failed');
                scope.assert.equal(
                    result
                        .runnerErrors
                        .filter(function attachmentError(error) {
                            return error.subtype === 'artifact';
                        })
                        .length,
                    1
                );
                const content = result
                    .artifacts
                    .find(function attachment(artifact) {
                        return artifact.payload.kind === 'runtime-attachment';
                    })
                    ?.payload;
                scope.require.defined(content);
                if (content.kind !== 'runtime-attachment') {
                    throw new Error('Expected runtime evidence.');
                }
                scope.assert.deepEqual(content.content, {
                    byteLength: 20,
                    completion: { kind: 'incomplete', reason: 'unclosed' },
                    kind: 'text',
                    text: 'last service message'
                });
                return scope.assert.collect();
            }
        })
    ]
});
await runIfMain(import.meta, testNode, [ createLineReporter() ]);
