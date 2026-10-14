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

function isInstrumenterContext(value: unknown): value is InstrumenterContext {
    return contextSchema.safeParse(value).success;
}
function clearCounters(counters: Readonly<Record<string, unknown>>): void {
    for (const key of Object.keys(counters)) {
        if (!Reflect.deleteProperty(counters, key)) {
            throw new Error('Stryker instrumentation counters cannot be reset.');
        }
    }
}
export function clearMutantActivation(context: InstrumenterContext): void {
    for (const key of [ 'currentTestId', 'activeMutant', 'hitCount', 'hitLimit' ]) {
        if (!Reflect.deleteProperty(context, key)) {
            throw new Error('Stryker instrumentation activation cannot be reset.');
        }
    }
}
export function clearActiveMutantEnvironment(): void {
    if (process.env[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE] !== undefined) {
        Reflect.deleteProperty(process.env, INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE);
    }
}
function instrumenterContext(): InstrumenterContext {
    const existing: unknown = Reflect.get(globalThis, INSTRUMENTER_CONSTANTS.NAMESPACE);
    if (existing === undefined) {
        const context: InstrumenterContext = {};
        Reflect.set(globalThis, INSTRUMENTER_CONSTANTS.NAMESPACE, context);
        return context;
    }
    if (!isInstrumenterContext(existing)) {
        throw new TypeError('Invalid Stryker instrumentation namespace.');
    }
    return existing;
}
export function initializeInstrumentation(): InstrumenterContext {
    const context = instrumenterContext();
    context.mutantCoverage = context.mutantCoverage ?? { static: {}, perTest: {} };
    clearCounters(context.mutantCoverage.static);
    clearCounters(context.mutantCoverage.perTest);
    clearMutantActivation(context);
    clearActiveMutantEnvironment();
    return context;
}
export function isStrykerWorker(): boolean {
    return process.env.STRYKER_MUTATOR_WORKER !== undefined;
}
