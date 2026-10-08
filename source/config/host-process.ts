import { ConfigError } from './config-error.ts';
import type { HostProcess } from './types.ts';

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

function validateNodeArgument(argument: string): void {
    if (argument.length === 0) {
        throw new ConfigError('Host process Node argument must not be empty.');
    }

    if (argument.includes('\n') || argument.includes('\0')) {
        throw new ConfigError('Host process Node argument must stay on one command-line token.');
    }

    if (!argument.startsWith('--')) {
        throw new ConfigError(`Host process Node argument must use long-form syntax: ${argument}`);
    }

    const argumentName = nodeArgumentName(argument);

    if (deniedNodeArgumentNames.has(argumentName)) {
        throw new ConfigError(`Host process Node argument is not supported: ${argumentName}`);
    }
}

export function validateHostProcess(hostProcess: HostProcess): void {
    if (hostProcess.kind === 'direct') {
        return;
    }

    for (const argument of hostProcess.nodeArguments) {
        validateNodeArgument(argument);
    }
}
