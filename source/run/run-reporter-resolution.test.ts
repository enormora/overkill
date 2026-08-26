import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { Reporter } from '../engine/reporter.ts';
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
const defaultRequest = defaultRunRequest({ paths: [ passingFixturePath ] });

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

function createTerminalReporter(name: string): Reporter {
    return {
        dispose: null,
        kind: 'real-time',
        name,
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: [ { kind: 'stdout-raw' } ]
    };
}

function runConfigWithReporters(
    globalReporter: Reporter,
    profileReporters: readonly Reporter[] | null
): RunConfig {
    return defaultRunConfig({
        profiles: {
            microtest: defaultMicrotestProfile({
                execution: { processModel: 'in-process' },
                reporters: profileReporters
            })
        },
        reporters: [ globalReporter ]
    });
}

export const testSuite = createOverkillSuite({
    name: 'source/run/run-reporter-resolution.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'orchestrator.resolve() uses profile reporters over global fallback',
            metadata: {},
            async body(scope: OverkillScope) {
                const globalReporter = createTerminalReporter('global');
                const profileReporter = createTerminalReporter('profile');
                const runOrchestrator = createDeterministicRunOrchestrator();
                const resolvedRun = await runOrchestrator.resolve(createRunCommand({
                    config: runConfigWithReporters(globalReporter, [ profileReporter ]),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: defaultRequest
                }));

                scope.assert.deepEqual(resolvedRun.reporters, [ profileReporter ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() uses global reporters when profile reporters are absent',
            metadata: {},
            async body(scope: OverkillScope) {
                const globalReporter = createTerminalReporter('global');
                const runOrchestrator = createDeterministicRunOrchestrator();
                const resolvedRun = await runOrchestrator.resolve(createRunCommand({
                    config: runConfigWithReporters(globalReporter, null),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: defaultRequest
                }));

                scope.assert.deepEqual(resolvedRun.reporters, [ globalReporter ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() ignores inactive global reporter sink conflicts',
            metadata: {},
            async body(scope: OverkillScope) {
                const globalReporter = createTerminalReporter('global');
                const profileReporter = createTerminalReporter('profile');
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand({
                    config: runConfigWithReporters(globalReporter, [ profileReporter ]),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: defaultRequest
                }));

                scope.assert.deepEqual(result.runnerErrors, []);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
