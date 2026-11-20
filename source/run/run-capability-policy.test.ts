import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';
import diagnosticsChannel from 'node:diagnostics_channel';

import type { NormalizedConfig, RunCommand, RunRequest } from '../packages/run/run.entry-point.ts';
import { defineReporter, type RunnerError } from '../packages/engine/engine.entry-point.ts';
import { createUnitRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultMicrotestProfile, defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';
import { createDefaultWorkId } from '../engine/identity.ts';
import { createPermissionDenialRuntimePolicy } from './permission-denial-runtime-policy.ts';
import { createRuntimeCapabilityPolicy, type RuntimeCapabilityPolicy } from './capability-policy.ts';
import type { RuntimeCapabilityPolicyEnvironment, WebStorageLike } from './capability-policy-snapshots.ts';

type RunCommandParts = {
    readonly config: NormalizedConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};
type PolicyTestCase = Parameters<RuntimeCapabilityPolicy['runAttempt']>[0];
type ExpectedPermissionDiagnosticError = {
    readonly capability: string;
    readonly message: string | null;
    readonly permission: string;
    readonly resource: string;
};
type PermissionDiagnosticChannel = { readonly publish: (message: unknown) => void; };

const loadEnvPolicyFixturePath = 'source/integration-tests/integration/fixtures/load-env-policy.test.ts';
const passingFixturePath = 'source/integration-tests/integration/fixtures/passing.test.ts';
const policyAnnotations: PolicyTestCase['annotations'] = {
    ownership: [],
    tags: []
};
const policyControls: PolicyTestCase['controls'] = {
    capture: null,
    duplicateExecution: null,
    timeoutMilliseconds: null
};
const policyTestCase: PolicyTestCase = {
    bodyOrigin: null,
    workloadParameters: null,
    annotations: policyAnnotations,
    controls: policyControls,
    execution: {
        body: async function unusedPolicyTestBody() {
            throw new Error('Policy test body should not run.');
        },
        bodyMode: 'builder',
        kind: 'body'
    },
    definitionLocations: [ { kind: 'unknown' as const } ],
    id: {
        file: 'source/run/run-capability-policy.test.ts',
        title: 'policy case',
        params: null,
        suite: [ 'runtime policy' ]
    },
    resourceAttachments: {
        directResources: [],
        resourceGraph: [],
        runtimeGraphs: []
    },
    suitePath: [
        { definitionLocations: [ { kind: 'unknown' as const } ], title: 'runtime policy' }
    ],
    testFamily: null,
    workId: createDefaultWorkId({
        file: 'source/run/run-capability-policy.test.ts',
        title: 'policy case',
        params: null,
        suite: [ 'runtime policy' ]
    })
};

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

function firstRunnerError(errors: readonly RunnerError[]): RunnerError {
    const [ error ] = errors;

    if (error === undefined) {
        throw new Error('Expected a runner error.');
    }

    return error;
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

function errorCapability(error: RunnerError): string | null {
    const { cause } = error;

    if (typeof cause === 'object' && cause !== null && Object.hasOwn(cause, 'capability')) {
        return String(Reflect.get(cause, 'capability'));
    }

    return null;
}

function errorStringField(error: RunnerError, field: string): string | null {
    const { cause } = error;

    if (typeof cause === 'object' && cause !== null && Object.hasOwn(cause, field)) {
        const causeFields = cause as Readonly<Record<string, unknown>>;
        const value = causeFields[field];

        return typeof value === 'string' ? value : null;
    }

    return null;
}

function errorStrictness(error: RunnerError): string | null {
    const { cause } = error;

    if (typeof cause === 'object' && cause !== null && Object.hasOwn(cause, 'strictness')) {
        return String(Reflect.get(cause, 'strictness'));
    }

    return null;
}

function compareNullableStrings(first: string | null, second: string | null): number {
    return String(first).localeCompare(String(second));
}

function errorCapabilityAndStrictness(error: RunnerError): readonly [string | null, string | null] {
    return [ errorCapability(error), errorStrictness(error) ];
}

function assertPermissionDiagnosticError(
    scope: TestScope,
    error: RunnerError,
    expected: ExpectedPermissionDiagnosticError
): void {
    scope.assert.equal(error.subtype, 'permission');
    scope.assert.equal(errorCapability(error), expected.capability);
    scope.assert.equal(errorStringField(error, 'permission'), expected.permission);
    scope.assert.equal(errorStringField(error, 'resource'), expected.resource);
    scope.assert.equal(errorStringField(error, 'source'), 'diagnostic-channel');
    if (expected.message !== null) {
        scope.assert.equal(error.message, expected.message);
    }
}

function createStorage(values: ReadonlyMap<string, string>): WebStorageLike {
    return {
        get length() {
            return values.size;
        },
        getItem(key) {
            return values.get(key) ?? null;
        },
        key(index) {
            return Array.from(values.keys())[index] ?? null;
        }
    };
}

function installNoPolicyRestriction(): () => void {
    return function restoreNoPolicyRestriction(): void {
        return undefined;
    };
}

async function readPermissionDiagnosticChannel(): Promise<PermissionDiagnosticChannel> {
    return diagnosticsChannel.channel('node:permission-model:fs');
}

function publishPermissionDiagnostic(
    channel: PermissionDiagnosticChannel,
    permission: string,
    resource: string
): void {
    channel.publish({ permission, resource });
}

function createSparseStorage(): WebStorageLike {
    return {
        length: 2,
        getItem() {
            return null;
        },
        key(index) {
            return index === 0 ? null : 'missing';
        }
    };
}

export const testNode: TestNode = suite('Run capability policy', [
    test(
        'orchestrator.run() reports load-time capability restrictions outside a test case',
        async function (scope) {
            const runOrchestrator = createUnitRunOrchestrator();
            const result = await runOrchestrator.run(createRunCommand({
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
                engine: { kind: 'default' },
                request: defaultRunRequest({ paths: [ loadEnvPolicyFixturePath ] })
            }));
            const [ runnerError ] = result.runnerErrors;

            scope.assert.equal(result.perTest[0]?.verdict, 'pass');
            scope.assert.equal(runnerError?.subtype, 'runtime-policy');
            scope.assert.equal(runnerError?.attributedTo, null);
            scope.assert.equal(runnerErrorPhase(runnerError), 'load');
            scope.assert.equal(runnerErrorMessageIncludes(runnerError, 'process.env'), true);

            return scope.assert.collect();
        }
    ),
    test('orchestrator.resolve() preserves profile-level reporter lists', async function (scope) {
        const runOrchestrator = createUnitRunOrchestrator();
        const profileReporter: NonNullable<NormalizedConfig['reporters']>[number] = defineReporter(
            function profileMemoryReporter() {
                return {
                    dispose: null,
                    kind: 'real-time',
                    name: 'profile-memory',
                    onEvent() {
                        return undefined;
                    },
                    onFinish: null,
                    sinks: [ { kind: 'memory' } ]
                };
            }
        );
        const resolvedRun = await runOrchestrator.resolve(createRunCommand({
            config: defaultRunConfig({
                profiles: {
                    microtest: defaultMicrotestProfile({
                        timeouts: { collectionMilliseconds: 5000 },
                        reporters: [ profileReporter ]
                    })
                }
            }),
            cwd: process.cwd(),
            engine: { kind: 'default' },
            request: defaultRunRequest({ paths: [ passingFixturePath ] })
        }));

        scope.assert.deepEqual(resolvedRun.reporters, [ profileReporter ]);

        return scope.assert.collect();
    }),
    test('runtime capability policy attributes observed case side effects', async function (scope) {
        const environment: Record<string, string | undefined> = { BEFORE: 'yes' };
        const sessionStorageValues = new Map([ [ 'before', 'yes' ] ]);
        const localStorageValues = new Map([ [ 'before', 'yes' ] ]);
        const policy = createRuntimeCapabilityPolicy({
            dependencies: {
                observeIpcListeners: installNoPolicyRestriction,
                observeProcessExit: installNoPolicyRestriction,
                readEnvironment() {
                    return environment;
                },
                readStorage(name) {
                    return createStorage(name === 'sessionStorage' ? sessionStorageValues : localStorageValues);
                }
            },
            observedStderr: false,
            observedStdout: false
        });

        await policy.runAttempt(policyTestCase, { index: 0 }, async function createObservedSideEffects() {
            environment.AFTER = 'yes';
            sessionStorageValues.set('after', 'yes');
            localStorageValues.set('after', 'yes');
            policy.recordViolation(
                'timer',
                'Runtime policy violation: setTimeout/setInterval created a timer.',
                'observed'
            );
        });
        const caseErrors = policy.takeAttemptErrors(policyTestCase, { index: 0 });
        policy.takeRunErrors();

        scope.assert.deepEqual(caseErrors.map(errorCapability).toSorted(compareNullableStrings), [
            'fs-write',
            'fs-write',
            'process-env',
            'timer'
        ]);
        scope.assert.equal(
            caseErrors.every(function attributedToCase(error) {
                return error.attributedTo === policyTestCase.id;
            }),
            true
        );

        return scope.assert.collect();
    }),
    test(
        'permission denial runtime policy attributes Node permission diagnostics',
        async function (scope) {
            const policy = createPermissionDenialRuntimePolicy({ auditDiagnostics: 'ignore', auditEnabled: false });
            const channel = await readPermissionDiagnosticChannel();

            await policy.runAttempt(policyTestCase, { index: 0 }, async function publishCasePermissionDiagnostic() {
                publishPermissionDiagnostic(channel, 'FileSystemWrite', '/project/output.txt');
            });
            const error = firstRunnerError(policy.takeAttemptErrors(policyTestCase, { index: 0 }));
            const runErrors = policy.takeRunErrors();

            assertPermissionDiagnosticError(scope, error, {
                capability: 'fs-write',
                message: 'Permission denied: FileSystemWrite for /project/output.txt.',
                permission: 'FileSystemWrite',
                resource: '/project/output.txt'
            });
            scope.assert.equal(error.attributedTo, policyTestCase.id);
            scope.assert.deepEqual(runErrors, []);

            return scope.assert.collect();
        }
    ),
    test(
        'runtime capability policy reports Node permission diagnostics as permission errors',
        async function (scope) {
            const environment: RuntimeCapabilityPolicyEnvironment = {};
            const channel = await readPermissionDiagnosticChannel();
            const policy = createRuntimeCapabilityPolicy({
                dependencies: {
                    observeIpcListeners: installNoPolicyRestriction,
                    observeProcessExit: installNoPolicyRestriction,
                    readEnvironment() {
                        return environment;
                    },
                    readStorage() {
                        return null;
                    }
                },
                observedStderr: false,
                observedStdout: false
            });

            await policy.runAttempt(
                policyTestCase,
                { index: 0 },
                async function publishStrictPermissionDiagnostic() {
                    publishPermissionDiagnostic(channel, 'FileSystemRead', '/project/input.txt');
                }
            );
            const error = firstRunnerError(policy.takeAttemptErrors(policyTestCase, { index: 0 }));
            const runErrors = policy.takeRunErrors();

            assertPermissionDiagnosticError(scope, error, {
                capability: 'fs-read',
                message: null,
                permission: 'FileSystemRead',
                resource: '/project/input.txt'
            });
            scope.assert.deepEqual(runErrors, []);

            return scope.assert.collect();
        }
    ),
    test('runtime capability policy accepts sparse unchanged storage snapshots', async function (scope) {
        const environment: RuntimeCapabilityPolicyEnvironment = {};
        const sparseStorage = createSparseStorage();
        const policy = createRuntimeCapabilityPolicy({
            dependencies: {
                observeIpcListeners: installNoPolicyRestriction,
                observeProcessExit: installNoPolicyRestriction,
                readEnvironment() {
                    return environment;
                },
                readStorage() {
                    return sparseStorage;
                }
            },
            observedStderr: false,
            observedStdout: false
        });

        await policy.runAttempt(policyTestCase, { index: 0 }, async function leaveStorageUnchanged() {
            return undefined;
        });
        const caseErrors = policy.takeAttemptErrors(policyTestCase, { index: 0 });
        const runErrors = policy.takeRunErrors();

        scope.assert.deepEqual(caseErrors, []);
        scope.assert.deepEqual(runErrors, []);

        return scope.assert.collect();
    }),
    test('runtime capability policy reports process.env identity drift', async function (scope) {
        let environment: RuntimeCapabilityPolicyEnvironment = {};
        const policy = createRuntimeCapabilityPolicy({
            dependencies: {
                observeIpcListeners: installNoPolicyRestriction,
                observeProcessExit: installNoPolicyRestriction,
                readEnvironment() {
                    return environment;
                },
                readStorage() {
                    return null;
                }
            },
            observedStderr: false,
            observedStdout: false
        });

        await policy.runAttempt(policyTestCase, { index: 0 }, async function replaceEnvironmentObject() {
            environment = {};
        });
        const caseErrors = policy.takeAttemptErrors(policyTestCase, { index: 0 });
        policy.takeRunErrors();

        scope.assert.deepEqual(caseErrors.map(errorCapability), [ 'process-env' ]);

        return scope.assert.collect();
    }),
    test('runtime capability policy records injected strictness and raw output', async function (scope) {
        const environment: RuntimeCapabilityPolicyEnvironment = {};
        const policy = createRuntimeCapabilityPolicy({
            dependencies: {
                observeIpcListeners: installNoPolicyRestriction,
                observeProcessExit: installNoPolicyRestriction,
                readEnvironment() {
                    return environment;
                },
                readStorage() {
                    return null;
                }
            },
            observedStderr: true,
            observedStdout: true
        });

        await policy.runLoad(async function publishLoadDiagnostics() {
            policy.recordViolation('net', 'Runtime policy violation: net.', 'blocked');
            policy.recordViolation('fs-write', 'Runtime policy violation: fs-write.', 'blocked');
            policy.recordViolation('net', 'Runtime policy violation: net.', 'blocked');
            policy.recordViolation('console', 'Runtime policy violation: console.', 'observed');
        });
        policy.recordViolation('console', 'Runtime policy violation: console.', 'observed');
        const runErrors = policy.takeRunErrors();

        scope.assert.deepEqual(runErrors.map(errorCapabilityAndStrictness), [
            [ 'net', 'blocked' ],
            [ 'fs-write', 'blocked' ],
            [ 'net', 'blocked' ],
            [ 'console', 'observed' ],
            [ 'console', 'observed' ],
            [ 'raw-stdout', 'observed' ],
            [ 'raw-stderr', 'observed' ]
        ]);
        scope.assert.equal(runnerErrorPhase(runErrors[4]), 'out-of-test');
        scope.assert.deepEqual(policy.takeRunErrors(), []);

        return scope.assert.collect();
    })
]);
