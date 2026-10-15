import { z } from 'zod/v4';
import { INSTRUMENTER_CONSTANTS, type InstrumenterContext } from '@stryker-mutator/api/core';
import { mutantCoverageSchema } from './mutation-catalog.ts';

const contextSchema = z.object({
    activeMutant: z.string().optional(),
    currentTestId: z.string().optional(),
    mutantCoverage: mutantCoverageSchema.optional(),
    hitCount: z.number().optional(),
    hitLimit: z.number().optional()
});

type InvocationInstrumentation = {
    readonly context: InstrumenterContext;
    readonly activate: (mutantId: string, hitLimit: number | null) => void;
    readonly dispose: () => void;
};

function throwResetFailures(failures: readonly unknown[]): void {
    if (failures.length === 1) {
        throw failures[0];
    }
    if (failures.length > 1) {
        throw new AggregateError(failures, 'Stryker instrumentation reset failed.', { cause: failures[0] });
    }
}

function attemptInstrumentationReset(reset: () => void): readonly unknown[] {
    try {
        reset();
        return [];
    } catch (error: unknown) {
        return [ error ];
    }
}

function deleteInstrumentationProperty(target: unknown, key: string): void {
    if (typeof target === 'object' && target !== null && !Reflect.deleteProperty(target, key)) {
        throw new Error(`Stryker instrumentation cannot reset "${key}".`);
    }
}

function deleteInstrumentationProperties(target: unknown, keys: readonly string[]): readonly unknown[] {
    return keys.flatMap(function resetProperty(key) {
        return attemptInstrumentationReset(function () {
            deleteInstrumentationProperty(target, key);
        });
    });
}

function clearInvocationState(context: unknown): readonly unknown[] {
    return [
        ...deleteInstrumentationProperties(context, [ 'currentTestId', 'activeMutant', 'hitCount', 'hitLimit' ]),
        ...attemptInstrumentationReset(function clearActivationEnvironment() {
            const key = INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE;
            if (process.env[key] !== undefined) {
                deleteInstrumentationProperty(process.env, key);
            }
        })
    ];
}

function failAfterCleanup(error: unknown, context: unknown): never {
    const failures = clearInvocationState(context);
    if (failures.length > 0) {
        throw new AggregateError([ error, ...failures ], 'Stryker instrumentation reset failed.', { cause: error });
    }
    throw error;
}

function resetInvocationCounters(context: InstrumenterContext): readonly unknown[] {
    const failures: unknown[] = [];
    failures.push(...attemptInstrumentationReset(function resetCoverage() {
        const coverage = context.mutantCoverage;
        if (coverage === undefined) {
            return;
        }
        for (const bucket of [ 'static', 'perTest' ] as const) {
            failures.push(...attemptInstrumentationReset(function resetBucket() {
                const counters = coverage[bucket];
                failures.push(...deleteInstrumentationProperties(counters, Object.keys(counters)));
            }));
        }
    }));
    return failures;
}

function isInstrumenterContext(value: unknown): value is InstrumenterContext {
    return contextSchema.safeParse(value).success;
}

function retainedContext(existing: unknown): InstrumenterContext {
    if (existing === undefined) {
        const context: InstrumenterContext = {};
        if (!Reflect.set(globalThis, INSTRUMENTER_CONSTANTS.NAMESPACE, context)) {
            throw new Error('Stryker instrumentation namespace cannot be initialized.');
        }
        return context;
    }
    if (!isInstrumenterContext(existing)) {
        throw new TypeError('Invalid Stryker instrumentation namespace.');
    }
    return existing;
}

function prepareInstrumentation(existing: unknown): InstrumenterContext {
    const context = retainedContext(existing);
    if (
        context.mutantCoverage === undefined &&
        !Reflect.set(context, 'mutantCoverage', { static: {}, perTest: {} })
    ) {
        throw new Error('Stryker instrumentation coverage cannot be initialized.');
    }
    return context;
}

function instrumenterContext(): InstrumenterContext {
    let existing: unknown = null;
    try {
        existing = Reflect.get(globalThis, INSTRUMENTER_CONSTANTS.NAMESPACE);
        return prepareInstrumentation(existing);
    } catch (error: unknown) {
        return failAfterCleanup(error, existing);
    }
}

export function createInvocationInstrumentation(): InvocationInstrumentation {
    const context = instrumenterContext();
    throwResetFailures([ ...resetInvocationCounters(context), ...clearInvocationState(context) ]);
    return {
        context,
        activate(mutantId, hitLimit) {
            const failures = attemptInstrumentationReset(function installActivation() {
                context.activeMutant = mutantId;
                if (hitLimit !== null) {
                    context.hitCount = 0;
                    context.hitLimit = hitLimit;
                }
            });
            if (failures.length > 0) {
                failAfterCleanup(failures[0], context);
            }
        },
        dispose() {
            throwResetFailures(clearInvocationState(context));
        }
    };
}

export function isStrykerWorker(): boolean {
    return process.env.STRYKER_MUTATOR_WORKER !== undefined;
}
