import { decodedMappings, encodedMappings, type SourceMapSegment, type TraceMap } from '@jridgewell/trace-mapping';
import { z } from 'zod/v4';

export const sourceMapVersion = 3;
export type SourceMapData = {
    readonly version: typeof sourceMapVersion;
    readonly names: readonly string[];
    readonly sources: readonly (string | null)[];
    readonly sourcesContent: readonly (string | null)[];
    readonly sourceRoot: string;
    readonly mappings: string;
    readonly ignoreList: readonly number[];
} | {
    readonly version: typeof sourceMapVersion;
    readonly sections: readonly {
        readonly offset: { readonly line: number; readonly column: number; };
        readonly map: SourceMapData;
    }[];
};

export const sourceMapDataSchema: z.ZodType<SourceMapData> = z.lazy(function coverageMapSchema() {
    return z.union([
        z.object({
            ignoreList: z.array(z.number().int().nonnegative()).default([]),
            mappings: z.string().regex(/^[A-Za-z0-9+/;,]*$/u),
            names: z.array(z.string()).default([]),
            sourceRoot: z.string().default(''),
            sources: z.array(z.string().nullable()),
            sourcesContent: z.array(z.string().nullable()).default([]),
            version: z.literal(sourceMapVersion)
        }),
        z.object({
            sections: z.array(z.object({
                map: sourceMapDataSchema,
                offset: z.object({ column: z.number().int().nonnegative(), line: z.number().int().nonnegative() })
            })),
            version: z.literal(sourceMapVersion)
        })
    ]);
});

const namedMappingSize = 5;

function validMappingSegment(segment: SourceMapSegment, map: TraceMap): boolean {
    if (
        segment.some(function invalidCoordinate(value) {
            return !Number.isSafeInteger(value) || value < 0;
        })
    ) {
        return false;
    }
    if (segment.length === 1) {
        return true;
    }
    const source = segment[1];
    const name = segment.length === namedMappingSize ? segment.at(-1) : undefined;

    return source < map.sources.length && (name === undefined || name < map.names.length);
}

export function validateSourceMapMappings(map: TraceMap, hasRuntime: boolean): void {
    const mappings = decodedMappings(map);
    const segments = mappings.flat();
    const valid = segments.every(function validSegment(segment) {
        return validMappingSegment(segment, map);
    });
    const hasOriginal = segments.some(function mapsOriginal(segment) {
        return segment.length > 1;
    });

    if (!valid || hasRuntime && !hasOriginal) {
        throw new Error('Source map has no usable original mappings.');
    }
}

export function normalizedSourceMap(map: TraceMap, sourcesContent: readonly (string | null)[]): SourceMapData {
    return {
        ignoreList: map.ignoreList ?? [],
        mappings: encodedMappings(map),
        names: map.names,
        sourceRoot: '',
        sources: map.resolvedSources,
        sourcesContent: Array.from(sourcesContent),
        version: sourceMapVersion
    };
}
