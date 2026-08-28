import { isAbsolute } from 'node:path';

export type ProfileFileGlobField = 'exclude' | 'include';

function globSegments(pattern: string): readonly string[] {
    return pattern.split(/[\\/]+/u);
}

function configMessage(message: string): string {
    return `Invalid ${message.charAt(0).toLowerCase()}${message.slice(1)}`;
}

export function invalidProfileFileGlobMessage(field: ProfileFileGlobField, pattern: string): string | null {
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

export function invalidProfileFileGlobConfigMessage(field: ProfileFileGlobField, pattern: string): string | null {
    const message = invalidProfileFileGlobMessage(field, pattern);

    return message === null ? null : configMessage(message);
}
