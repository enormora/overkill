import { createRuntimeCapabilityPolicy, type RuntimeCapabilityPolicy } from '../run/capability-policy.ts';
import type { RunnerError } from '../engine/run-result.ts';

type Violation = (message: string) => RunnerError;
type CapabilityObservation = {
    readonly policy: RuntimeCapabilityPolicy;
    readonly processExit: Violation;
    readonly ipc: (message: string) => void;
};
function unavailable(): never {
    throw new Error('Observer is not installed.');
}
export function capabilityObservation(): CapabilityObservation {
    const environment = {};
    let processExit: Violation = unavailable;
    let ipc: (message: string) => void = unavailable;
    const policy = createRuntimeCapabilityPolicy({
        observedStderr: false,
        observedStdout: false,
        dependencies: {
            observeProcessExit(record) {
                processExit = record;
                return function () {
                    return undefined;
                };
            },
            observeIpcListeners(record) {
                ipc = record;
                return function () {
                    return undefined;
                };
            },
            readEnvironment() {
                return environment;
            },
            readStorage() {
                return null;
            }
        }
    });
    return { policy, processExit, ipc };
}
