import { z } from 'zod';
import type { RunResult } from '../engine/run-result.ts';
import type { RunnerResult } from './run-types.ts';

export function runnerResult(result: RunResult): RunnerResult {
    return {
        ...result,
        maintenanceDiagnostics: Object.hasOwn(result, 'maintenanceDiagnostics')
            ? z.array(z.string()).parse(Reflect.get(result, 'maintenanceDiagnostics'))
            : []
    };
}
