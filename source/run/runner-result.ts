import { z } from 'zod';
import type { RunResult } from '../engine/run-result.ts';
import { parseRunResult } from './run-result-schema.ts';
import type { RunnerResult } from './run-types.ts';

const contextSchema = z.object({
    id: z.string().nullable(),
    startedAt: z.string().nullable(),
    facts: z.record(z.string(), z.unknown()).nullable()
});

export function runnerResult(result: RunResult): RunnerResult {
    const context = Object.hasOwn(result, 'context')
        ? contextSchema.parse(Reflect.get(result, 'context'))
        : { id: null, startedAt: null, facts: result.preparationFacts };
    return {
        ...result,
        context,
        maintenanceDiagnostics: Object.hasOwn(result, 'maintenanceDiagnostics')
            ? z.array(z.string()).parse(Reflect.get(result, 'maintenanceDiagnostics'))
            : []
    };
}

export function parseRunnerResult(value: unknown): RunnerResult {
    const { maintenanceDiagnostics, context, ...result } = z
        .looseObject({
            context: contextSchema,
            maintenanceDiagnostics: z.array(z.string())
        })
        .parse(value);
    return { ...parseRunResult(result), context, maintenanceDiagnostics };
}
