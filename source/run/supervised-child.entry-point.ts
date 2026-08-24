import { runSupervisedChild, type SupervisedChildHost } from './supervised-child.ts';
import type { SupervisedRunCommand } from './supervised-protocol.ts';

function send(message: Parameters<SupervisedChildHost['send']>[0]): void {
    if (process.send !== undefined) {
        process.send(message);
    }
}

function disconnect(): void {
    if (process.disconnect !== undefined) {
        process.disconnect();
    }
}

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    return typeof value === 'object' && value !== null;
}

function isChildRunCommand(message: unknown): message is SupervisedRunCommand {
    return isRecord(message) &&
        Object.hasOwn(message, 'kind') &&
        message.kind === 'run';
}

function receiveRunCommand(): Promise<SupervisedRunCommand> {
    return new Promise(function waitForRunCommand(resolve) {
        process.once('message', function receiveCommand(message: unknown) {
            if (isChildRunCommand(message)) {
                resolve(message);
            }
        });
    });
}

function readWebStorage(name: 'localStorage' | 'sessionStorage') {
    if (name === 'localStorage') {
        return null;
    }

    const storage = (globalThis as Readonly<Record<string, unknown>>)[name];

    if (typeof storage !== 'object' || storage === null) {
        return null;
    }

    const candidate = storage as Readonly<Record<string, unknown>>;

    if (
        typeof candidate.length !== 'number' ||
        typeof candidate.getItem !== 'function' ||
        typeof candidate.key !== 'function'
    ) {
        return null;
    }

    return candidate as {
        readonly getItem: (key: string) => string | null;
        readonly key: (index: number) => string | null;
        readonly length: number;
    };
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
        process.permission.drop('fs.read');
    }
}

await runSupervisedChild({
    disconnect,
    dropBodyReadPermission,
    readEnvironment() {
        return process.env;
    },
    readStartedAt() {
        return new Date().toISOString();
    },
    readStorage: readWebStorage,
    receiveRunCommand,
    send,
    setExitCode(code) {
        process.exitCode = code;
    },
    validatePermissionHost
});
