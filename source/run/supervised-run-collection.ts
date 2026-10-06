import { observeSupervisedTransport, sendSupervisedCommand } from './supervised-child-transport.ts';
import type {
    ResourceUsageSnapshot,
    RunnerError
} from './run-engine-primitives.ts';
import { RunCollectionError, SupervisedCollectionError } from './run-errors.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    applyEvent,
    handleCollectionSample,
    type SupervisedCollectionRuntime
} from './supervised-run-runtime.ts';
import {
    createStoredRunValue,
    createSupervisedRunState
} from './supervised-run-state.ts';
import {
    emptyTimingSpanMetadata,
    type RunTimingMeasurement
} from './run-timing-collection.ts';
import type { CollectedRunPlan } from './run-types.ts';
import {
    kill,
    observeSupervisedChildOutput,
    type SupervisedChildProcess
} from './supervised-child-process.ts';
import type {
    SupervisedChildMessage,
    SupervisedCollectCommand
} from './supervised-protocol.ts';

export type SupervisedCollectionResult = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly RunnerError[];
};

function handleCollectionMessage(
    message: SupervisedChildMessage,
    runtime: SupervisedCollectionRuntime<SupervisedCollectionResult | null>
): void {
    if (message.kind === 'collected') {
        runtime.collected.write({
            collectedPlan: message.collectedPlan,
            runnerErrors: message.runnerErrors
        });
    } else if (message.kind === 'event') {
        applyEvent(
            message.event,
            runtime.state,
            new Map(),
            Number(runtime.dependencies.wallClock.currentMonotonicMicroseconds)
        );
    } else if (message.kind === 'sample') {
        handleCollectionSample(message.sample, runtime);
    }
}

async function observeCollection(
    runtime: SupervisedCollectionRuntime<SupervisedCollectionResult | null>
): Promise<void> {
    observeSupervisedChildOutput({
        capabilityRestrictions: runtime.command.capabilityRestrictions,
        capture: runtime.command.capture,
        child: runtime.child,
        dependencies: runtime.dependencies,
        state: runtime.state,
        terminalFailure: runtime.terminalFailure
    });

    return new Promise(function waitForCollectionChild(resolve) {
        const collectionTimeout = runtime.dependencies.wallClock.setTimeout(function killTimedOutCollection() {
            runtime.terminalFailure.write(true);
            runtime.state.recordRunnerError({
                attributedToAttempt: null,
                attributedTo: null,
                attributedToWork: null,
                cause: { reason: 'Supervised collection exceeded collection timeout.' },
                diagnostics: [ { label: 'reason', value: 'Supervised collection exceeded collection timeout.' } ],
                message: 'Supervised collection exceeded collection timeout.',
                subtype: 'crash'
            });
            kill(runtime.child);
        }, runtime.command.collectionTimeoutMilliseconds);

        observeSupervisedTransport({
            accept(message) {
                if (runtime.collected.read() !== null || message.kind === 'result') {
                    return false;
                }
                return message.kind !== 'event' || message.event.kind === 'runner-error';
            },
            child: runtime.child,
            completed() {
                return runtime.collected.read() !== null;
            },
            finished() {
                runtime.dependencies.wallClock.clearTimeout(collectionTimeout);
                resolve();
            },
            interrupted() {
                runtime.dependencies.wallClock.clearTimeout(collectionTimeout);
            },
            receive(message) {
                handleCollectionMessage(message, runtime);
            },
            restricted: runtime.command.capabilityRestrictions.mode === 'enabled',
            state: runtime.state,
            terminalFailure: runtime.terminalFailure,
            wallClock: runtime.dependencies.wallClock
        });
    });
}

async function startCollectionChild(
    command: SupervisedCollectCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement | null
): Promise<SupervisedChildProcess> {
    return await (timing?.measureAsync(
        'supervised-process.spawn',
        emptyTimingSpanMetadata(),
        async function startTimedSupervisedCollectionChild() {
            return await dependencies.startSupervisedChild({
                capabilityRestrictions: command.capabilityRestrictions,
                coverage: null,
                cwd: command.cwd,
                environmentVariables: dependencies.runtimeCapabilityPolicy.readEnvironment(),
                testFamily: command.testFamily
            });
        }
    ) ?? dependencies.startSupervisedChild({
        capabilityRestrictions: command.capabilityRestrictions,
        coverage: null,
        cwd: command.cwd,
        environmentVariables: dependencies.runtimeCapabilityPolicy.readEnvironment(),
        testFamily: command.testFamily
    }));
}

async function createCollectionRuntime(
    command: SupervisedCollectCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement | null
): Promise<SupervisedCollectionRuntime<SupervisedCollectionResult | null>> {
    return {
        child: await startCollectionChild(command, dependencies, timing),
        command,
        collected: createStoredRunValue<SupervisedCollectionResult | null>(null),
        dependencies,
        previousSample: createStoredRunValue<ResourceUsageSnapshot | null>(null),
        state: createSupervisedRunState('first-failure-and-final'),
        terminalFailure: createStoredRunValue(false)
    };
}

function readCollectedResult(
    runtime: SupervisedCollectionRuntime<SupervisedCollectionResult | null>
): SupervisedCollectionResult {
    const collected = runtime.collected.read();

    if (collected !== null && !runtime.terminalFailure.read()) {
        return {
            collectedPlan: collected.collectedPlan,
            runnerErrors: [ ...runtime.state.runnerErrors(), ...collected.runnerErrors ]
        };
    }

    const [ firstError, ...remaining ] = runtime.state.runnerErrors();
    if (firstError !== undefined) {
        throw new SupervisedCollectionError([ firstError, ...remaining ], { cause: firstError.cause });
    }

    throw new RunCollectionError(
        'Supervised collection failed.',
        { cause: null },
        'loader'
    );
}

export async function collectSupervisedRun(
    command: SupervisedCollectCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement | null = null
): Promise<SupervisedCollectionResult> {
    const runtime = await createCollectionRuntime(command, dependencies, timing);
    const childFinished = observeCollection(runtime);
    const readyStartedAtMicroseconds = Number(dependencies.wallClock.currentMonotonicMicroseconds);
    sendSupervisedCommand(runtime.child, command);
    await childFinished;
    const readyCompletedAtMicroseconds = Number(dependencies.wallClock.currentMonotonicMicroseconds);

    timing?.record({
        completedAtMicroseconds: readyCompletedAtMicroseconds,
        kind: 'supervised-process.ready',
        metadata: emptyTimingSpanMetadata(),
        startedAtMicroseconds: readyStartedAtMicroseconds,
        status: 'success'
    });

    return readCollectedResult(runtime);
}
