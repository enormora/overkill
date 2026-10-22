import { createRoot, createTestCase, createTestPlan, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { createAsyncLeakMonitor } from '../engine/async-leak-diagnostics.ts';
import { createDeterministicRunCoordinator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultMicrotestProfile, defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';

export const testNode = createTestCase({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'nested direct collection does not leave a test-owned watchdog promise',
    async body(scope: TestScope) {
        const node = createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'different',
            body(innerScope) {
                return innerScope.assert.collect();
            }
        });
        const [ testCase ] = createTestPlan(createRoot({
            annotations: {},
            children: [ node ],
            controls: {},
            title: 'nested runner'
        }))
            .cases;
        const monitor = createAsyncLeakMonitor();
        scope.cleanup(monitor.stop);
        const delivery = await monitor.runCase(testCase, async function collectNestedEntrypoint() {
            return await createDeterministicRunCoordinator().runDirectEntrypoint({
                config: defaultRunConfig({ profiles: { microtest: defaultMicrotestProfile() } }),
                cwd: process.cwd(),
                engine: { kind: 'default' },
                request: defaultRunRequest({ paths: [ 'source/integration-tests/run/fixtures/passing.test.ts' ] })
            }, {
                kind: 'direct-entrypoint',
                root: { annotations: {}, controls: {}, title: '/project' },
                testNode: node
            });
        });
        const [ error ] = delivery.result.runnerErrors;
        scope.require.defined(error);
        scope.assert.match(error.message, /runIfMain\(\) argument does not match/u);
        scope.assert.equal(monitor.casePromiseLeakError(testCase), null);
        return scope.assert.collect();
    }
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode);
