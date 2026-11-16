import { AsyncLocalStorage } from 'node:async_hooks';
import {
    currentExecutionOwner,
    withExecutionOwner,
    type ObservationLifetime,
    type RunOwner,
    type AttemptOwner,
    type ObservationOwner
} from '../execution-ownership.ts';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { withSerializationBudget } from '../compare/serialization-context.ts';
import { type TestDebugArtifact, artifactsForAttempt, type BoundaryFailureArtifact } from './run-artifact.ts';
import { defaultFailureArtifactPolicy, type FailureArtifactPolicy } from './failure-artifact-policy.ts';

import type { AttemptId, WorkId } from './identity.ts';
import type { RunnerError } from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';

export type ExecutionObservation = {
    readonly accepts: () => boolean;
    readonly open: () => boolean;
    readonly hasActiveAttempt: () => boolean;
    readonly attribute: (error: RunnerError) => RunnerError;
    readonly register: (dispose: () => void) => () => void;
    readonly run: <Value>(operation: () => Promise<Value>) => Promise<Value>;
    readonly runAttempt: <Value>(
        testCase: TestPlanCase,
        attempt: AttemptId,
        operation: () => Promise<Value>
    ) => Promise<Value>;
    readonly stop: () => void;
};

function disposeObservations(disposers: readonly (() => void)[]): void {
    const errors: unknown[] = [];
    for (const dispose of disposers) {
        try {
            dispose();
        } catch (error: unknown) {
            errors.push(error);
        }
    }
    if (errors.length > 0) {
        throw new AggregateError(errors, 'Execution observation shutdown failed.');
    }
}

function createLifetime(): ObservationLifetime {
    const disposers = new Set<() => void>();
    let open = true;
    return {
        open() {
            return open;
        },
        close() {
            if (!open) {
                return;
            }
            open = false;
            const pending = Array.from(disposers);
            disposers.clear();
            disposeObservations(pending);
        },
        register(dispose) {
            if (open) {
                disposers.add(dispose);
            } else {
                dispose();
            }
            return function unregister() {
                disposers.delete(dispose);
            };
        }
    };
}

function createRunOwner(): RunOwner {
    return { ...createLifetime(), identity: Symbol('execution run') };
}

function closeFailedObservation(run: RunOwner, error: unknown): never {
    try {
        run.close();
    } catch (cleanupError: unknown) {
        throw new AggregateError([ error, cleanupError ], 'Execution and observation shutdown failed.', {
            cause: cleanupError
        });
    }
    throw error;
}

export async function withExecutionObservation<Value>(operation: () => Promise<Value>): Promise<Value> {
    const current = currentExecutionOwner();
    if (current?.kind === 'run' && current.run.open()) {
        return await operation();
    }
    const run = createRunOwner();
    try {
        const result = await withExecutionOwner({ kind: 'run', run }, operation);
        run.close();
        return result;
    } catch (error: unknown) {
        return closeFailedObservation(run, error);
    }
}

function lateObservation(
    error: RunnerError,
    owner: Extract<ObservationOwner, { readonly kind: 'attempt'; }>
): RunnerError {
    return {
        ...error,
        attributedTo: null,
        attributedToWork: null,
        attributedToAttempt: null,
        subtype: 'attribution-drift',
        cause: {
            kind: 'late-observation',
            origin: { case: owner.attempt.caseId, work: owner.attempt.workId, attempt: owner.attempt.attempt },
            observation: error
        }
    };
}

function attributeObservation(error: RunnerError, run: RunOwner): RunnerError {
    const owner = currentExecutionOwner();
    if (owner?.kind === 'attempt') {
        if (!owner.run.open() || !owner.attempt.open()) {
            return lateObservation(error, owner);
        }
        if (owner.run === run) {
            return {
                ...error,
                attributedTo: owner.attempt.caseId,
                attributedToWork: owner.attempt.workId,
                attributedToAttempt: owner.attempt.attempt
            };
        }
    }
    return { ...error, attributedTo: null, attributedToWork: null, attributedToAttempt: null };
}

function matchesAttempt(owner: AttemptOwner, testCase: TestPlanCase, attempt: AttemptId): boolean {
    return owner.caseId === testCase.id && owner.workId === testCase.workId && owner.attempt.index === attempt.index;
}

function ownsObservation(run: RunOwner, owner: ObservationOwner | undefined): boolean {
    if (owner === undefined) {
        return true;
    }
    if (owner.kind === 'infrastructure') {
        return false;
    }
    return owner.run === run || !owner.run.open();
}

async function runOwnedAttempt<Value>(
    run: RunOwner,
    testCase: TestPlanCase,
    attempt: AttemptId,
    operation: () => Promise<Value>
): Promise<Value> {
    const current = currentExecutionOwner();
    if (
        current?.kind === 'attempt' && current.run === run && current.attempt.open() &&
        matchesAttempt(current.attempt, testCase, attempt)
    ) {
        return await operation();
    }
    const owner = {
        ...createLifetime(),
        identity: Symbol('execution attempt'),
        caseId: testCase.id,
        workId: testCase.workId,
        attempt
    };
    try {
        return await withExecutionOwner({ kind: 'attempt', run, attempt: owner }, operation);
    } finally {
        owner.close();
    }
}

export function createExecutionObservation(): ExecutionObservation {
    const current = currentExecutionOwner();
    const inherited = current?.kind === 'run' && current.run.open();
    const run = inherited ? current.run : createRunOwner();
    const lifetime = createLifetime();
    const unregister = run.register(lifetime.close);
    return {
        open: lifetime.open,
        accepts() {
            return lifetime.open() && ownsObservation(run, currentExecutionOwner());
        },
        hasActiveAttempt() {
            const owner = currentExecutionOwner();
            return owner?.kind === 'attempt' && owner.run === run && owner.run.open() && owner.attempt.open();
        },
        attribute(error) {
            return attributeObservation(error, run);
        },
        register: lifetime.register,
        async run(operation) {
            return await withExecutionOwner({ kind: 'run', run }, operation);
        },
        async runAttempt(testCase, attempt, operation) {
            return await runOwnedAttempt(run, testCase, attempt, operation);
        },
        stop() {
            unregister();
            try {
                lifetime.close();
            } finally {
                if (!inherited) {
                    run.close();
                }
            }
        }
    };
}

type FailureArtifactContext = {
    readonly policy: FailureArtifactPolicy;
    readonly samplingIntervalMilliseconds: number | null;
    readonly artifacts: StoredValue<readonly (BoundaryFailureArtifact | TestDebugArtifact)[]>;
};
const contextKey = Symbol.for('@overkill-dev/failure-artifact-context/v1');

function isFailureArtifactStorage(value: unknown): value is AsyncLocalStorage<FailureArtifactContext> {
    return value instanceof AsyncLocalStorage;
}

function sharedFailureArtifactStorage(): AsyncLocalStorage<FailureArtifactContext> {
    const existing: unknown = Reflect.get(globalThis, contextKey);
    if (isFailureArtifactStorage(existing)) {
        return existing;
    }
    const created = new AsyncLocalStorage<FailureArtifactContext>();
    Object.defineProperty(globalThis, contextKey, { value: created });
    return created;
}

const contexts = sharedFailureArtifactStorage();

export function withFailureArtifactContext<Value>(
    policy: FailureArtifactPolicy,
    operation: () => Value,
    samplingIntervalMilliseconds: number | null
): Value {
    return contexts.run({
        policy,
        samplingIntervalMilliseconds,
        artifacts: createStoredValue<readonly (BoundaryFailureArtifact | TestDebugArtifact)[]>([])
    }, function withFailureSerialization() {
        return withSerializationBudget(policy.serialization, operation);
    });
}

export function currentFailureArtifactPolicy(): FailureArtifactPolicy {
    return contexts.getStore()?.policy ?? defaultFailureArtifactPolicy;
}

export function recordExecutionArtifact(artifact: BoundaryFailureArtifact | TestDebugArtifact): void {
    const context = contexts.getStore();
    if (context !== undefined) {
        context.artifacts.write([ ...context.artifacts.read(), artifact ]);
    }
}

export function executionArtifacts(): readonly (BoundaryFailureArtifact | TestDebugArtifact)[] {
    return contexts.getStore()?.artifacts.read() ?? [];
}

export function caseExecutionArtifacts(
    work: WorkId,
    attempt: AttemptId
): readonly (BoundaryFailureArtifact | TestDebugArtifact)[] {
    return artifactsForAttempt(executionArtifacts(), work, attempt);
}

export function currentProcessUsageSamplingInterval(): number | null {
    return contexts.getStore()?.samplingIntervalMilliseconds ?? null;
}

export function recordBoundaryArtifact(artifact: BoundaryFailureArtifact): void {
    recordExecutionArtifact(artifact);
}
export function boundaryArtifacts(): readonly BoundaryFailureArtifact[] {
    return executionArtifacts().filter(function boundaryArtifact(artifact): artifact is BoundaryFailureArtifact {
        return artifact.payload.kind !== 'debug';
    });
}
export function caseBoundaryArtifacts(work: WorkId, attempt: AttemptId): readonly BoundaryFailureArtifact[] {
    return artifactsForAttempt(boundaryArtifacts(), work, attempt);
}
