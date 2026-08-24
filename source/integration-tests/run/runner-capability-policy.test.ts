import { createLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite,
    createTestCase,
    runIfMain,
    type TestScope
} from '@overkill-dev/engine';
import type { Reporter } from '../../engine/reporter.ts';
import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import type { RunCommand, RunConfig, RunProcessModel, RunRequest, RunScheduling } from '../../run/run-types.ts';

const fsWritePolicyFixturePath = 'source/integration-tests/run/fixtures/fs-write-policy.test.ts';
const timerPolicyFixturePath = 'source/integration-tests/run/fixtures/timer-policy.test.ts';

const memoryReporter: Reporter = {
    dispose: null,
    kind: 'real-time',
    name: 'memory',
    onEvent() {
        return undefined;
    },
    onFinish: null,
    sinks: [ { kind: 'memory' } ]
};

function createRunRequest(paths: readonly string[]): RunRequest {
    return {
        baselineUpdateMode: 'none',
        capabilityRestrictions: { mode: 'enabled' },
        capture: 'buffered',
        debug: { mode: 'off', selectors: [] },
        execution: { mode: 'profile-default' },
        measureResourceUsage: null,
        order: 'plan',
        paths,
        profile: 'microtest',
        resourceBudgetOverrides: null,
        resourceUsageSamplingIntervalMilliseconds: null,
        seed: { value: 42n },
        selection: { kind: 'all' },
        shard: { index: 0, total: 1 },
        verbose: false
    };
}

function createRunConfig(processModel: RunProcessModel, scheduling: RunScheduling, reporter: Reporter): RunConfig {
    return {
        loader: { sourceMaps: false, stripMode: 'strip-only' },
        outputRenderer: {
            render() {
                return '';
            }
        },
        profiles: {
            microtest: {
                execution: { processModel, scheduling },
                reporters: null,
                resourceUsage: {
                    budgets: {
                        activeResourceCount: null,
                        javaScriptEngineHeapBytes: null,
                        residentSetBytes: null,
                        residentSetGrowthBytesPerSecond: null
                    },
                    measure: false,
                    samplingIntervalMilliseconds: 100
                },
                testFamily: 'microtest',
                timeouts: {
                    hardMilliseconds: 1000,
                    softMilliseconds: 500
                }
            }
        },
        reporters: [ reporter ],
        runtimeStateDir: '.overkill'
    };
}

function createRunCommand(paths: readonly string[], config: RunConfig): RunCommand {
    return {
        config,
        cwd: process.cwd(),
        engine: null,
        request: createRunRequest(paths)
    };
}

export const testSuite = createSuite({
    name: 'source/integration-tests/run/runner-capability-policy.test.ts',
    metadata: {},
    children: [
        createTestCase({
            name: 'supervised microtest capability restrictions block filesystem writes',
            metadata: {},
            async body(scope: TestScope) {
                const result = await orchestrator.run(createRunCommand(
                    [ fsWritePolicyFixturePath ],
                    createRunConfig('supervised-process', 'concurrent', memoryReporter)
                ));
                const [ testResult ] = result.perTest;
                const [ runnerError ] = result.runnerErrors;

                scope.assert.equal(testResult?.verdict, 'runtime-policy');
                scope.assert.equal(result.summary.runtimePolicy, 1);
                scope.assert.equal(runnerError?.subtype, 'runtime-policy');
                scope.assert.equal(String(runnerError?.message).includes('fs-write'), true);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'in-process microtest capability restrictions fail timer creation',
            metadata: {},
            async body(scope: TestScope) {
                const result = await orchestrator.run(createRunCommand(
                    [ timerPolicyFixturePath ],
                    createRunConfig('in-process', 'serial', memoryReporter)
                ));
                const [ testResult ] = result.perTest;
                const [ runnerError ] = result.runnerErrors;

                scope.assert.equal(testResult?.verdict, 'runtime-policy');
                scope.assert.equal(result.summary.runtimePolicy, 1);
                scope.assert.equal(runnerError?.subtype, 'runtime-policy');
                scope.assert.equal(String(runnerError?.message).includes('timer'), true);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createLineReporter() ] });
