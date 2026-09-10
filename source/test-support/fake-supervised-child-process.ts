import type { ResourceUsageSnapshot } from '../engine/run-result.ts';
import type { CollectedRunPlan } from '../run/run-types.ts';
import type { RunnerError } from '../packages/engine/engine.entry-point.ts';
import type { SupervisedChildProcess } from '../run/supervised-child-process.ts';
import type {
    SupervisedAssignmentCommand,
    SupervisedChildCommand,
    SupervisedChildMessage
} from '../run/supervised-protocol.ts';

type ChildProcessOutputDataListener = (chunk: Uint8Array) => void;

type FakeSupervisedChildProcessOutput = SupervisedChildProcess['stdout'] & {
    readonly emit: (text: string) => void;
};

type FakeSupervisedChildCollection = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly RunnerError[];
};

type FakeSupervisedChildCollectionInput = {
    readonly command: SupervisedChildCommand;
    readonly file: string;
};

export type FakeSupervisedChildRunContext = {
    readonly assignment: SupervisedAssignmentCommand;
    readonly command: SupervisedChildCommand;
    readonly emitExit: () => void;
    readonly emitMessage: (message: SupervisedChildMessage) => void;
    readonly emitSample: (sample: ResourceUsageSnapshot) => void;
    readonly isKilled: () => boolean;
    readonly stderr: FakeSupervisedChildProcessOutput;
    readonly stdout: FakeSupervisedChildProcessOutput;
    readonly testFile: string;
};

type FakeSupervisedChildProcessInput = {
    readonly collect: (input: FakeSupervisedChildCollectionInput) => FakeSupervisedChildCollection;
    readonly run: (context: FakeSupervisedChildRunContext) => void;
};

function createFakeChildProcessOutput(): FakeSupervisedChildProcessOutput {
    const listeners: ChildProcessOutputDataListener[] = [];

    return {
        emit(text) {
            const chunk = Buffer.from(text);

            for (const listener of listeners) {
                listener(chunk);
            }
        },
        on(_event, listener) {
            listeners.push(listener);
        }
    };
}

type FakeSupervisedChildProcessState = {
    readonly emitExit: () => void;
    readonly emitMessage: (message: SupervisedChildMessage) => void;
    readonly onExit: (listener: () => void) => void;
    readonly onMessage: (listener: (message: SupervisedChildMessage) => void) => void;
    readonly stderr: FakeSupervisedChildProcessOutput;
    readonly stdout: FakeSupervisedChildProcessOutput;
};

function createFakeSupervisedChildProcessState(): FakeSupervisedChildProcessState {
    const exitListeners: (() => void)[] = [];
    const messageListeners: ((message: SupervisedChildMessage) => void)[] = [];

    return {
        emitExit() {
            for (const listener of exitListeners) {
                listener();
            }
        },
        emitMessage(message) {
            for (const listener of messageListeners) {
                listener(message);
            }
        },
        onExit(listener) {
            exitListeners.push(listener);
        },
        onMessage(listener) {
            messageListeners.push(listener);
        },
        stderr: createFakeChildProcessOutput(),
        stdout: createFakeChildProcessOutput()
    };
}

function testFileFromCommand(message: SupervisedChildCommand): string {
    const [ testFile ] = message.paths;

    if (testFile === undefined) {
        throw new Error('Fake supervised child requires a test file.');
    }

    return testFile;
}

export function createFakeSupervisedChildProcess(input: FakeSupervisedChildProcessInput): SupervisedChildProcess {
    const state = createFakeSupervisedChildProcessState();
    let command: SupervisedChildCommand | null = null;
    let killed = false;
    let testFile: string | null = null;

    function emitCollectedPlan(receivedCommand: SupervisedChildCommand): void {
        if (testFile === null) {
            throw new Error('Fake supervised child did not receive a test file.');
        }

        state.emitMessage({
            ...input.collect({ command: receivedCommand, file: testFile }),
            kind: 'collected'
        });
    }

    function emitCollectionFailure(error: unknown): void {
        state.emitMessage({
            event: {
                error: {
                    attributedTo: null,
                    cause: error,
                    message: error instanceof Error ? error.message : String(error),
                    subtype: 'loader'
                },
                kind: 'runner-error'
            },
            kind: 'event'
        });
        state.emitExit();
    }

    function receiveRunCommand(message: SupervisedChildCommand): void {
        command = message;
        testFile = testFileFromCommand(message);

        try {
            emitCollectedPlan(message);
        } catch (error: unknown) {
            emitCollectionFailure(error);

            return;
        }

        if (message.kind === 'collect') {
            state.emitExit();
        }
    }

    return {
        exitCode: null,
        kill() {
            killed = true;
            state.emitExit();
        },
        on(...registration) {
            const [ event, listener ] = registration;

            if (event === 'message') {
                state.onMessage(listener);
            } else if (event === 'exit') {
                state.onExit(listener);
            }
        },
        pid: 1,
        send(message) {
            if (message.kind === 'assign') {
                if (command === null || testFile === null) {
                    throw new Error('Fake supervised child did not receive a test file.');
                }

                input.run({
                    assignment: message,
                    command,
                    emitExit: state.emitExit,
                    emitMessage: state.emitMessage,
                    emitSample(sample) {
                        state.emitMessage({ kind: 'sample', sample });
                    },
                    isKilled() {
                        return killed;
                    },
                    stderr: state.stderr,
                    stdout: state.stdout,
                    testFile
                });

                return;
            }

            receiveRunCommand(message);
        },
        signalCode: null,
        stderr: state.stderr,
        stdout: state.stdout
    };
}
