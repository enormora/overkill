import type { RunResult, RunnerError } from '../engine/run-result.ts';
import { defaultAttachmentLimits, type RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import { createAttachmentRecord, type AttachmentRecord } from './attachment-record.ts';
import { createRunAttachmentStore, type AttachmentStorageSession } from './attachment-storage-session.ts';
import { createAttachmentExecution, type AttachmentExecution } from './attachment-execution.ts';
import { resultWithRuntimeAttachments } from './attachment-results.ts';
import { runWithArtifactFinalizer } from './attachment-coordinator-context.ts';
import { retainWitnessAttachment } from './witness-attachment.ts';
import type { ResolvedRun } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

type WitnessRun = {
    readonly resolved: ResolvedRun;
    readonly dependencies: RunOrchestratorDependencies;
    readonly session: AttachmentRecord['session'] | null;
    readonly record: () => AttachmentRecord | null;
    readonly retainRecord: (record: AttachmentRecord) => void;
};
type PropertyWitnessStorage = {
    readonly store: AttachmentStorageSession['store'];
    readonly execution: AttachmentExecution;
};

function witnessStorageError(error: unknown): RunnerError {
    return {
        attributedTo: null,
        attributedToAttempt: null,
        cause: error,
        diagnostics: [],
        message: 'Failed to retain property witnesses.',
        subtype: 'artifact'
    };
}

function hasConfirmedWitness(result: RunResult): boolean {
    return result.perTest.some(function confirmed(testCase) {
        return testCase.property?.invocations.some(function replayable(invocation) {
            return invocation.confirmedWitness !== null;
        }) === true;
    });
}

function witnessResult(
    result: RunResult,
    artifacts: readonly RuntimeAttachmentArtifact[],
    errors: readonly RunnerError[]
): RunResult {
    return resultWithRuntimeAttachments(result, artifacts, {
        localErrors: errors,
        owners: [],
        policy: 'first-failure-and-final',
        retainsBranch() {
            return true;
        }
    });
}

async function retainAttemptWitnesses(
    execution: AttachmentExecution,
    testCase: RunResult['perTest'][number],
    attempt: RunResult['perTest'][number]['attempts'][number]
): Promise<void> {
    const target = execution.context.prepareForProducer(
        { kind: 'case' },
        { kind: 'attempt', work: testCase.workId, attempt: attempt.attempt },
        'native',
        'witness'
    );
    const invocations = attempt.property?.invocations ?? [];
    for (const invocation of invocations) {
        if (invocation.confirmedWitness !== null) {
            await retainWitnessAttachment(
                target,
                { name: 'property-witness', mediaType: 'application/json' },
                invocation.confirmedWitness,
                defaultAttachmentLimits.maxArtifactBytes
            );
        }
    }
}

async function retainWitnesses(execution: AttachmentExecution, result: RunResult): Promise<void> {
    for (const testCase of result.perTest) {
        for (const attempt of testCase.attempts) {
            await execution.runAttempt(testCase.workId, attempt.attempt, async function retainAttempt() {
                await retainAttemptWitnesses(execution, testCase, attempt);
            });
        }
    }
}

async function createWitnessStorage(context: WitnessRun): Promise<PropertyWitnessStorage> {
    const record = await createAttachmentRecord(context.resolved, context.dependencies, context.session);
    context.retainRecord(record);
    const store = createRunAttachmentStore(context.resolved, record, defaultAttachmentLimits);
    const execution = createAttachmentExecution(async function exchange(operation) {
        return store.exchange('property', operation);
    }, defaultAttachmentLimits);
    return { store, execution };
}

async function retainPropertyWitnesses(context: WitnessRun, result: RunResult): Promise<RunResult> {
    const { store, execution } = await createWitnessStorage(context);
    const errors: RunnerError[] = [];
    try {
        await retainWitnesses(execution, result);
    } catch (error: unknown) {
        errors.push(witnessStorageError(error));
    } finally {
        await execution.finish();
        await store.finish(null);
    }
    store.settleResult(result);
    return witnessResult(result, store.selectedArtifacts(), errors);
}

async function finalizePropertyWitnesses(context: WitnessRun, result: RunResult): Promise<RunResult> {
    if (!hasConfirmedWitness(result)) {
        return result;
    }
    try {
        return await retainPropertyWitnesses(context, result);
    } catch (error: unknown) {
        return witnessResult(result, [], [ witnessStorageError(error) ]);
    }
}

async function completeWitnessRecord(context: WitnessRun, result: RunResult): Promise<RunResult> {
    const record = context.record();
    return record === null || context.session !== null ? result : await record.session.complete(result);
}

export async function executeWithPropertyWitnesses(
    resolved: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    run: () => Promise<RunResult>,
    session: AttachmentRecord['session'] | null
): Promise<RunResult> {
    let record: AttachmentRecord | null = null;
    const context: WitnessRun = {
        resolved,
        dependencies,
        session,
        record() {
            return record;
        },
        retainRecord(value) {
            record = value;
        }
    };
    try {
        return await completeWitnessRecord(
            context,
            await runWithArtifactFinalizer(
                finalizePropertyWitnesses.bind(null, context),
                run
            )
        );
    } catch (error: unknown) {
        if (session === null) {
            await context.record()?.session.interrupt(error);
        }
        throw error;
    }
}
