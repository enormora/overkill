import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { Reporter } from '../engine/reporter.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
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

type ReporterLifecycleRecorder = {
    readonly entries: () => readonly string[];
    readonly reporter: Reporter;
};

const throwsOnImportFixturePath = 'source/integration-tests/run/fixtures/throws-on-import.test.ts';
const emptySuiteFixturePath = 'source/integration-tests/run/fixtures/empty-suite.test.ts';
const defaultRequest = defaultRunRequest();
const supervisedCollectionConfig = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            timeouts: { collectionMilliseconds: 5000 }
        })
    }
});

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

function createReporterLifecycleRecorder(): ReporterLifecycleRecorder {
    const entries: string[] = [];

    return {
        entries() {
            return entries;
        },
        reporter: {
            dispose() {
                entries.push('dispose');
            },
            kind: 'real-time',
            name: 'lifecycle-recorder',
            onEvent(event) {
                entries.push(`event:${event.kind}`);
            },
            onFinish(result) {
                entries.push(`finish:${result.runnerErrors[0]?.message ?? 'none'}`);
            },
            sinks: [ { kind: 'memory' } ]
        }
    };
}

function createTerminalFinishReporter(): Reporter {
    return {
        dispose: null,
        kind: 'real-time',
        name: 'terminal-finish',
        onEvent() {
            return undefined;
        },
        onFinish() {
            return undefined;
        },
        sinks: [ { kind: 'stderr-raw' } ]
    };
}

export const testSuite = createOverkillSuite({
    title: 'source/run/run-collection-error-reporting.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'orchestrator.run() returns collection failures as runner errors',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const importFailureResult = await runOrchestrator.run(createRunCommand({
                    config: supervisedCollectionConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: {
                        ...defaultRequest,
                        paths: [ throwsOnImportFixturePath ]
                    }
                }));
                const collectionFailureResult = await runOrchestrator.run(createRunCommand({
                    config: supervisedCollectionConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: {
                        ...defaultRequest,
                        paths: [ emptySuiteFixturePath ]
                    }
                }));

                scope.assert.deepEqual(importFailureResult.summary, {
                    crashed: 0,
                    defined: 0,
                    discovered: 0,
                    failed: 0,
                    inconclusive: 0,
                    passed: 0,
                    planned: 0,
                    resourceExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });
                scope.assert.deepEqual(
                    importFailureResult.runnerErrors.map(function toRunnerError(error) {
                        return {
                            attributedTo: error.attributedTo,
                            message: error.message,
                            subtype: error.subtype
                        };
                    }),
                    [
                        {
                            attributedTo: null,
                            message: `Failed to load test module: ${throwsOnImportFixturePath}`,
                            subtype: 'loader'
                        }
                    ]
                );
                scope.assert.deepEqual(
                    collectionFailureResult.runnerErrors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'Failed to collect tests from run inputs.' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'orchestrator.run() reports collection failures before disposal',
            metadata: {},
            async body(scope: OverkillScope) {
                const lifecycle = createReporterLifecycleRecorder();
                const result = await orchestrator.run(createRunCommand({
                    config: defaultRunConfig({
                        profiles: supervisedCollectionConfig.profiles,
                        reporters: [ lifecycle.reporter ]
                    }),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: {
                        ...defaultRequest,
                        paths: [ throwsOnImportFixturePath ]
                    }
                }));

                scope.assert.deepEqual(lifecycle.entries(), [
                    'event:run-end',
                    `finish:Failed to load test module: ${throwsOnImportFixturePath}`,
                    'dispose'
                ]);
                scope.assert.equal(
                    result.runnerErrors[0]?.message,
                    `Failed to load test module: ${throwsOnImportFixturePath}`
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'orchestrator.runWithReporterDelivery() tracks terminal collection-error delivery',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await orchestrator.runWithReporterDelivery(createRunCommand({
                    config: defaultRunConfig({
                        profiles: supervisedCollectionConfig.profiles,
                        reporters: [ createTerminalFinishReporter() ]
                    }),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: {
                        ...defaultRequest,
                        paths: [ throwsOnImportFixturePath ]
                    }
                }));

                scope.assert.equal(result.deliveredRunnerErrors[0], result.result.runnerErrors[0]);
                scope.assert.equal(
                    result.deliveredRunnerErrors[0]?.message,
                    `Failed to load test module: ${throwsOnImportFixturePath}`
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
