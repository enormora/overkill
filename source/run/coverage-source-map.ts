import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
    AnyMap,
    decodedMappings,
    encodedMappings,
    type SourceMapSegment,
    type TraceMap
} from '@jridgewell/trace-mapping';
import convertSourceMap from 'convert-source-map';
import { z } from 'zod/v4';
import type { CoverageSourceCache } from './coverage-runtime-source.ts';

const sourceMapVersion = 3;
const namedMappingSize = 5;
export type CoverageMap = {
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
        readonly map: CoverageMap;
    }[];
};

const sourceMapSchema: z.ZodType<CoverageMap> = z.lazy(function coverageMapSchema() {
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
                map: sourceMapSchema,
                offset: z.object({ column: z.number().int().nonnegative(), line: z.number().int().nonnegative() })
            })),
            version: z.literal(sourceMapVersion)
        })
    ]);
});
const cachedMapSchema = z.object({ data: z.unknown().default(null) });

type CoverageMapRequest = {
    readonly cache: CoverageSourceCache;
    readonly cached: unknown;
    readonly source: string;
    readonly url: string;
};

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

function validateMappings(map: TraceMap, hasRuntime: boolean): void {
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

async function readMapContent(url: URL): Promise<string> {
    if (url.protocol === 'file:') {
        return await readFile(url, 'utf8');
    }
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Source map ${url.href} returned HTTP ${response.status}.`);
    }
    return await response.text();
}

async function readReferencedMap(url: URL): Promise<TraceMap> {
    const content = await readMapContent(url);

    return new AnyMap(sourceMapSchema.parse(JSON.parse(content)), url.href);
}

async function readMapReference(reference: string, scriptUrl: string): Promise<TraceMap> {
    const url = new URL(reference, scriptUrl);

    try {
        return await readReferencedMap(url);
    } catch (error: unknown) {
        throw new Error(`Source map ${url.href} failed: ${String(error)}`, { cause: error });
    }
}

async function declaredCoverageMap(request: CoverageMapRequest): Promise<TraceMap | null> {
    const inspection = request.cache.inspect(request.source, fileURLToPath(request.url));
    const comments = inspection.comments.join('\n');
    const inline = convertSourceMap.fromSource(comments);

    if (inline !== null) {
        return new AnyMap(sourceMapSchema.parse(inline.toObject()), request.url);
    }
    const references = Array.from(comments.matchAll(convertSourceMap.mapFileCommentRegex));
    const [ , lineReference, blockReference ] = references.at(-1) ?? [];
    const reference = lineReference ?? blockReference;

    return reference === undefined ? null : await readMapReference(reference, request.url);
}

async function resolveCoverageMap(request: CoverageMapRequest): Promise<TraceMap | null> {
    const declared = await declaredCoverageMap(request);

    if (declared !== null) {
        return declared;
    }
    const cached = cachedMapSchema.parse(request.cached ?? {});

    return cached.data === null ? null : new AnyMap(sourceMapSchema.parse(cached.data), request.url);
}

async function resolveValidatedCoverageMap(request: CoverageMapRequest): Promise<TraceMap | null> {
    const map = await resolveCoverageMap(request);

    if (map !== null) {
        validateMappings(map, request.cache.inspect(request.source, fileURLToPath(request.url)).hasRuntime);
    }
    return map;
}

export async function readCoverageSourceMap(request: CoverageMapRequest): Promise<TraceMap | null> {
    try {
        return await resolveValidatedCoverageMap(request);
    } catch (error: unknown) {
        throw new Error(`Coverage source map failed for ${request.url}: ${String(error)}`, { cause: error });
    }
}

export function normalizedCoverageSourceMap(map: TraceMap, sourcesContent: readonly string[]): CoverageMap {
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
