import { fileURLToPath } from 'node:url';
import type {
    ResolvableSourceLocation,
    SourceLocation,
    SourceLocationProvider
} from './assertion-node-shape.ts';

export const unknownSourceLocation: SourceLocation = {
    column: null,
    file: '',
    line: null
};

const stackFramePattern = /^\s*at (?:.+? \()?(?<file>.+):(?<line>\d+):(?<column>\d+)\)?$/u;

const internalModulePatterns = [
    /\/assertion-protocol\/source-location\.[cm]?[jt]s$/u,
    /\/assertion-protocol\/assertion-reference\.[cm]?[jt]s$/u,
    /\/engine\/assertion-facade\.[cm]?[jt]s$/u,
    /\/engine\/custom-assertion-recording\.[cm]?[jt]s$/u,
    /\/engine\/require-assertion-facade\.[cm]?[jt]s$/u
] as const;

function normalizeStackFile(file: string): string {
    if (!file.startsWith('file:')) {
        return file;
    }

    try {
        return fileURLToPath(file);
    } catch {
        return file;
    }
}

function stackFileIsInternal(file: string): boolean {
    if (file.length === 0 || file.startsWith('node:')) {
        return true;
    }

    const normalizedFile = file.replaceAll('\\', '/');

    return internalModulePatterns.some(function patternMatches(pattern) {
        return pattern.test(normalizedFile);
    });
}

type StackFrameGroups = {
    readonly column: string;
    readonly file: string;
    readonly line: string;
};

function sourceLocationFromStackGroups(groups: StackFrameGroups): SourceLocation | null {
    const file = normalizeStackFile(groups.file);
    return stackFileIsInternal(file)
        ? null
        : { column: Number(groups.column), file, line: Number(groups.line) };
}

function isStackFrameGroups(groups: Record<string, string | undefined>): groups is StackFrameGroups {
    return groups.file !== undefined && groups.line !== undefined && groups.column !== undefined;
}

function sourceLocationFromStackLine(line: string): SourceLocation | null {
    const groups = stackFramePattern.exec(line)?.groups;

    return groups !== undefined && isStackFrameGroups(groups)
        ? sourceLocationFromStackGroups(groups)
        : null;
}

export function sourceLocationFromStack(stack: string): SourceLocation {
    return stack.split('\n').reduce<SourceLocation | null>(function findLocation(found, line) {
        return found ?? sourceLocationFromStackLine(line);
    }, null) ?? unknownSourceLocation;
}

export function captureSourceLocation(): SourceLocationProvider {
    const stackCarrier = new Error('Overkill source location');
    let location: SourceLocation | null = null;

    return function capturedSourceLocation() {
        if (location === null) {
            location = sourceLocationFromStack(stackCarrier.stack ?? '');
        }

        return location;
    };
}

export function resolveSourceLocation(location: ResolvableSourceLocation): SourceLocation {
    if (typeof location !== 'function') {
        return location;
    }

    try {
        return location();
    } catch {
        return unknownSourceLocation;
    }
}
