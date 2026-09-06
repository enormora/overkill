import {
    createRuntimeCapabilityPolicy,
    type RuntimeCapabilityPolicy
} from './capability-policy.ts';
import {
    installIpcRestriction,
    installProcessExecutionRestriction
} from './node-process-capability-restrictions.ts';
import {
    readProcessEnvironment,
    readWebStorage
} from './node-host-readers.ts';

export type DirectRuntimePolicy = RuntimeCapabilityPolicy;

export function createDirectRuntimePolicy(): DirectRuntimePolicy {
    return createRuntimeCapabilityPolicy({
        dependencies: {
            installIpcRestriction(record) {
                return installIpcRestriction(process, record);
            },
            installProcessExecutionRestriction(record) {
                return installProcessExecutionRestriction(process, record);
            },
            readEnvironment() {
                return readProcessEnvironment(process);
            },
            readStorage(name) {
                return readWebStorage(globalThis, name);
            }
        },
        observedStderr: false,
        observedStdout: false
    });
}
