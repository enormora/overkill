import { isAbsolute } from 'node:path';

const runProfileNamePattern = /^[A-Za-z0-9._-]+$/u;
const reservedBenchmarkProfileName = 'benchmark';

export function invalidRunProfileNameMessage(profileName: string): string | null {
    if (!runProfileNamePattern.test(profileName)) {
        return `Invalid profile name "${profileName}". ` +
            'Profile names may only contain letters, numbers, dots, underscores, and hyphens.';
    }

    if (profileName === reservedBenchmarkProfileName) {
        return 'Invalid profile name "benchmark". The "benchmark" profile name is reserved for benchmark commands.';
    }

    return null;
}

export function invalidRunProfileFileSetNameMessage(fileSetName: string): string | null {
    return runProfileNamePattern.test(fileSetName)
        ? null
        : `Invalid profile file set name "${fileSetName}". ` +
            'Profile file set names may only contain letters, numbers, dots, underscores, and hyphens.';
}

function globSegments(pattern: string): readonly string[] {
    return pattern.split(/[\\/]+/u);
}

function configMessage(message: string): string {
    return `Invalid ${message.charAt(0).toLowerCase()}${message.slice(1)}`;
}

export function invalidProfileFileGlobMessage(field: string, pattern: string): string | null {
    const trimmedPattern = pattern.trim();

    if (trimmedPattern.length === 0) {
        return `Profile files.${field} glob pattern must not be blank.`;
    }

    if (trimmedPattern.startsWith('!')) {
        return `Profile files.${field} negated glob patterns are not supported.`;
    }

    if (isAbsolute(pattern)) {
        return `Profile files.${field} glob pattern must be relative to cwd.`;
    }

    if (globSegments(pattern).includes('..')) {
        return `Profile files.${field} glob pattern must not contain parent segments.`;
    }

    return null;
}

export function invalidProfileFileGlobConfigMessage(field: string, pattern: string): string | null {
    const message = invalidProfileFileGlobMessage(field, pattern);

    return message === null ? null : configMessage(message);
}
