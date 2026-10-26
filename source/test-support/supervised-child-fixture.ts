import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';
import type { RunProcessUsageTracker } from '../packages/engine/engine.entry-point.ts';
import type { SupervisedChildDependencies, SupervisedChildHost } from '../run/supervised-child.ts';
import type {
    SupervisedAssignmentCommand,
    SupervisedChildCommand,
    SupervisedChildMessage
} from '../run/supervised-protocol.ts';
import { createNodeProcessUsageTracker } from '../run/process-usage.ts';
import { readProcessEnvironment } from '../run/node-host-readers.ts';

export function readNativeEnvironment(): ReturnType<typeof readProcessEnvironment> {
    return readProcessEnvironment(process);
}

type ChildRunRecord = {
    readonly disconnected: () => boolean;
    readonly exitCode: () => number | null;
    readonly messages: () => readonly SupervisedChildMessage[];
};

type ChildHostInput = {
    readonly assignment: SupervisedAssignmentCommand;
    readonly command: SupervisedChildCommand;
    readonly discoverRunFiles: SupervisedChildHost['discoverRunFiles'];
    readonly loadRunTestModules: SupervisedChildHost['loadRunTestModules'];
    readonly readEnvironment: SupervisedChildHost['readEnvironment'];
};

function installNoPolicyRestriction(): () => void {
    return function restoreNoPolicyRestriction(): void {
        return undefined;
    };
}

function createEmptyProcessUsageTracker(): RunProcessUsageTracker {
    return {
        finish() {
            throw new Error('Supervised child test does not finish process usage tracking.');
        },
        start() {
            return undefined;
        }
    };
}

function createTestClock(): DeterministicClock {
    return createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
}

export function supervisedChildDependencies(): SupervisedChildDependencies {
    return {
        createProcessUsageTracker: createEmptyProcessUsageTracker,
        createClock: createTestClock
    };
}

export type ChildRunFixture = ChildRunRecord & {
    readonly host: SupervisedChildHost;
};

export function createChildRun(input: ChildHostInput): ChildRunFixture {
    const messages: SupervisedChildMessage[] = [];
    let disconnected = false;
    let exitCode: number | null = null;

    return {
        disconnected() {
            return disconnected;
        },
        exitCode() {
            return exitCode;
        },
        host: {
            disconnect() {
                disconnected = true;
            },
            discoverRunFiles: input.discoverRunFiles,
            dropBodyReadPermission() {
                return undefined;
            },
            observeIpcListeners: installNoPolicyRestriction,
            observeProcessExit: installNoPolicyRestriction,
            async loadRunEngineModule() {
                throw new Error('Supervised child test does not load engine modules.');
            },
            loadRunTestModules: input.loadRunTestModules,
            readEnvironment: input.readEnvironment,
            readStorage() {
                return null;
            },
            async receiveAssignment() {
                return input.assignment;
            },
            async receiveCommand() {
                return input.command;
            },
            send(message) {
                messages.push(message);
            },
            async flush() {
                await Promise.resolve();
            },
            setExitCode(code) {
                exitCode = code;
            },
            validatePermissionHost() {
                return undefined;
            }
        },
        messages() {
            return messages;
        }
    };
}

export function nativeChildDependencies(): SupervisedChildDependencies {
    return { createClock: createTestClock, createProcessUsageTracker: createNodeProcessUsageTracker };
}

export function supervisedChildCommand(kind: 'collect' | 'run', path: string): SupervisedChildCommand {
    return {
        benchmarkNormalization: null,
        benchmarkGarbageCollection: null,
        retryPolicy: null,
        capabilityRestrictions: { mode: 'disabled' },
        capture: 'buffered',
        propertySeed: '0',
        propertyPolicy: null,
        collectionTimeoutMilliseconds: 1000,
        cwd: '/project',
        definitionLocationCapture: 'enabled',
        engine: { kind: 'default' },
        hardTimeoutMilliseconds: 2000,
        maxConcurrency: 5,
        kind,
        paths: [ path ],
        processBudgets: {
            activeResourceCount: null,
            javaScriptEngineHeapBytes: null,
            residentSetBytes: null,
            residentSetGrowthBytesPerSecond: null
        },
        processUsageSamplingIntervalMilliseconds: 10,
        root: { annotations: {}, controls: {}, title: '/project' },
        scheduling: 'concurrent',
        testFamily: 'microtest',
        timeoutMilliseconds: 1000
    };
}
