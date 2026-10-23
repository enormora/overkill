import { runIfMain } from '#test-runner';
import {
    createSuite,
    createTestCase,
    defineReporter,
    type DefinedReporter,
    type TestScope
} from '../../packages/engine/engine.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import {
    normalizeConfig,
    orchestrator,
    type RunCommand,
    type RunOrchestrator
} from '../../packages/run/run.entry-point.ts';
import { createCurrentProcessRunOrchestrator } from '../../run/current-process-run-orchestrator.ts';
import { defaultRunEngine } from '../../run/default-run-engine.ts';
import { loadRunEngineModule, loadRunTestModules, runDiscovery } from '../../run/node-run-dependencies.entry-point.ts';
import { startSupervisedChild, startWorkerPoolHost } from '../../run/node-child-process-starters.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const passing = 'source/integration-tests/run/fixtures/passing.test.ts';
const wedged = 'source/integration-tests/run/fixtures/cancellation-cases.test.ts';

function command(
    file: string,
    processModel: 'in-process' | 'supervised-process',
    reporters: readonly DefinedReporter[]
): RunCommand {
    return {
        config: {
            ...normalizeConfig({
                runtimeStateDir: 'target/mutation-cancellation-state',
                profiles: {
                    microtest: {
                        testFamily: 'microtest',
                        execution: { processModel, scheduling: 'serial' },
                        timeouts: { collectionMilliseconds: 10_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
                    }
                }
            }),
            reporters
        },
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ paths: [ file ], order: 'plan' })
    };
}

function observedRunner(record: (pid: number) => void): RunOrchestrator {
    return createCurrentProcessRunOrchestrator(defaultRunEngine, {
        discoverRunFilesWithProjectRoot: runDiscovery.discoverRunFilesWithProjectRoot,
        loadRunEngineModule,
        loadRunTestModules,
        startWorkerPoolHost,
        async startSupervisedChild(options) {
            const child = await startSupervisedChild(options);
            if (child.pid === undefined) {
                throw new Error('Supervised child has no process identity.');
            }
            record(child.pid);
            return child;
        }
    });
}

function assertReaped(scope: TestScope, processIds: readonly number[]): void {
    scope.assert.equal(processIds.length, 1);
    for (const pid of processIds) {
        scope.assert.notEqual(pid, process.pid);
        scope.assert.throws(function probeChild() {
            process.kill(pid, 0);
        }, { code: 'ESRCH' });
    }
}

export const testNode = createSuite({
    ...metadata,
    title: 'public supervised cancellation',
    children: [
        createTestCase({
            ...metadata,
            title: 'pre-aborted invocation starts no child and collects no tests',
            async body(scope) {
                const controller = new AbortController();
                controller.abort();
                const processIds: number[] = [];
                const runner = observedRunner(function record(pid) {
                    processIds.push(pid);
                });
                const result = await runner.run(command('missing.test.ts', 'supervised-process', []), {
                    timing: null,
                    signal: controller.signal
                });
                scope.assert.deepEqual(processIds, []);
                scope.assert.deepEqual({
                    status: result.status,
                    subtype: result.runnerErrors[0]?.subtype,
                    attribution: result.runnerErrors[0]?.attributedTo,
                    executed: result.perTest.length
                }, { status: 'failed', subtype: 'crash', attribution: null, executed: 0 });
                scope.assert.match(result.runnerErrors[0]?.message ?? '', /cancelled/u);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'abort racing with child startup kills and reaps the new child',
            async body(scope) {
                const controller = new AbortController();
                const processIds: number[] = [];
                const runner = observedRunner(function abortSpawn(pid) {
                    processIds.push(pid);
                    controller.abort();
                });
                const result = await runner.run(command(passing, 'supervised-process', []), {
                    timing: null,
                    signal: controller.signal
                });
                assertReaped(scope, processIds);
                scope.assert.equal(result.status, 'failed');
                scope.assert.match(result.runnerErrors[0]?.message ?? '', /cancelled/u);
                scope.assert.equal(result.summary.passed, 0);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'cancellation reaps a synchronous loop and preserves the earlier failure',
            async body(scope) {
                const controller = new AbortController();
                const processIds: number[] = [];
                const reporter = defineReporter(function observeWedgedCase() {
                    return {
                        name: 'cancel-wedged-case',
                        kind: 'real-time',
                        sinks: [],
                        dispose: null,
                        onFinish: null,
                        onEvent(event) {
                            if (event.kind === 'test-start' && event.case.title === 'wedged case') {
                                controller.abort();
                            }
                        }
                    };
                });
                const runner = observedRunner(function record(pid) {
                    processIds.push(pid);
                });
                const delivery = await runner.runWithReporterDelivery(
                    command(wedged, 'supervised-process', [ reporter ]),
                    { timing: null, signal: controller.signal }
                );
                const { result } = delivery;
                assertReaped(scope, processIds);
                scope.assert.deepEqual({
                    status: result.status,
                    failures: result.summary.failed,
                    crashes: result.summary.crashed,
                    executed: result.perTest.map(function executedCase(testCase) {
                        return testCase.id.title;
                    })
                }, { status: 'failed', failures: 1, crashes: 1, executed: [ 'earlier failure', 'wedged case' ] });
                scope.assert.true(result.runnerErrors.some(function cancellation(error) {
                    return error.subtype === 'crash' && error.attributedTo === null &&
                        error.message.includes('cancelled');
                }));
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'in-process cancellation is rejected before a missing module is discovered',
            async body(scope) {
                const controller = new AbortController();
                await scope.assert.rejects(async function rejectUnsupportedCancellation() {
                    return await orchestrator.run(command('missing.test.ts', 'in-process', []), {
                        timing: null,
                        signal: controller.signal
                    });
                }, { message: /cancellation requires a supervised-process/u });
                const passed = await orchestrator.run(command(passing, 'supervised-process', []), {
                    timing: null,
                    signal: controller.signal
                });
                controller.abort();
                scope.assert.equal(passed.status, 'passed');
                const legacyResult = await orchestrator.run(command(passing, 'supervised-process', []), {
                    timing: null
                });
                scope.assert.equal(legacyResult.status, 'passed');
                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
