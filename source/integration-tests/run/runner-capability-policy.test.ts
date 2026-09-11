import { rm } from 'node:fs/promises';
import {
    createSuite,
    createTestCase,
    defineOutputRenderer,
    defineReporter,
    type TestScope
} from '../../packages/engine/engine.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import type { DefinedReporter, Reporter } from '../../engine/reporter.ts';
import { runIfMain } from '../direct-launcher.test.ts';
import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import type {
    RunCommand,
    RunConfig,
    RunMicrotestProcessModel,
    RunRequest,
    RunScheduling
} from '../../run/run-types.ts';

const consolePolicyFixturePath = 'source/integration-tests/run/fixtures/console-policy.test.ts';
const envPolicyFixturePath = 'source/integration-tests/run/fixtures/env-policy.test.ts';
const fsWritePolicyFixturePath = 'source/integration-tests/run/fixtures/fs-write-policy.test.ts';
const fsWritePolicyOutputPath = 'source/integration-tests/run/fixtures/fs-write-policy-output.txt';
const integrationUnrestrictedRuntimeFixturePath =
    'source/integration-tests/run/fixtures/integration-unrestricted-runtime.test.ts';
const integrationUnrestrictedRuntimeOutputPath =
    'source/integration-tests/run/fixtures/integration-unrestricted-runtime-output.txt';
const ipcPolicyFixturePath = 'source/integration-tests/run/fixtures/ipc-policy.test.ts';
const processExitPolicyFixturePath = 'source/integration-tests/run/fixtures/process-exit-policy.test.ts';
const timerPolicyFixturePath = 'source/integration-tests/run/fixtures/timer-policy.test.ts';

type PolicyFixture = {
    readonly expectedCapability: Readonly<Record<RunMicrotestProcessModel, string>>;
    readonly name: string;
    readonly path: string;
};

const memoryReporter = defineReporter(function createMemoryReporter(): Reporter {
    return {
        dispose: null,
        kind: 'real-time',
        name: 'memory',
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: [ { kind: 'memory' } ]
    };
});

function createRunRequest(paths: readonly string[]): RunRequest {
    return {
        baselineUpdateMode: 'none',
        capabilityRestrictions: { mode: 'enabled' },
        capture: 'buffered',
        debug: { mode: 'off', selectors: [] },
        execution: { mode: 'profile-default' },
        measureResourceUsage: null,
        order: 'seeded',
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

function createIntegrationRunRequest(): RunRequest {
    return {
        ...createRunRequest([ integrationUnrestrictedRuntimeFixturePath ]),
        profile: 'integration'
    };
}

function createRunConfig(
    processModel: RunMicrotestProcessModel,
    scheduling: RunScheduling,
    reporter: DefinedReporter
): RunConfig {
    return {
        loader: { sourceMaps: false, stripMode: 'strip-only' },
        outputRenderer: defineOutputRenderer(function createOutputRenderer() {
            return {
                render() {
                    return '';
                }
            };
        }),
        profiles: {
            microtest: {
                execution: { processModel, scheduling },
                files: null,
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
                    collectionMilliseconds: 5000,
                    hardMilliseconds: 1000,
                    softMilliseconds: 500
                }
            }
        },
        reporters: [ reporter ],
        runtimeStateDir: '.overkill'
    };
}

function createIntegrationRunConfig(reporter: DefinedReporter): RunConfig {
    return {
        loader: { sourceMaps: false, stripMode: 'strip-only' },
        outputRenderer: defineOutputRenderer(function createOutputRenderer() {
            return {
                render() {
                    return '';
                }
            };
        }),
        profiles: {
            integration: {
                execution: {
                    processModel: 'supervised-process',
                    scheduling: 'concurrent'
                },
                files: {
                    exclude: [],
                    include: [ integrationUnrestrictedRuntimeFixturePath ]
                },
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
                testFamily: 'integration',
                timeouts: {
                    collectionMilliseconds: 5000,
                    hardMilliseconds: 7000,
                    softMilliseconds: 5000
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
        engine: { kind: 'default' },
        request: createRunRequest(paths)
    };
}

function deleteEnvironmentValue(name: string): void {
    const environment: unknown = Reflect.get(process, 'env');

    if (typeof environment === 'object' && environment !== null) {
        Reflect.deleteProperty(environment, name);
    }
}

async function cleanupPolicyFixture(path: string): Promise<void> {
    if (path === envPolicyFixturePath) {
        deleteEnvironmentValue('OVERKILL_CASE_POLICY_FIXTURE');
    }

    if (path === fsWritePolicyFixturePath) {
        await rm(fsWritePolicyOutputPath, { force: true });
    }
}

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    return typeof value === 'object' && value !== null;
}

function recordValue(value: unknown, key: string): unknown {
    return isRecord(value) && Object.hasOwn(value, key) ? value[key] : null;
}

function runnerErrorCapability(error: unknown): string | null {
    const capability = recordValue(recordValue(error, 'cause'), 'capability');

    return typeof capability === 'string' ? capability : null;
}

function runnerErrorCapabilities(result: Awaited<ReturnType<typeof orchestrator.run>>): readonly string[] {
    return result.runnerErrors.flatMap(function toCapability(error) {
        const capability = runnerErrorCapability(error);

        return capability === null ? [] : [ capability ];
    });
}

function capabilityCount(capabilities: readonly string[], capability: string): number {
    return capabilities
        .filter(function isCapability(candidate) {
            return candidate === capability;
        })
        .length;
}

function assertConsolidatedProcessEnvironmentErrors(
    scope: TestScope,
    fixture: PolicyFixture,
    capabilities: readonly string[],
    model: RunMicrotestProcessModel
): void {
    if (fixture.path === envPolicyFixturePath) {
        scope.assert.equal(capabilityCount(capabilities, fixture.expectedCapability[model]), 1);
    }
}

const policyFixtures: readonly PolicyFixture[] = [
    {
        expectedCapability: {
            'in-process': 'console',
            'supervised-process': 'console'
        },
        name: 'console output',
        path: consolePolicyFixturePath
    },
    {
        expectedCapability: {
            'in-process': 'process-env',
            'supervised-process': 'process-env'
        },
        name: 'process.env mutation',
        path: envPolicyFixturePath
    },
    {
        expectedCapability: {
            'in-process': 'timer',
            'supervised-process': 'timer'
        },
        name: 'timer creation',
        path: timerPolicyFixturePath
    },
    {
        expectedCapability: {
            'in-process': 'process-execute',
            'supervised-process': 'process-execute'
        },
        name: 'process execution',
        path: processExitPolicyFixturePath
    },
    {
        expectedCapability: {
            'in-process': 'child-process',
            'supervised-process': 'child-process'
        },
        name: 'ipc listener registration',
        path: ipcPolicyFixturePath
    },
    {
        expectedCapability: {
            'in-process': 'fs-read',
            'supervised-process': 'fs-write'
        },
        name: 'filesystem write',
        path: fsWritePolicyFixturePath
    }
];

const policyProcessModels: readonly {
    readonly processModel: RunMicrotestProcessModel;
    readonly scheduling: RunScheduling;
}[] = [
    {
        processModel: 'in-process',
        scheduling: 'serial'
    },
    {
        processModel: 'supervised-process',
        scheduling: 'concurrent'
    }
];

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/run/runner-capability-policy.test.ts',
    annotations: {},
    controls: {},
    children: [
        ...policyFixtures.flatMap(function createPolicyFixtureTests(fixture) {
            return policyProcessModels.map(function createPolicyFixtureProcessTest(model) {
                return createTestCase({
                    definitionLocations: [ { kind: 'unknown' } ],
                    title: `${model.processModel} microtest capability restrictions fail ${fixture.name}`,
                    annotations: {},
                    controls: {},
                    async body(scope: TestScope) {
                        const result = await orchestrator.run(createRunCommand(
                            [ fixture.path ],
                            createRunConfig(model.processModel, model.scheduling, memoryReporter)
                        ));
                        const [ testResult ] = result.perTest;
                        const capabilities = runnerErrorCapabilities(result);

                        await cleanupPolicyFixture(fixture.path);
                        scope.assert.equal(testResult?.verdict, 'runtime-policy');
                        scope.assert.equal(result.summary.runtimePolicy, 1);
                        scope.assert.equal(capabilities.includes(fixture.expectedCapability[model.processModel]), true);
                        assertConsolidatedProcessEnvironmentErrors(
                            scope,
                            fixture,
                            capabilities,
                            model.processModel
                        );

                        return scope.assert.collect();
                    }
                });
            });
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'integration profiles ignore microtest capability restrictions',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                const result = await orchestrator.run({
                    config: createIntegrationRunConfig(memoryReporter),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: createIntegrationRunRequest()
                });
                const [ testResult ] = result.perTest;

                await rm(integrationUnrestrictedRuntimeOutputPath, { force: true });
                scope.assert.equal(testResult?.verdict, 'pass');
                scope.assert.equal(result.summary.runtimePolicy, 0);
                scope.assert.equal(result.runnerErrors.length, 0);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
