import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { validateHostProcess } from '../config/host-process.ts';
import type { HostProcess } from '../config/types.ts';
import type { RunHostProcessFacts, RunHostProcessReason } from './run-types.ts';

function isInspectArgument(argument: string): boolean {
    return argument === '--inspect' ||
        argument.startsWith('--inspect=') ||
        argument === '--inspect-brk' ||
        argument.startsWith('--inspect-brk=') ||
        argument === '--inspect-wait' ||
        argument.startsWith('--inspect-wait=');
}

function isProfilingArgument(argument: string): boolean {
    return argument === '--prof' ||
        argument.startsWith('--prof-') ||
        argument === '--cpu-prof' ||
        argument.startsWith('--cpu-prof-') ||
        argument === '--heap-prof' ||
        argument.startsWith('--heap-prof-');
}

function uniqueReasons(
    reasons: readonly RunHostProcessReason[]
): NonEmptyReadonlyArray<RunHostProcessReason> {
    const [ first = 'host-isolation', ...rest ] = Array.from(new Set(reasons));

    return [ first, ...rest ];
}

function nodeArgumentReasons(argument: string): readonly RunHostProcessReason[] {
    return [
        ...argument === '--expose-gc' ? [ 'forced-garbage-collection' as const ] : [],
        ...isInspectArgument(argument) ? [ 'debugging' as const ] : [],
        ...isProfilingArgument(argument) ? [ 'profiling' as const ] : []
    ];
}

function childHostReasons(nodeArguments: readonly string[]): NonEmptyReadonlyArray<RunHostProcessReason> {
    const baseReason = nodeArguments.length === 0 ? 'host-isolation' : 'node-arguments';

    return uniqueReasons([
        baseReason,
        ...nodeArguments.flatMap(nodeArgumentReasons)
    ]);
}

export function hostProcessFacts(hostProcess: HostProcess): RunHostProcessFacts {
    validateHostProcess(hostProcess);

    if (hostProcess.kind === 'direct') {
        return { kind: 'direct' };
    }

    return {
        kind: 'child',
        nodeArguments: Array.from(hostProcess.nodeArguments),
        reasons: childHostReasons(hostProcess.nodeArguments)
    };
}
