import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { DefinedReporter } from '../engine/reporter.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defineFixedReporter } from '../test-support/reporter-definition.ts';
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

function createTerminalReporter(name: string): DefinedReporter {
    return defineFixedReporter({
        dispose: null,
        kind: 'real-time',
        name,
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: [ { kind: 'stdout-raw' } ]
    });
}

function runConfigWithReporters(
    globalReporter: DefinedReporter,
    profileReporters: readonly DefinedReporter[] | null
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

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-reporter-resolution.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() uses profile reporters over global fallback',
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() uses global reporters when profile reporters are absent',
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() ignores inactive global reporter sink conflicts',
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

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
