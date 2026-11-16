import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AnyMap, type TraceMap } from '@jridgewell/trace-mapping';
import convertSourceMap from 'convert-source-map';
import { z } from 'zod/v4';
import {
    sourceMapDataSchema as sourceMapSchema,
    validateSourceMapMappings as validateMappings,
    type SourceMapData
} from '../source-map-data.ts';
import type { CoverageSourceCache } from './coverage-runtime-source.ts';

export type CoverageMap = SourceMapData;
const cachedMapSchema = z.object({ data: z.unknown().default(null) });

type CoverageMapRequest = {
    readonly cache: CoverageSourceCache;
    readonly cached: unknown;
    readonly source: string;
    readonly url: string;
};

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
