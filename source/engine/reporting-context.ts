import path from 'node:path';
import type { KnownSourceLocation, SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import { ensureKnownSourceLocation, ensureValidSourceLocation } from '../assertion-protocol/source-location.ts';

export type ReportingContext = {
    readonly relativizeLocationPath: (location: KnownSourceLocation) => string;
};

export type RenderedSourceLocations = {
    readonly details: readonly string[];
    readonly primary: string | null;
};

type ReportingContextState = {
    readonly projectRoot: string | null;
};

type LocationDetailLabels = {
    readonly final: string;
    readonly intermediate: string;
};

const secondToLastOffset = 2;

function normalizedPath(file: string): string {
    return file.replaceAll('\\', '/');
}

function pathApi(file: string): typeof path.posix {
    return path.win32.isAbsolute(file) ? path.win32 : path.posix;
}

function isAbsolutePath(file: string): boolean {
    return path.posix.isAbsolute(file) || path.win32.isAbsolute(file);
}

function isOutsideRoot(relativeFile: string): boolean {
    return relativeFile === '..' ||
        relativeFile.startsWith('../') ||
        relativeFile.startsWith('..\\') ||
        isAbsolutePath(relativeFile);
}

function rawLocationPath(location: KnownSourceLocation): string {
    ensureValidSourceLocation(location);

    return normalizedPath(location.file);
}

export function relativizeSourceLocationPath(
    location: KnownSourceLocation,
    projectRoot: string | null
): string {
    ensureValidSourceLocation(location);

    if (projectRoot === null || !isAbsolutePath(location.file) || !isAbsolutePath(projectRoot)) {
        return rawLocationPath(location);
    }

    const platformPath = pathApi(location.file);
    const relativeFile = platformPath.relative(projectRoot, location.file);

    return relativeFile.length > 0 && !isOutsideRoot(relativeFile)
        ? normalizedPath(relativeFile)
        : rawLocationPath(location);
}

export function createReportingContext(state: ReportingContextState): ReportingContext {
    return {
        relativizeLocationPath(location) {
            return relativizeSourceLocationPath(location, state.projectRoot);
        }
    };
}

export function formatSourceLocation(location: SourceLocation, context: ReportingContext): string | null {
    const knownLocation = ensureKnownSourceLocation(location);

    if (knownLocation === null) {
        return null;
    }

    const file = context.relativizeLocationPath(knownLocation);

    if (knownLocation.line === null) {
        return file;
    }

    if (knownLocation.column === null) {
        return `${file}:${knownLocation.line}`;
    }

    return `${file}:${knownLocation.line}:${knownLocation.column}`;
}

function formatLocationChain(
    locations: readonly SourceLocation[],
    context: ReportingContext,
    labels: LocationDetailLabels
): RenderedSourceLocations {
    const primaryLocation = locations[0];
    const primary = primaryLocation === undefined ? null : formatSourceLocation(primaryLocation, context);
    const details = locations.slice(1).flatMap(function renderSourceLocation(location, index) {
        const renderedLocation = formatSourceLocation(location, context);

        if (renderedLocation === null) {
            return [];
        }

        const label = index === locations.length - secondToLastOffset ? labels.final : labels.intermediate;

        return [ `${label} ${renderedLocation}` ];
    });

    return { details, primary };
}

export function formatDefinitionLocations(
    locations: readonly SourceLocation[],
    context: ReportingContext
): RenderedSourceLocations {
    return formatLocationChain(locations, context, { final: 'constructed at', intermediate: 'expanded at' });
}

export function formatAssertionSourceLocations(
    locations: readonly SourceLocation[],
    context: ReportingContext
): RenderedSourceLocations {
    return formatLocationChain(locations, context, { final: 'asserted at', intermediate: 'forwarded through' });
}
