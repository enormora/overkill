import type {
    ResourceUsageSnapshot,
    RunnerError
} from '../packages/engine/engine.entry-point.ts';
import {
    childProcessEnvelope,
    envelopeMessage
} from './child-process-protocol.ts';
import { RunCollectionError } from './run-errors.ts';
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
import {
    supervisedChildCorrelationId,
    type SupervisedChildMessage,
    type SupervisedCollectCommand
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

function supervisedChildMessage(message: unknown): SupervisedChildMessage | null {
    return envelopeMessage<SupervisedChildMessage>(message, supervisedChildCorrelationId);
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
                attributedTo: null,
                attributedToWork: null,
                cause: { reason: 'Supervised collection exceeded collection timeout.' },
                diagnostics: [ { label: 'reason', value: 'Supervised collection exceeded collection timeout.' } ],
                message: 'Supervised collection exceeded collection timeout.',
                subtype: 'crash'
            });
            kill(runtime.child);
        }, runtime.command.collectionTimeoutMilliseconds);

        runtime.child.on('message', function receiveMessage(message: unknown) {
            const childMessage = supervisedChildMessage(message);

            if (childMessage !== null) {
                handleCollectionMessage(childMessage, runtime);
            }
        });
        runtime.child.on('error', function recordChildError(error: Error) {
            runtime.terminalFailure.write(true);
            runtime.state.recordRunnerError({
                attributedTo: null,
                attributedToWork: null,
                cause: error,
                diagnostics: [],
                message: error.message,
                subtype: 'crash'
            });
        });
        runtime.child.on('exit', function resolveExit() {
            runtime.dependencies.wallClock.clearTimeout(collectionTimeout);
            resolve();
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
                cwd: command.cwd,
                environmentVariables: dependencies.runtimeCapabilityPolicy.readEnvironment(),
                testFamily: command.testFamily
            });
        }
    ) ?? dependencies.startSupervisedChild({
        capabilityRestrictions: command.capabilityRestrictions,
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
        state: createSupervisedRunState(),
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

    const [ firstError ] = runtime.state.runnerErrors();

    throw new RunCollectionError(
        firstError?.message ?? 'Supervised collection failed.',
        { cause: firstError ?? null },
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
    runtime.child.send(childProcessEnvelope(supervisedChildCorrelationId, command));
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
