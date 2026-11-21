import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder } from '@overkill-dev/test/assert';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { table, suite, test, type TestScope } from '@overkill-dev/test';

import { z } from 'zod/v4';

import type { RunResult } from '../../packages/engine/engine.entry-point.ts';

import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import type { RetryArtifactPolicy } from '../../config/execution.ts';
import {
    defaultIntegrationProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';

const recordSchema = z.object({
    status: z.literal('completed'),
    result: z.object({ artifacts: z.array(z.unknown()) })
});

const fixture = 'source/integration-tests/runtime/fixtures/attachment-retention.test.ts';

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
const retainedRetryFilesChecks = async (
    check: CompositeCheckBuilder<'assert'>,
    attachments: RunResult['artifacts']
): Promise<CompositeAssertionReturn<'assert'>> => {
    const [ firstCheck, ...remainingChecks ] = await Promise.all(attachments.map(async (artifact) => {
        if (artifact.payload.kind !== 'runtime-attachment' || artifact.payload.content.kind !== 'file') {
            throw new Error('Expected binary attachment.');
        }
        const bytes = await readFile(path.resolve(artifact.payload.content.path));
        const files = await readdir(path.dirname(path.resolve(artifact.payload.content.path)));
        return check.group([
            check.equal(files.length, attachments.length),
            check.equal(
                bytes[0],
                artifact.id.attempt?.index
            )
        ]);
    }));
    if (firstCheck === undefined) {
        throw new Error('Expected at least one recorded check.');
    }
    return check.group([ firstCheck, ...remainingChecks ]);
};

const completedRecordChecks = async (
    check: CompositeCheckBuilder<'assert'>,
    stateDirectory: string,
    artifacts: RunResult['artifacts']
): Promise<CompositeAssertionReturn<'assert'>> => {
    const entries = await readdir(path.join(stateDirectory, 'runs'));
    const records = entries.filter(function record(name) {
        return name.endsWith('.json');
    });
    const current = records
        .toSorted(function (left, right) {
            return left.localeCompare(right);
        })
        .at(-1);
    if (current === undefined || current === null) {
        return check.defined(current);
    }
    const record: unknown = JSON.parse(await readFile(path.join(stateDirectory, 'runs', current), 'utf8'));
    const completed = recordSchema.parse(record);
    return check.group([ check.equal(JSON.stringify(completed.result.artifacts), JSON.stringify(artifacts)) ]);
};

const assertRetryFiles = defineCompositeAssertion({
    name: 'retry files',
    async assert(check, policy: RetryArtifactPolicy, indexes: readonly number[]) {
        const stateDirectory = `target/attachment-retry-${policy}`;
        const result = await retentionRun('retries retain their own files', policy, stateDirectory);
        const initialChecks = check.annotated(JSON.stringify(result.runnerErrors)).equal(result.status, 'passed');
        const attachments = result.artifacts.filter(function attachment(artifact) {
            return artifact.payload.kind === 'runtime-attachment';
        });
        return check.group([
            initialChecks,
            check.deepEqual(
                attachments.map(function attempt(artifact) {
                    return artifact.id.attempt?.index;
                }),
                indexes
            ),
            await retainedRetryFilesChecks(check.annotated('retained retry files'), attachments),
            await completedRecordChecks(check.annotated('completed record'), stateDirectory, result.artifacts)
        ]);
    }
});
export const testNode = suite('Runner attachment retention', [
    table({
        title: 'retains files according to attachment policy',
        cases: [ [ 'first-failure-and-final', [ 0, 2 ] ], [ 'last-failure-and-final', [ 1, 2 ] ], [ 'all', [
            0,
            1,
            2
        ] ] ] as const,
        caseTitle([ policy ]) {
            return policy;
        },
        async test(scope) {
            const [ policy, indexes ] = scope.parameters;

            await scope.assert(assertRetryFiles, policy, indexes);
            return scope.assert.collect();
        }
    }),
    test('unclosed attachment writers fail the runner and preserve text', async function (scope: TestScope) {
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
    })
]);
