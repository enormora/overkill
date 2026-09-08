import {
    createSuite,
    createTestCase,
    defineOutputRenderer,
    defineReporter,
    type TestScope
} from '../../packages/engine/engine.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { runIfMain } from '../direct-launcher.test.ts';
import type { Reporter } from '../../engine/reporter.ts';
import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import type { RunCommand, RunConfig, RunRequest } from '../../run/run-types.ts';

const integrationFixturePath = 'source/integration-tests/run/fixtures/discovery/integration.test.ts';
const unitFixturePath = 'source/integration-tests/run/fixtures/discovery/unit.test.ts';

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

function createDefaultMicrotestProfile(): RunConfig['profiles'][string] {
    return {
        execution: {
            processModel: 'supervised-process',
            scheduling: 'concurrent'
        },
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
    };
}

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

function createRunConfig(): RunConfig {
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
                ...createDefaultMicrotestProfile(),
                files: {
                    sets: {
                        integration: {
                            exclude: [],
                            include: [ integrationFixturePath ]
                        },
                        unit: {
                            exclude: [],
                            include: [ unitFixturePath ]
                        }
                    }
                }
            }
        },
        reporters: [ memoryReporter ],
        runtimeStateDir: '.overkill'
    };
}

function createRunCommand(): RunCommand {
    return {
        config: createRunConfig(),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: createRunRequest([])
    };
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/run/runner-file-sets.test.ts',
    metadata: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'runner records profile file sets in run facts',
            metadata: {},
            async body(scope: TestScope) {
                const resolvedRun = await orchestrator.resolve(createRunCommand());

                scope.assert.deepEqual(
                    resolvedRun.facts.cases.map(function toCaseFileSet(testCase) {
                        return {
                            file: testCase.id.file,
                            fileSet: testCase.fileSet
                        };
                    }),
                    [
                        {
                            file: integrationFixturePath,
                            fileSet: 'integration'
                        },
                        {
                            file: unitFixturePath,
                            fileSet: 'unit'
                        }
                    ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
