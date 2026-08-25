import { readProcessEnvironment, readWebStorage } from './node-host-readers.ts';
import {
    installIpcRestriction as installProcessIpcRestriction,
    installProcessExecutionRestriction as installNodeProcessExecutionRestriction
} from './node-process-capability-restrictions.ts';
import { runSupervisedChild, type SupervisedChildHost } from './supervised-child.ts';
import type {
    SupervisedAssignmentCommand,
    SupervisedChildCommand,
    SupervisedRunCommand
} from './supervised-protocol.ts';

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

function isChildCommand(message: unknown): message is SupervisedChildCommand {
    return isRecord(message) &&
        Object.hasOwn(message, 'kind') &&
        (message.kind === 'collect' || message.kind === 'run');
}

function isAssignmentCommand(message: unknown): message is SupervisedAssignmentCommand {
    return isRecord(message) &&
        Object.hasOwn(message, 'kind') &&
        message.kind === 'assign';
}

async function receiveCommand(): Promise<SupervisedChildCommand> {
    return new Promise(function waitForCommand(resolve) {
        process.once('message', function receiveCommand(message: unknown) {
            if (isChildCommand(message)) {
                resolve(message);
            }
        });
    });
}

async function receiveAssignment(): Promise<SupervisedAssignmentCommand> {
    return new Promise(function waitForAssignment(resolve) {
        process.once('message', function receiveAssignmentCommand(message: unknown) {
            if (isAssignmentCommand(message)) {
                resolve(message);
            }
        });
    });
}

function validatePermissionHost(command: SupervisedChildCommand): void {
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
    receiveAssignment,
    receiveCommand,
    send,
    setExitCode(code) {
        process.exitCode = code;
    },
    validatePermissionHost
});
