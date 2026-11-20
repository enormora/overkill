import { type TestNode, suite, test } from '@overkill-dev/test';

import type { DefinedReporter } from '../engine/reporter.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defineFixedReporter } from '../test-support/reporter-definition.ts';
import { defaultMicrotestProfile, defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';
import type { NormalizedConfig } from '../config/types.ts';
import type { RunCommand, RunRequest } from './run-types.ts';

type RunCommandParts = {
    readonly config: NormalizedConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

const passingFixturePath = 'source/integration-tests/integration/fixtures/passing.test.ts';
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
): NormalizedConfig {
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

export const testNode: TestNode = suite('Run reporter resolution', [
    test('orchestrator.resolve() uses profile reporters over global fallback', async function (scope) {
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
    }),
    test(
        'orchestrator.resolve() uses global reporters when profile reporters are absent',
        async function (scope) {
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
    ),
    test('orchestrator.run() ignores inactive global reporter sink conflicts', async function (scope) {
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
    })
]);
