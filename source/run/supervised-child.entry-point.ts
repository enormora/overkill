import { readProcessEnvironment, readWebStorage } from './node-host-readers.ts';
import {
    installIpcRestriction as installProcessIpcRestriction,
    installProcessExecutionRestriction as installNodeProcessExecutionRestriction
} from './node-process-capability-restrictions.ts';
import { runSupervisedChild, type SupervisedChildHost } from './supervised-child.ts';
import type { SupervisedRunCommand } from './supervised-protocol.ts';

const sendMessage = process.send?.bind(process);
const disconnectProcess = process.disconnect?.bind(process);

function send(message: Parameters<SupervisedChildHost['send']>[0]): void {
    sendMessage?.(message);
}

function disconnect(): void {
    disconnectProcess?.();
}

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    return typeof value === 'object' && value !== null;
}

function isChildRunCommand(message: unknown): message is SupervisedRunCommand {
    return isRecord(message) &&
        Object.hasOwn(message, 'kind') &&
        message.kind === 'run';
}

async function receiveRunCommand(): Promise<SupervisedRunCommand> {
    return new Promise(function waitForRunCommand(resolve) {
        process.once('message', function receiveCommand(message: unknown) {
            if (isChildRunCommand(message)) {
                resolve(message);
            }
        });
    });
}

function validatePermissionHost(command: SupervisedRunCommand): void {
    if (command.capabilityRestrictions.mode === 'disabled') {
        return;
    }

    if (!process.execArgv.includes('--permission')) {
        throw new Error('Restricted microtest child started without --permission.');
    }

    if (process.execArgv.includes('--permission-audit')) {
        throw new Error('Restricted microtest child must not use --permission-audit.');
    }
}

function dropBodyReadPermission(command: SupervisedRunCommand): void {
    if (command.capabilityRestrictions.mode === 'enabled') {
        const drop: unknown = Reflect.get(process.permission, 'drop');

        if (typeof drop === 'function') {
            Reflect.apply(drop, process.permission, [ 'fs.read' ]);
        }
    }
}

await runSupervisedChild({
    disconnect,
    dropBodyReadPermission,
    installIpcRestriction(record) {
        return installProcessIpcRestriction(process, record);
    },
    installProcessExecutionRestriction(record) {
        return installNodeProcessExecutionRestriction(process, record);
    },
    readEnvironment() {
        return readProcessEnvironment(process);
    },
    readStorage(name) {
        return readWebStorage(globalThis, name);
    },
    receiveRunCommand,
    send,
    setExitCode(code) {
        process.exitCode = code;
    },
    validatePermissionHost
});
