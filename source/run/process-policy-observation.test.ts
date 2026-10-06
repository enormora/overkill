import { createSuite, createTestCase, type RunnerError } from '../packages/engine/engine.entry-point.ts';
import { createRuntimeCapabilityPolicy, type RuntimeCapabilityPolicy } from './capability-policy.ts';
import { observeProcessExit, observeProcessIpcListeners } from './node-process-policy-observation.ts';
import { readProcessEnvironment } from './node-host-readers.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const registrationMethods = [ 'on', 'once', 'addListener', 'prependListener', 'prependOnceListener' ] as const;
type NativePolicyState = { readonly methods: readonly unknown[]; readonly listeners: readonly number[]; };
function nativePolicyState(): NativePolicyState {
    const methods = Object
        .values(Object.getOwnPropertyDescriptors(process))
        .map(function nativeValue(descriptor): unknown {
            return descriptor.value;
        })
        .filter(function callable(value) {
            return typeof value === 'function';
        });
    return { methods, listeners: [ process.listenerCount('exit'), process.listenerCount('newListener') ] };
}
function createPolicy(): RuntimeCapabilityPolicy {
    return createRuntimeCapabilityPolicy({
        dependencies: {
            observeIpcListeners(record) {
                return observeProcessIpcListeners(process, record, new WeakSet());
            },
            observeProcessExit,
            readEnvironment() {
                return readProcessEnvironment(process);
            },
            readStorage() {
                return null;
            }
        },
        observedStderr: false,
        observedStdout: false
    });
}
function ignoredMessage(): void {
    return undefined;
}
type ListenerObservations = {
    readonly errors: readonly RunnerError[];
    readonly registered: number;
};
async function observeAllRegistrationMethods(): Promise<ListenerObservations> {
    const count = process.listenerCount('message');
    const policy = createPolicy();
    const listeners = registrationMethods.map(function registrationListener() {
        return function listener(): void {
            return undefined;
        };
    });
    try {
        await policy.runLoad(async function registerMessages() {
            for (const [ index, method ] of registrationMethods.entries()) {
                const listener = listeners[index];
                if (listener !== undefined) {
                    process[method]('message', listener);
                }
            }
        });
        return { errors: policy.takeRunErrors(), registered: process.listenerCount('message') - count };
    } finally {
        policy.takeRunErrors();
        for (const listener of listeners) {
            process.removeListener('message', listener);
        }
    }
}
export const testNode = createSuite({
    title: 'process policy observation',
    ...metadata,
    children: [
        createTestCase({
            title: 'observation failures do not interfere with native user registration',
            ...metadata,
            body(scope) {
                const stop = observeProcessIpcListeners(process, function unavailableDiagnostics(): void {
                    throw new Error('diagnostics unavailable');
                }, new WeakSet());
                try {
                    process.on('message', ignoredMessage);
                    scope.assert.true(process.listeners('message').includes(ignoredMessage));
                } finally {
                    stop();
                    process.removeListener('message', ignoredMessage);
                }
                return scope.assert.collect();
            }
        }),

        createTestCase({
            title: 'restricted policy preserves native methods and removes its own observers',
            ...metadata,
            async body(scope) {
                const before = nativePolicyState();
                const policy = createPolicy();
                try {
                    await policy.runLoad(async function checkNativeMethods() {
                        scope.assert.deepEqual(nativePolicyState().methods, before.methods);
                    });
                } finally {
                    policy.takeRunErrors();
                }
                scope.assert.deepEqual(nativePolicyState(), before);
                scope.assert.deepEqual(policy.takeRunErrors(), []);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'all native IPC registration methods remain effective and are observed',
            ...metadata,
            async body(scope) {
                const observations = await observeAllRegistrationMethods();
                scope.assert.equal(observations.registered, registrationMethods.length);
                scope.assert.deepEqual(
                    observations.errors.map(function observed(error) {
                        return {
                            subtype: error.subtype,
                            strictness: error
                                .diagnostics
                                .find(function strictness(diagnostic) {
                                    return diagnostic.label === 'strictness';
                                })
                                ?.value
                        };
                    }),
                    registrationMethods.map(function expectedObservation() {
                        return { subtype: 'runtime-policy', strictness: 'observed' };
                    })
                );
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'owned IPC listener identity is exempt without suppressing user observations',
            ...metadata,
            body(scope) {
                const owned = new WeakSet([ ignoredMessage ]);
                const messages: string[] = [];
                const stop = observeProcessIpcListeners(process, function record(message) {
                    messages.push(message);
                }, owned);
                try {
                    process.on('message', ignoredMessage);
                } finally {
                    stop();
                    process.removeListener('message', ignoredMessage);
                }
                scope.assert.deepEqual(messages, []);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
