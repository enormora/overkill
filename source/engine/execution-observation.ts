import { AsyncLocalStorage } from 'node:async_hooks';
import type { AttemptId, CaseId, WorkId } from './identity.ts';
import type { RunnerError } from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';

type ObservationLifetime = {
    readonly open: () => boolean;
    readonly close: () => void;
    readonly register: (dispose: () => void) => () => void;
};

type RunOwner = ObservationLifetime & { readonly identity: symbol; };
type AttemptOwner = ObservationLifetime & {
    readonly identity: symbol;
    readonly caseId: CaseId;
    readonly workId: WorkId;
    readonly attempt: AttemptId;
};

type ObservationOwner = {
    readonly kind: 'attempt';
    readonly run: RunOwner;
    readonly attempt: AttemptOwner;
} | {
    readonly kind: 'infrastructure';
    readonly run: RunOwner | null;
} | {
    readonly kind: 'run';
    readonly run: RunOwner;
};

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

const observationKey = Symbol.for('@overkill-dev/engine/executionObservation');

function isObservationStorage(value: unknown): value is AsyncLocalStorage<ObservationOwner> {
    return value instanceof AsyncLocalStorage;
}

function sharedObservationStorage(): AsyncLocalStorage<ObservationOwner> {
    const existing: unknown = Reflect.get(globalThis, observationKey);
    if (isObservationStorage(existing)) {
        return existing;
    }
    const created = new AsyncLocalStorage<ObservationOwner>();
    Reflect.set(globalThis, observationKey, created);
    return created;
}

const ownership = sharedObservationStorage();

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

export function observingInfrastructure(): boolean {
    return ownership.getStore()?.kind === 'infrastructure';
}

export function currentAttemptIdentity(): symbol | null {
    const owner = ownership.getStore();
    if (owner?.kind !== 'attempt' || !owner.run.open() || !owner.attempt.open()) {
        return null;
    }
    const identity: unknown = Reflect.get(owner.attempt, 'identity');
    return typeof identity === 'symbol' ? identity : null;
}

export function registerExecutionDisposal(dispose: () => void): () => void {
    const run = ownership.getStore()?.run;
    if (run === null || run === undefined) {
        return function unregisterUnownedDisposal() {
            return undefined;
        };
    }
    return run.register(dispose);
}

export function withRunnerInfrastructure<Value>(operation: () => Value): Value {
    return ownership.run({ kind: 'infrastructure', run: ownership.getStore()?.run ?? null }, operation);
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
    const current = ownership.getStore();
    if (current?.kind === 'run' && current.run.open()) {
        return await operation();
    }
    const run = createRunOwner();
    try {
        const result = await ownership.run({ kind: 'run', run }, operation);
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
    const owner = ownership.getStore();
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
    const current = ownership.getStore();
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
        return await ownership.run({ kind: 'attempt', run, attempt: owner }, operation);
    } finally {
        owner.close();
    }
}

export function createExecutionObservation(): ExecutionObservation {
    const current = ownership.getStore();
    const inherited = current?.kind === 'run' && current.run.open();
    const run = inherited ? current.run : createRunOwner();
    const lifetime = createLifetime();
    const unregister = run.register(lifetime.close);
    return {
        open: lifetime.open,
        accepts() {
            return lifetime.open() && ownsObservation(run, ownership.getStore());
        },
        hasActiveAttempt() {
            const owner = ownership.getStore();
            return owner?.kind === 'attempt' && owner.run === run && owner.run.open() && owner.attempt.open();
        },
        attribute(error) {
            return attributeObservation(error, run);
        },
        register: lifetime.register,
        async run(operation) {
            return await ownership.run({ kind: 'run', run }, operation);
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
