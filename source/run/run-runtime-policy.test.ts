import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import type { RunCommand, RunConfig, RunRequest } from './run-types.ts';

type RunCommandParts = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

export const testSuite = createOverkillSuite({
    name: 'source/run/run-runtime-policy.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'orchestrator.run() supports disabled capability restrictions for in-process runs',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand({
                    config: defaultRunConfig({
                        profiles: {
                            microtest: defaultMicrotestProfile({
                                execution: { processModel: 'in-process' }
                            })
                        }
                    }),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: defaultRunRequest({
                        capabilityRestrictions: { mode: 'disabled' },
                        paths: [ passingFixturePath ]
                    })
                }));

                scope.assert.deepEqual(result.runnerErrors, []);
                scope.assert.equal(result.summary.passed, 1);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
