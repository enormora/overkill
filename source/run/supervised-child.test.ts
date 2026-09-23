import { setImmediate as scheduleImmediate } from 'node:timers';
import { createDeterministicOverkillClock } from '../clock/overkill-clock.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type RunnerError,
    type RunResourceUsageTracker,
    type TestPlan,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    loadDeterministicRunTestModules
} from '../test-support/deterministic-run-fixtures.ts';
import { createVirtualRunDiscovery } from '../test-support/virtual-run-discovery.ts';
import {
    runSupervisedChild,
    type SupervisedChildDependencies,
    type SupervisedChildHost
} from './supervised-child.ts';
import {
    createSupervisedChildTestPlan,
    runnerErrorFromSupervisedChildFailure,
    runObservedSupervisedChildCommand
} from './supervised-child-test-plan.ts';
import type {
    SupervisedAssignmentCommand,
    SupervisedChildCommand,
    SupervisedChildMessage
} from './supervised-protocol.ts';

const cwd = '/project';
const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const policyFixturePath = 'source/integration-tests/run/fixtures/load-env-policy.test.ts';

type ChildRunRecord = {
    readonly disconnected: () => boolean;
    readonly exitCode: () => number | null;
    readonly messages: () => readonly SupervisedChildMessage[];
};

type ChildHostInput = {
    readonly assignment: SupervisedAssignmentCommand;
    readonly command: SupervisedChildCommand;
    readonly discoverRunFiles: SupervisedChildHost['discoverRunFiles'];
    readonly loadRunTestModules: SupervisedChildHost['loadRunTestModules'];
    readonly readEnvironment: SupervisedChildHost['readEnvironment'];
};

function installNoPolicyRestriction(): () => void {
    return function restoreNoPolicyRestriction(): void {
        return undefined;
    };
}

function createEmptyResourceUsageTracker(): RunResourceUsageTracker {
    return {
        finish() {
            throw new Error('Supervised child test does not finish resource usage tracking.');
        },
        start() {
            return undefined;
        }
    };
}

function supervisedChildDependencies(): SupervisedChildDependencies {
    return {
        createResourceUsageTracker: createEmptyResourceUsageTracker,
        createOverkillClock: createDeterministicOverkillClock
    };
}

function command(kind: SupervisedChildCommand['kind'], path: string): SupervisedChildCommand {
    return {
        capabilityRestrictions: { mode: 'disabled' },
        capture: 'buffered',
        collectionTimeoutMilliseconds: 1000,
        cwd,
        definitionLocationCapture: 'enabled',
        engine: { kind: 'default' },
        hardTimeoutMilliseconds: 2000,
        kind,
        paths: [ path ],
        resourceBudgets: {
            activeResourceCount: null,
            javaScriptEngineHeapBytes: null,
            residentSetBytes: null,
            residentSetGrowthBytesPerSecond: null
        },
        resourceUsageSamplingIntervalMilliseconds: 10,
        scheduling: 'concurrent',
        testFamily: 'microtest',
        timeoutMilliseconds: 1000
    };
}

function assignment(title: string): SupervisedAssignmentCommand {
    return {
        assignedCases: [
            {
                file: passingFixturePath,
                params: null,
                suite: [ 'fixture' ],
                title
            }
        ],
        kind: 'assign'
    };
}

function emptyAssignment(): SupervisedAssignmentCommand {
    return {
        assignedCases: [],
        kind: 'assign'
    };
}

function createDiscovery(files: readonly string[]): SupervisedChildHost['discoverRunFiles'] {
    const discovery = createVirtualRunDiscovery({
        cwd,
        directories: [],
        files,
        realpaths: {}
    });

    return discovery.discoverRunFiles;
}

type ChildRunFixture = ChildRunRecord & {
    readonly host: SupervisedChildHost;
};

function createChildRun(input: ChildHostInput): ChildRunFixture {
    const messages: SupervisedChildMessage[] = [];
    let disconnected = false;
    let exitCode: number | null = null;

    return {
        disconnected() {
            return disconnected;
        },
        exitCode() {
            return exitCode;
        },
        host: {
            disconnect() {
                disconnected = true;
            },
            discoverRunFiles: input.discoverRunFiles,
            dropBodyReadPermission() {
                return undefined;
            },
            installIpcRestriction: installNoPolicyRestriction,
            installProcessExecutionRestriction: installNoPolicyRestriction,
            async loadRunEngineModule() {
                throw new Error('Supervised child test does not load engine modules.');
            },
            loadRunTestModules: input.loadRunTestModules,
            readEnvironment: input.readEnvironment,
            readStorage() {
                return null;
            },
            async receiveAssignment() {
                return input.assignment;
            },
            async receiveCommand() {
                return input.command;
            },
            send(message) {
                messages.push(message);
            },
            setExitCode(code) {
                exitCode = code;
            },
            validatePermissionHost() {
                return undefined;
            }
        },
        messages() {
            return messages;
        }
    };
}

function runnerErrorsFromCollectedMessage(messages: readonly SupervisedChildMessage[]): readonly RunnerError[] {
    const collected = messages.find(function isCollectedMessage(message) {
        return message.kind === 'collected';
    });

    return collected?.kind === 'collected' ? collected.runnerErrors : [];
}

function firstRunnerErrorMessage(messages: readonly SupervisedChildMessage[]): string | null {
    const event = messages.find(function isRunnerErrorEvent(message) {
        return message.kind === 'event' && message.event.kind === 'runner-error';
    });

    return event?.kind === 'event' && event.event.kind === 'runner-error'
        ? event.event.error.message
        : null;
}

async function yieldToImmediate(): Promise<void> {
    await new Promise<void>(function resolveOnImmediate(resolve) {
        scheduleImmediate(resolve);
    });
}

function emitUnhandledRejection(message: string): void {
    process.emit('unhandledRejection', new Error(message), Promise.resolve());
}

async function collectObservedSupervisedFailure(): Promise<unknown> {
    try {
        await runObservedSupervisedChildCommand(async function collectChildPlan() {
            emitUnhandledRejection('supervised collection failed');
            await yieldToImmediate();
        });
    } catch (error: unknown) {
        return error;
    }

    throw new Error('Expected supervised child command to reject.');
}

async function createModuleEngineSupervisedPlan(): Promise<TestPlan> {
    return await createSupervisedChildTestPlan(
        {
            ...command('collect', passingFixturePath),
            engine: {
                exportKind: 'value',
                exportName: 'engine',
                kind: 'module',
                moduleUrl: 'file:///engine.ts'
            }
        },
        {
            discoverRunFiles: createDiscovery([ passingFixturePath ]),
            async loadRunEngineModule() {
                const { defaultRunEngine } = await import('./default-run-engine.ts');

                return defaultRunEngine;
            },
            loadRunTestModules: loadDeterministicRunTestModules
        }
    );
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-child.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runSupervisedChild() collects tests without waiting for assignments',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const childRun = createChildRun({
                    assignment: emptyAssignment(),
                    command: command('collect', passingFixturePath),
                    discoverRunFiles: createDiscovery([ passingFixturePath ]),
                    loadRunTestModules: loadDeterministicRunTestModules,
                    readEnvironment() {
                        return {};
                    }
                });

                await runSupervisedChild(childRun.host, supervisedChildDependencies());

                scope.assert.equal(childRun.exitCode(), 0);
                scope.assert.equal(childRun.disconnected(), true);
                scope.assert.deepEqual(
                    childRun.messages().map(function toKind(message) {
                        return message.kind;
                    }),
                    [ 'collected' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runSupervisedChild() records restricted load-time environment changes',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const environment: Record<string, string | undefined> = {};
                const childRun = createChildRun({
                    assignment: emptyAssignment(),
                    command: {
                        ...command('collect', policyFixturePath),
                        capabilityRestrictions: { mode: 'enabled' }
                    },
                    discoverRunFiles: createDiscovery([ policyFixturePath ]),
                    async loadRunTestModules(files, engine) {
                        environment.OVERKILL_LOAD_POLICY_FIXTURE = 'after';

                        return await loadDeterministicRunTestModules(files, engine);
                    },
                    readEnvironment() {
                        return environment;
                    }
                });

                await runSupervisedChild(childRun.host, supervisedChildDependencies());

                const [ error ] = runnerErrorsFromCollectedMessage(childRun.messages());
                scope.require.defined(error);
                scope.assert.equal(error.subtype, 'runtime-policy');
                scope.assert.equal(error.message, 'Runtime policy violation: process.env changed.');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runSupervisedChild() returns an empty result for empty assignments',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const childRun = createChildRun({
                    assignment: emptyAssignment(),
                    command: command('run', passingFixturePath),
                    discoverRunFiles: createDiscovery([ passingFixturePath ]),
                    loadRunTestModules: loadDeterministicRunTestModules,
                    readEnvironment() {
                        return {};
                    }
                });

                await runSupervisedChild(childRun.host, supervisedChildDependencies());

                const result = childRun.messages().find(function isRunResult(message) {
                    return message.kind === 'result';
                });

                scope.require.defined(result);
                scope.assert.equal(result.kind, 'result');
                scope.assert.equal(result.result.summary.planned, 0);
                scope.assert.equal(result.result.summary.discovered, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runSupervisedChild() reports collection failures',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const childRun = createChildRun({
                    assignment: assignment('passes'),
                    command: command('collect', passingFixturePath),
                    async discoverRunFiles() {
                        throw new Error('plain failure');
                    },
                    loadRunTestModules: loadDeterministicRunTestModules,
                    readEnvironment() {
                        return {};
                    }
                });

                await runSupervisedChild(childRun.host, supervisedChildDependencies());

                scope.assert.equal(childRun.exitCode(), 1);
                scope.assert.equal(firstRunnerErrorMessage(childRun.messages()), 'plain failure');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runObservedSupervisedChildCommand() surfaces global hook failures',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const observedError = await collectObservedSupervisedFailure();
                const runnerError = runnerErrorFromSupervisedChildFailure(observedError);

                scope.assert.equal(runnerError.subtype, 'unhandled-rejection');
                scope.assert.equal(runnerError.message, 'Unhandled rejection: supervised collection failed');
                scope.assert.equal(runnerErrorFromSupervisedChildFailure('plain').message, 'plain');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSupervisedChildTestPlan() loads module engines',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const testPlan = await createModuleEngineSupervisedPlan();
                const [ firstCase ] = testPlan.cases;

                scope.require.defined(firstCase);
                scope.assert.equal(testPlan.cases.length, 1);
                scope.assert.equal(firstCase.id.title, 'passes');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runSupervisedChild() reports assignment mismatches as loader errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const childRun = createChildRun({
                    assignment: assignment('missing-case'),
                    command: command('run', passingFixturePath),
                    discoverRunFiles: createDiscovery([ passingFixturePath ]),
                    loadRunTestModules: loadDeterministicRunTestModules,
                    readEnvironment() {
                        return {};
                    }
                });

                await runSupervisedChild(childRun.host, supervisedChildDependencies());

                scope.assert.equal(childRun.exitCode(), 1);
                scope.assert.equal(
                    firstRunnerErrorMessage(childRun.messages()),
                    'Supervised child test plan did not match assigned work identities.'
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
