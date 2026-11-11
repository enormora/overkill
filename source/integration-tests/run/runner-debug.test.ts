import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { isTestDebugArtifact } from '../../packages/engine/engine.entry-point.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import type { IntegrationExecution } from '../../config/types.ts';
import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import {
    defaultIntegrationProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';
import { parseRunArtifacts } from '../../run/run-artifact-schema.ts';

const fixture = 'source/integration-tests/run/fixtures/debug-mode.test.ts';
const crashFixture = 'source/integration-tests/run/fixtures/debug-crash.test.ts';
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
async function directory(scope: TestScope): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'overkill-debug-'));
    scope.cleanup(async function removeDebugRun() {
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
function assertCompletedDebug(scope: TestScope, result: DebugRunResult): void {
    scope.assert.deepEqual(result.runnerErrors, []);
    scope.assert.equal(result.status, 'passed');
    scope.assert.equal(result.perTest.length, 2);
    const artifacts = result.artifacts.filter(isTestDebugArtifact);
    scope.assert.equal(artifacts.length, 1);
    const [ artifact ] = artifacts;
    scope.require.defined(artifact);
    scope.assert.equal(artifact.payload.completeness, 'complete');
    scope.assert.equal(artifact.payload.stats.handleCallCount, 2);
    scope.assert.equal(
        artifact.payload.moduleLoads.some(function loaded(entry) {
            return entry.phase === 'load' && entry.specifier.startsWith('data:');
        }),
        true
    );
}
async function assertPersistedDebug(scope: TestScope, root: string): Promise<void> {
    const names = await readdir(path.join(root, 'runs'));
    const records = names.filter(function record(name) {
        return name.endsWith('.json');
    });
    scope.assert.equal(records.length, 1);
    const [ recordName ] = records;
    scope.require.defined(recordName);
    const debugDirectory = path.join(root, 'runs', recordName.slice(0, -5), 'debug');
    const files = await readdir(debugDirectory);
    scope.assert.equal(files.length, 1);
    const stored: unknown = JSON.parse(await readFile(path.join(debugDirectory, files[0] ?? ''), 'utf8'));
    scope.assert.equal(parseRunArtifacts([ stored ])[0]?.payload.kind, 'debug');
}

export const testNode = suite('debug execution boundaries', [
    ...executions.map(function boundary(execution) {
        return test(
            `retains scoped diagnostics in ${execution.processModel}${
                execution.processModel === 'worker-pool'
                    ? `/${execution.workerLifecycle}/${execution.hostProcess.kind}`
                    : ''
            }`,
            async function (scope: TestScope) {
                const root = await directory(scope);
                const result = await runFixture(execution, root, fixture);
                assertCompletedDebug(scope, result);
                await assertPersistedDebug(scope, root);
                return scope.assert.collect();
            }
        );
    }),
    test('retains partial debug evidence when a child exits abruptly', async function (scope: TestScope) {
        const root = await directory(scope);
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
await runIfMain(import.meta, testNode);
