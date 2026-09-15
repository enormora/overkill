import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    defaultIntegrationProfile,
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import type { RunCommand } from './run-types.ts';
import {
    createSupervisedCollectCommand,
    createWorkerPoolCommand
} from './run-isolated-command.ts';

const integrationPath = 'source/integration-tests/run/fixtures/passing.test.ts';
const secondIntegrationPath = 'source/integration-tests/run/fixtures/delayed-pass.test.ts';

type RunProfileConfig = RunCommand['config']['profiles'][string];
type DiscoveredFile = {
    readonly file: string;
    readonly fileSet: string | null;
    readonly href: string;
    readonly path: string;
};
type DiscoveredFiles = readonly [DiscoveredFile, ...readonly DiscoveredFile[]];

function createRunCommand(profile: RunProfileConfig): RunCommand {
    return {
        config: defaultRunConfig({
            profiles: {
                integration: profile,
                microtest: defaultMicrotestProfile()
            }
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            capture: 'live',
            paths: [ integrationPath ],
            profile: 'integration',
            resourceBudgetOverrides: {
                activeResourceCount: 7,
                javaScriptEngineHeapBytes: null,
                residentSetBytes: null,
                residentSetGrowthBytesPerSecond: null
            },
            measureResourceUsage: true,
            resourceUsageSamplingIntervalMilliseconds: 13
        })
    };
}

function discoveredFiles(): DiscoveredFiles {
    return [
        { file: integrationPath, fileSet: null, href: 'virtual:first', path: integrationPath },
        { file: secondIntegrationPath, fileSet: 'slow', href: 'virtual:second', path: secondIntegrationPath }
    ];
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-command-planning.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'isolated command builders map integration profiles to worker commands',
            body(scope: OverkillScope) {
                const profile = defaultIntegrationProfile({
                    execution: { processModel: 'worker-pool', scheduling: 'serial' },
                    files: { exclude: [], include: [ integrationPath ] },
                    timeouts: { collectionMilliseconds: 17, hardMilliseconds: 23, softMilliseconds: 19 }
                });
                const command = createRunCommand(profile);

                scope.assert.deepEqual(
                    createSupervisedCollectCommand(command, profile, discoveredFiles()).capabilityRestrictions,
                    { mode: 'disabled' }
                );
                scope.assert.deepEqual(createWorkerPoolCommand(command, profile, discoveredFiles()).paths, [
                    integrationPath,
                    secondIntegrationPath
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
