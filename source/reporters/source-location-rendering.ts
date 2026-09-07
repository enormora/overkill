import type { SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';

export type RenderedSourceLocations = {
    readonly details: readonly string[];
    readonly primary: string | null;
};

type LocationDetailLabels = {
    readonly final: string;
    readonly intermediate: string;
};

const secondToLastOffset = 2;

export function formatSourceLocation(location: SourceLocation): string | null {
    if (location.file.length === 0) {
        return null;
    }

    if (location.line === null) {
        return location.file;
    }

    if (location.column === null) {
        return `${location.file}:${location.line}`;
    }

    return `${location.file}:${location.line}:${location.column}`;
}

function formatLocationChain(
    locations: readonly SourceLocation[],
    labels: LocationDetailLabels
): RenderedSourceLocations {
    const primaryLocation = locations[0];
    const primary = primaryLocation === undefined ? null : formatSourceLocation(primaryLocation);
    const details = locations.slice(1).flatMap(function renderSourceLocation(location, index) {
        const renderedLocation = formatSourceLocation(location);

        if (renderedLocation === null) {
            return [];
        }

        const label = index === locations.length - secondToLastOffset ? labels.final : labels.intermediate;

        return [ `${label} ${renderedLocation}` ];
    });

    return { details, primary };
}

export function formatDefinitionLocations(locations: readonly SourceLocation[]): RenderedSourceLocations {
    return formatLocationChain(locations, { final: 'constructed at', intermediate: 'expanded at' });
}

export function formatSourceLocations(locations: readonly SourceLocation[]): RenderedSourceLocations {
    return formatLocationChain(locations, { final: 'asserted at', intermediate: 'forwarded through' });
}
