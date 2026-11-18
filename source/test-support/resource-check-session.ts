import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';
import { createStoredValue } from '../stored-value.ts';
import { defineResource } from '../resources/resources.ts';
import { superviseResourceObservation } from '../resources/resource-check-supervision.ts';
import {
    createSupervisedResourceCheckSession,
    withResourceChecks,
    type ResourceCheckSession,
    type ResourceCheckSessionControl,
    type ResourceCheckInstallationContext
} from '../resources/resource-checks.ts';
import type { AnyResourceDefinition } from '../resources/resource-definition-shape.ts';
import type { ResourceCheckCompleteness } from '../resource-check-protocol.ts';

const observedHandle = 42;
const microsecondsPerMillisecond = 1000;
export type ObservationFaults = {
    readonly install: Error | null;
    readonly prepare: Error | null;
    readonly finalize: Error | null;
    readonly cleanup: Error | null;
    readonly completeness: ResourceCheckCompleteness;
};
export const completeObservation: ObservationFaults = {
    install: null,
    prepare: null,
    finalize: null,
    cleanup: null,
    completeness: { kind: 'complete' }
};
type ResourceCheckFixture = {
    readonly session: ResourceCheckSession;
    readonly clock: DeterministicClock;
    readonly calls: readonly string[];
    readonly stopped: readonly unknown[];
    readonly context: () => ResourceCheckInstallationContext<AnyResourceDefinition>;
};
function assertPhase(failure: Error | null): void {
    if (failure !== null) {
        throw failure;
    }
}
function observedOwner(scope: 'per-case' | 'per-run'): AnyResourceDefinition {
    const definition = {
        name: 'owner',
        requirements: [],
        acquire() {
            return observedHandle;
        },
        dispose: null
    };
    if (scope === 'per-case') {
        return defineResource({ ...definition, scope });
    }
    return defineResource({
        ...definition,
        scope,
        dependencies: {},
        serializeHandle(handle) {
            return handle;
        },
        deserializeHandle(handle: number) {
            return handle;
        }
    });
}
export function resourceCheckOwnerSession(
    faults: ObservationFaults,
    scope: 'per-case' | 'per-run',
    control: ResourceCheckSessionControl | null
): ResourceCheckFixture {
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const calls: string[] = [];
    const stopped: unknown[] = [];
    const context = createStoredValue<ResourceCheckInstallationContext<AnyResourceDefinition> | null>(null);
    const resource = withResourceChecks(
        observedOwner(scope),
        function (input) {
            context.write(input);
            calls.push('install');
            input.cleanup.defer(function () {
                calls.push('cleanup');
                assertPhase(faults.cleanup);
            });
            assertPhase(faults.install);
            return {
                prepare({ interval }) {
                    calls.push(`prepare:${interval.kind}`);
                    assertPhase(faults.prepare);
                },
                finalize({ interval }) {
                    calls.push(`finalize:${interval.kind}`);
                    assertPhase(faults.finalize);
                    return faults.completeness;
                }
            };
        }
    );
    return {
        clock,
        calls,
        stopped,
        context() {
            const current = context.read();
            if (current === null) {
                throw new Error('Observer was not installed.');
            }
            return current;
        },
        session: createSupervisedResourceCheckSession(
            resource,
            observedHandle,
            control ?? {
                kind: 'standalone',
                stop(cause) {
                    stopped.push(cause);
                }
            },
            {
                now() {
                    return Number(clock.currentMonotonicMicroseconds) / microsecondsPerMillisecond;
                },
                async run(operation, signal, milliseconds) {
                    return await superviseResourceObservation(operation, signal, milliseconds, clock);
                }
            }
        )
    };
}

export function resourceCheckSession(faults: ObservationFaults): ResourceCheckFixture {
    return resourceCheckOwnerSession(faults, 'per-case', null);
}
