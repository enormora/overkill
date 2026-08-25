import diagnosticsChannel from 'node:diagnostics_channel';
import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from 'node:timers';
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
import {
    createRuntimeCapabilityPolicy,
    isRuntimeCapabilityPolicyEnvironment,
    type RuntimeCapabilityPolicy,
    type RuntimeCapabilityPolicyEnvironment,
    type WebStorageLike
} from './capability-policy.ts';
import { readProcessEnvironment, readWebStorage } from './node-host-readers.ts';
import { orchestrator } from './run-orchestrator.entry-point.ts';
import type { RunCommand, RunConfig, RunRequest } from './run-types.ts';

type RunCommandParts = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};
type PolicyTestCase = Parameters<RuntimeCapabilityPolicy['runCase']>[0];

const loadEnvPolicyFixturePath = 'source/integration-tests/run/fixtures/load-env-policy.test.ts';
const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const policyTestCase: PolicyTestCase = {
    body: async function unusedPolicyTestBody() {
        throw new Error('Policy test body should not run.');
    },
    id: {
        file: 'source/run/run-capability-policy.test.ts',
        name: 'policy case',
        params: null,
        suite: [ 'runtime policy' ]
    },
    suitePath: [ 'runtime policy' ],
    metadata: {}
};

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

function errorCapability(error: RunnerError): string | null {
    const { cause } = error;

    if (typeof cause === 'object' && cause !== null && Object.hasOwn(cause, 'capability')) {
        return String(Reflect.get(cause, 'capability'));
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

function publishPolicyDiagnostics(): void {
    diagnosticsChannel.channel('node:permission-model:fs').publish({ permission: 'FileSystemRead' });
    diagnosticsChannel.channel('node:permission-model:net').publish(null);
    diagnosticsChannel.channel('node:permission-model:fs').publish({ permission: 'FileSystemWrite' });
    diagnosticsChannel.channel('node:permission-model:net').publish({});
    diagnosticsChannel.channel('console.log').publish({});
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
        }),
        createOverkillTestCase({
            name: 'runtime capability policy host readers reject invalid host values',
            metadata: {},
            body(scope: OverkillScope) {
                const invalidProcess = { env: { NUMBER: 1 } };
                const invalidHost = { sessionStorage: { length: '1' } };

                scope.assert.equal(isRuntimeCapabilityPolicyEnvironment({ VALID: 'value', OMITTED: undefined }), true);
                scope.assert.equal(isRuntimeCapabilityPolicyEnvironment({ INVALID: 1 }), false);
                scope.assert.deepEqual(readProcessEnvironment(invalidProcess), {});
                scope.assert.equal(readWebStorage(invalidHost, 'sessionStorage'), null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() preserves profile-level reporter lists',
            metadata: {},
            async body(scope: OverkillScope) {
                const profileReporter: RunConfig['reporters'][number] = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'profile-memory',
                    onEvent() {
                        return undefined;
                    },
                    onFinish: null,
                    sinks: [ { kind: 'memory' } ]
                };
                const resolvedRun = await orchestrator.resolve(createRunCommand({
                    config: defaultRunConfig({
                        profiles: {
                            microtest: defaultMicrotestProfile({
                                reporters: [ profileReporter ]
                            })
                        }
                    }),
                    cwd: process.cwd(),
                    engine: null,
                    request: defaultRunRequest({ paths: [ passingFixturePath ] })
                }));

                scope.assert.deepEqual(resolvedRun.reporters, [ profileReporter ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'runtime capability policy attributes observed case side effects',
            metadata: {},
            async body(scope: OverkillScope) {
                const environment: Record<string, string | undefined> = { BEFORE: 'yes' };
                const sessionStorageValues = new Map([ [ 'before', 'yes' ] ]);
                const localStorageValues = new Map([ [ 'before', 'yes' ] ]);
                const policy = createRuntimeCapabilityPolicy({
                    dependencies: {
                        installIpcRestriction: installNoPolicyRestriction,
                        installProcessExecutionRestriction: installNoPolicyRestriction,
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

                await policy.runCase(policyTestCase, async function createObservedSideEffects() {
                    environment.AFTER = 'yes';
                    sessionStorageValues.set('after', 'yes');
                    localStorageValues.set('after', 'yes');
                    const timer = setNodeTimeout(function unusedTimer() {
                        return undefined;
                    }, 1);
                    clearNodeTimeout(timer);
                });
                const caseErrors = policy.takeCaseErrors(policyTestCase);
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
            }
        }),
        createOverkillTestCase({
            name: 'runtime capability policy accepts sparse unchanged storage snapshots',
            metadata: {},
            async body(scope: OverkillScope) {
                const environment: RuntimeCapabilityPolicyEnvironment = {};
                const sparseStorage = createSparseStorage();
                const policy = createRuntimeCapabilityPolicy({
                    dependencies: {
                        installIpcRestriction: installNoPolicyRestriction,
                        installProcessExecutionRestriction: installNoPolicyRestriction,
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

                await policy.runCase(policyTestCase, async function leaveStorageUnchanged() {
                    return undefined;
                });
                const caseErrors = policy.takeCaseErrors(policyTestCase);
                const runErrors = policy.takeRunErrors();

                scope.assert.deepEqual(caseErrors, []);
                scope.assert.deepEqual(runErrors, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'runtime capability policy reports process.env identity drift',
            metadata: {},
            async body(scope: OverkillScope) {
                let environment: RuntimeCapabilityPolicyEnvironment = {};
                const policy = createRuntimeCapabilityPolicy({
                    dependencies: {
                        installIpcRestriction: installNoPolicyRestriction,
                        installProcessExecutionRestriction: installNoPolicyRestriction,
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

                await policy.runCase(policyTestCase, async function replaceEnvironmentObject() {
                    environment = {};
                });
                const caseErrors = policy.takeCaseErrors(policyTestCase);
                policy.takeRunErrors();

                scope.assert.deepEqual(caseErrors.map(errorCapability), [ 'process-env' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'runtime capability policy records diagnostic channel strictness and raw output',
            metadata: {},
            async body(scope: OverkillScope) {
                const environment: RuntimeCapabilityPolicyEnvironment = {};
                const policy = createRuntimeCapabilityPolicy({
                    dependencies: {
                        installIpcRestriction: installNoPolicyRestriction,
                        installProcessExecutionRestriction: installNoPolicyRestriction,
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
                    publishPolicyDiagnostics();
                });
                diagnosticsChannel.channel('console.warn').publish({});
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

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
