import { setImmediate as scheduleImmediate } from 'node:timers';
import { runIfMain } from '#test-runner';
import {
    createChildRun,
    supervisedChildCommand,
    supervisedChildDependencies
} from '../test-support/supervised-child-fixture.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type RunnerError,
    type TestPlan,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    loadDeterministicRunTestModules
} from '../test-support/deterministic-run-fixtures.ts';
import { createVirtualRunDiscovery } from '../test-support/virtual-run-discovery.ts';
import {
    runSupervisedChild,
    type SupervisedChildHost
} from './supervised-child.ts';
import {
    createSupervisedChildTestPlan,
    runnerErrorFromSupervisedChildFailure,
    runObservedSupervisedChildCommand
} from './supervised-child-test-plan.ts';
import type {
    SupervisedAssignmentCommand,
    SupervisedChildMessage
} from './supervised-protocol.ts';

const cwd = '/project';
const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const policyFixturePath = 'source/integration-tests/run/fixtures/load-env-policy.test.ts';

function assignment(title: string): SupervisedAssignmentCommand {
    return {
        attachmentEndpoint: null,
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
        attachmentEndpoint: null,
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
        await runObservedSupervisedChildCommand(
            supervisedChildCommand('collect', 'tests/first.test.ts'),
            async function collectChildPlan() {
                emitUnhandledRejection('supervised collection failed');
                await yieldToImmediate();
            }
        );
    } catch (error: unknown) {
        return error;
    }

    throw new Error('Expected supervised child command to reject.');
}

async function createModuleEngineSupervisedPlan(): Promise<TestPlan> {
    return await createSupervisedChildTestPlan(
        {
            ...supervisedChildCommand('collect', passingFixturePath),
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
                    command: supervisedChildCommand('collect', passingFixturePath),
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
                        ...supervisedChildCommand('collect', policyFixturePath),
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
                    command: supervisedChildCommand('run', passingFixturePath),
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
                    command: supervisedChildCommand('collect', passingFixturePath),
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
                    command: supervisedChildCommand('run', passingFixturePath),
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

await runIfMain(import.meta, testNode);
