import type { SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';

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
