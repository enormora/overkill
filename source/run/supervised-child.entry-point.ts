import { createClock } from '@enormora/clock';
import { createChildProcessOutbox } from './child-process-outbox.ts';
import { supervisedParentMessageSchema } from './supervised-protocol-schema.ts';
import {
    envelopeMessage
} from './child-process-protocol.ts';
import { readProcessEnvironment, readWebStorage } from './node-host-readers.ts';
import {
    loadRunEngineModule,
    loadRunTestModules,
    runDiscovery
} from './node-run-dependencies.entry-point.ts';
import {
    observeProcessIpcListeners
} from './node-process-policy-observation.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import { runSupervisedChild, type SupervisedChildHost } from './supervised-child.ts';
import {
    supervisedChildCorrelationId,
    type SupervisedAssignmentCommand,
    type SupervisedChildCommand,
    type SupervisedRunCommand
} from './supervised-protocol.ts';

const ownedMessageListeners = new WeakSet<(message: unknown) => void>();

const outbox = createChildProcessOutbox(supervisedChildCorrelationId, {
    disconnect: process.disconnect?.bind(process) ?? null,
    send: process.send?.bind(process) ?? null
});

function send(message: Parameters<SupervisedChildHost['send']>[0]): void {
    outbox.send(message);
}

async function disconnect(): Promise<void> {
    await outbox.disconnect();
}

function supervisedParentMessage(message: unknown): SupervisedAssignmentCommand | SupervisedChildCommand | null {
    return envelopeMessage(message, supervisedChildCorrelationId, supervisedParentMessageSchema);
}

function readCommand(message: unknown): SupervisedChildCommand {
    const decoded = supervisedParentMessage(message);
    if (decoded?.kind === 'run' || decoded?.kind === 'collect') {
        return decoded;
    }
    throw new Error('Expected a supervised child command.');
}
function readAssignment(message: unknown): SupervisedAssignmentCommand {
    const decoded = supervisedParentMessage(message);
    if (decoded?.kind === 'assign') {
        return decoded;
    }
    throw new Error('Expected a supervised child assignment.');
}
async function receiveParentMessage<Message>(read: (message: unknown) => Message): Promise<Message> {
    return new Promise(function waitForParentMessage(resolve, reject) {
        const listener = function receiveMessage(message: unknown): void {
            try {
                resolve(read(message));
            } catch (error: unknown) {
                reject(error instanceof Error ? error : new Error('Invalid parent IPC payload.'));
            }
        };
        ownedMessageListeners.add(listener);
        process.once('message', listener);
    });
}
async function receiveCommand(): Promise<SupervisedChildCommand> {
    return receiveParentMessage(readCommand);
}
async function receiveAssignment(): Promise<SupervisedAssignmentCommand> {
    return receiveParentMessage(readAssignment);
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

await runSupervisedChild(
    {
        disconnect,
        discoverRunFiles: runDiscovery.discoverRunFiles,
        dropBodyReadPermission,
        observeIpcListeners(record) {
            return observeProcessIpcListeners(process, record, ownedMessageListeners);
        },
        observeProcessExit() {
            return function stopObservingChildExit() {
                return undefined;
            };
        },
        readEnvironment() {
            return readProcessEnvironment(process);
        },
        readStorage(name) {
            return readWebStorage(globalThis, name);
        },
        loadRunEngineModule,
        loadRunTestModules,
        receiveAssignment,
        receiveCommand,
        send,
        setExitCode(code) {
            process.exitCode = code;
        },
        validatePermissionHost
    },
    {
        createResourceUsageTracker: createNodeResourceUsageTracker,
        createClock
    }
);
