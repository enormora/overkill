import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';
import type { NormalizedConfig } from '../packages/run/run.entry-point.ts';
import { defineReporter, type RunnerError } from '../packages/engine/engine.entry-point.ts';
import { createUnitRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultMicrotestProfile, defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';
import {
    type ExpectedPermissionDiagnosticError,
    loadEnvPolicyFixturePath,
    passingFixturePath,
    policyTestCase,
    createRunCommand,
    firstRunnerError,
    runnerErrorPhase,
    runnerErrorMessageIncludes,
    errorCapability,
    errorStringField,
    compareNullableStrings,
    errorCapabilityAndStrictness,
    createStorage,
    installNoPolicyRestriction,
    readPermissionDiagnosticChannel,
    publishPermissionDiagnostic,
    createSparseStorage
} from '../test-support/capability-policy-fixture.ts';
import { createPermissionDenialRuntimePolicy } from './permission-denial-runtime-policy.ts';
import { createRuntimeCapabilityPolicy } from './capability-policy.ts';
import type { RuntimeCapabilityPolicyEnvironment } from './capability-policy-snapshots.ts';

const assertPermissionDiagnosticError = defineCompositeAssertion({
    name: 'permission diagnostic error',
    assert(check, error: RunnerError, expected: ExpectedPermissionDiagnosticError) {
        const initialChecks = check.group([
            check.equal(error.subtype, 'permission'),
            check.equal(errorCapability(error), expected.capability),
            check.equal(errorStringField(error, 'permission'), expected.permission),
            check.equal(errorStringField(error, 'resource'), expected.resource),
            check.equal(errorStringField(error, 'source'), 'diagnostic-channel')
        ]);
        return expected.message === null
            ? initialChecks
            : check.group([ initialChecks, check.equal(error.message, expected.message) ]);
    }
});

export const testNode = suite('Run capability policy', [
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

            scope.assert(assertPermissionDiagnosticError, error, {
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

            scope.assert(assertPermissionDiagnosticError, error, {
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
