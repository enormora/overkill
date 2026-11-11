import { parseArgs } from 'node:util';
import { parseDebugRequest } from './run-debug.ts';
import { invalidRequest } from './run-errors.ts';
import type { RunDebugRequest } from './run-types.ts';

type ReplayDebugArguments = { readonly debug: RunDebugRequest; readonly operands: readonly string[]; };
function readReplayDebugArguments(args: readonly string[]): ReplayDebugArguments {
    const parsed = parseArgs({
        args: Array.from(args),
        allowPositionals: true,
        options: { debug: { type: 'boolean' }, 'debug-scope': { type: 'string', multiple: true } }
    });
    return {
        debug: parseDebugRequest(parsed.values.debug ?? false, parsed.values['debug-scope'] ?? []),
        operands: parsed.positionals
    };
}
export function parseReplayDebugArguments(args: readonly string[]): ReplayDebugArguments {
    try {
        return readReplayDebugArguments(args);
    } catch (error: unknown) {
        return invalidRequest(error instanceof Error ? error.message : String(error));
    }
}
