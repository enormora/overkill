import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { invalidRequest } from './run-errors.ts';
import type {
    RunHostProcess,
    RunHostProcessFacts,
    RunHostProcessReason
} from './run-types.ts';

const deniedNodeArgumentNames = new Set([
    '--env-file',
    '--eval',
    '--experimental-loader',
    '--import',
    '--loader',
    '--print',
    '--require',
    '--run',
    '--test',
    '--watch'
]);

function nodeArgumentName(argument: string): string {
    const assignmentIndex = argument.indexOf('=');

    return assignmentIndex === -1 ? argument : argument.slice(0, assignmentIndex);
}

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

function validateNodeArgument(argument: string): void {
    if (argument.length === 0) {
        invalidRequest('Host process Node argument must not be empty.');
    }

    if (argument.includes('\n') || argument.includes('\0')) {
        invalidRequest('Host process Node argument must stay on one command-line token.');
    }

    if (!argument.startsWith('--')) {
        invalidRequest(`Host process Node argument must use long-form syntax: ${argument}`);
    }

    const argumentName = nodeArgumentName(argument);

    if (deniedNodeArgumentNames.has(argumentName)) {
        invalidRequest(`Host process Node argument is not supported: ${argumentName}`);
    }
}

export function validateHostProcess(hostProcess: RunHostProcess): void {
    if (hostProcess.kind === 'direct') {
        return;
    }

    for (const argument of hostProcess.nodeArguments) {
        validateNodeArgument(argument);
    }
}

export function hostProcessFacts(hostProcess: RunHostProcess): RunHostProcessFacts {
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
