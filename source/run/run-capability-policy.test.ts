import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { RunnerError } from '../engine/run-result.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { orchestrator } from './run-orchestrator.entry-point.ts';
import type { RunCommand, RunConfig, RunRequest } from './run-types.ts';

type RunCommandParts = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

const loadEnvPolicyFixturePath = 'source/integration-tests/run/fixtures/load-env-policy.test.ts';

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

function deleteEnvironmentValue(name: string): void {
    const environment: unknown = Reflect.get(process, 'env');

    if (typeof environment === 'object' && environment !== null) {
        Reflect.deleteProperty(environment, name);
    }
}

function runnerErrorPhase(runnerError: RunnerError | undefined): unknown {
    const cause = runnerError?.cause;

    return typeof cause === 'object' && cause !== null && Object.hasOwn(cause, 'phase')
        ? Reflect.get(cause, 'phase')
        : null;
}

function runnerErrorMessageIncludes(runnerError: RunnerError | undefined, text: string): boolean {
    return String(runnerError?.message).includes(text);
}

export const testSuite = createOverkillSuite({
    name: 'source/run/run-capability-policy.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'orchestrator.run() reports load-time capability restrictions outside a test case',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await orchestrator.run(createRunCommand({
                    config: defaultRunConfig({
                        profiles: {
                            microtest: defaultMicrotestProfile({
                                execution: {
                                    processModel: 'in-process',
                                    scheduling: 'serial'
                                }
                            })
                        }
                    }),
                    cwd: process.cwd(),
                    engine: null,
                    request: defaultRunRequest({ paths: [ loadEnvPolicyFixturePath ] })
                }));
                const [ runnerError ] = result.runnerErrors;

                deleteEnvironmentValue('OVERKILL_LOAD_POLICY_FIXTURE');
                scope.assert.equal(result.perTest[0]?.verdict, 'pass');
                scope.assert.equal(runnerError?.subtype, 'runtime-policy');
                scope.assert.equal(runnerError?.attributedTo, null);
                scope.assert.equal(runnerErrorPhase(runnerError), 'load');
                scope.assert.equal(runnerErrorMessageIncludes(runnerError, 'process.env'), true);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
