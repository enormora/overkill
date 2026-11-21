import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { table, type TestScope, suite, test } from '@overkill-dev/test';

import { isTestDebugArtifact } from '../../packages/engine/engine.entry-point.ts';
import type { IntegrationExecution } from '../../config/types.ts';
import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import {
    defaultIntegrationProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';
import { parseRunArtifacts } from '../../run/run-artifact-schema.ts';

const fixture = 'source/integration-tests/runtime/fixtures/debug-mode.test.ts';
const crashFixture = 'source/integration-tests/runtime/fixtures/debug-crash.test.ts';
const worker: IntegrationExecution = {
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
    worker,
    { ...worker, workerLifecycle: 'fresh-worker-per-unit' },
    { ...worker, hostProcess: { kind: 'child', nodeArguments: [] } }
];
async function directory(cleanup: TestScope['cleanup']): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'overkill-debug-'));
    cleanup(async function removeDebugRun() {
        await rm(root, { recursive: true, force: true });
    });
    return root;
}
type DebugRunResult = Awaited<ReturnType<typeof orchestrator.run>>;
async function runFixture(
    execution: IntegrationExecution,
    runtimeStateDir: string,
    file: string
): Promise<DebugRunResult> {
    return await orchestrator.run({
        config: defaultRunConfig({
            profiles: {
                integration: defaultIntegrationProfile({
                    execution,
                    files: { include: [ file ], exclude: [] },
                    timeouts: { collectionMilliseconds: 30_000 }
                })
            },
            reporters: [],
            runtimeStateDir
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            profile: 'integration',
            paths: [ file ],
            order: 'lexical',
            debug: { mode: 'selected', selectors: [ file === fixture ? 'title=recording' : 'title~crashing' ] }
        })
    });
}
const assertCompletedDebug = defineCompositeAssertion({
    name: 'completed debug',
    assert(check, result: DebugRunResult) {
        const initialChecks = check.group([
            check.deepEqual(result.runnerErrors, []),
            check.equal(result.status, 'passed'),
            check.equal(result.perTest.length, 2)
        ]);
        const artifacts = result.artifacts.filter(isTestDebugArtifact);
        const intermediateChecks = check.equal(artifacts.length, 1);
        const [ artifact ] = artifacts;
        if (artifact === undefined || artifact === null) {
            return check.group([ initialChecks, intermediateChecks, check.defined(artifact) ]);
        }
        return check.group([
            initialChecks,
            intermediateChecks,
            check.defined(artifact),
            check.equal(artifact.payload.completeness, 'complete'),
            check.equal(artifact.payload.stats.handleCallCount, 2),
            check.equal(
                artifact.payload.moduleLoads.some(function loaded(entry) {
                    return entry.phase === 'load' && entry.specifier.startsWith('data:');
                }),
                true
            )
        ]);
    }
});
const assertPersistedDebug = defineCompositeAssertion({
    name: 'persisted debug',
    async assert(check, root: string) {
        const names = await readdir(path.join(root, 'runs'));
        const records = names.filter(function record(name) {
            return name.endsWith('.json');
        });
        const initialChecks = check.equal(records.length, 1);
        const [ recordName ] = records;
        if (recordName === undefined || recordName === null) {
            return check.group([ initialChecks, check.defined(recordName) ]);
        }
        const intermediateChecks = check.defined(recordName);
        const debugDirectory = path.join(root, 'runs', recordName.slice(0, -5), 'debug');
        const files = await readdir(debugDirectory);
        const laterChecks = check.equal(files.length, 1);
        const stored: unknown = JSON.parse(await readFile(path.join(debugDirectory, files[0] ?? ''), 'utf8'));
        return check.group([
            initialChecks,
            intermediateChecks,
            laterChecks,
            check.equal(parseRunArtifacts([ stored ])[0]?.payload.kind, 'debug')
        ]);
    }
});

export const testNode = suite('debug execution boundaries', [
    table({
        title: 'retains scoped diagnostics across execution placements',
        cases: executions,
        caseTitle(execution) {
            return `${execution.processModel}, ${
                execution.processModel === 'worker-pool'
                    ? `/${execution.workerLifecycle}/${execution.hostProcess.kind}`
                    : ''
            }`;
        },
        async test(scope) {
            const execution = scope.parameters;

            const root = await directory(scope.cleanup);
            const result = await runFixture(execution, root, fixture);
            scope.assert(assertCompletedDebug, result);
            await scope.assert(assertPersistedDebug, root);
            return scope.assert.collect();
        }
    }),
    test('retains partial debug evidence when a child exits abruptly', async function (scope: TestScope) {
        const root = await directory(scope.cleanup);
        const result = await runFixture(executions[0] ?? worker, root, crashFixture);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(
            result.artifacts.some(function crash(artifact) {
                return artifact.payload.kind === 'worker-crash';
            }),
            true
        );
        const partial = result.artifacts.find(isTestDebugArtifact);
        scope.require.defined(partial);
        scope.assert.equal(partial.payload.completeness, 'incomplete');
        scope.assert.equal(partial.payload.timeline[0]?.kind, 'body-start');
        scope.assert.equal(partial.payload.heapBeforeBytes.availability, 'available');
        return scope.assert.collect();
    })
]);
