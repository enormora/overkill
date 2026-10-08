import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TraceMap } from '@jridgewell/trace-mapping';
import { isPathInside } from './path-containment.ts';
import type { CoverageNativeBatch } from './coverage-native-data.ts';
import { isSupportedCoverageSource, type CoverageSourceCache } from './coverage-runtime-source.ts';
import { normalizedCoverageSourceMap, readCoverageSourceMap, type CoverageMap } from './coverage-source-map.ts';

type LoadedCoverageEntry = {
    readonly filePath: string;
    readonly map: TraceMap | null;
    readonly source: string;
    readonly url: string;
};
type LoadedCoverageRequest = {
    readonly cache: CoverageSourceCache;
    readonly batches: readonly CoverageNativeBatch[];
    readonly excludedFiles: ReadonlySet<string>;
    readonly includeSource: (filePath: string) => boolean;
    readonly projectRoot: string;
};
type LoadedCoverageSources = {
    readonly entries: ReadonlySet<string>;
    readonly excludedFiles: ReadonlySet<string>;
    readonly maps: ReadonlyMap<string, CoverageMap>;
    readonly sources: ReadonlySet<string>;
};

function projectScriptPath(url: string, projectRoot: string): string | null {
    if (!url.startsWith('file:')) {
        return null;
    }
    const filePath = fileURLToPath(url);
    const insideProject = isPathInside(projectRoot, filePath) && !filePath.split(path.sep).includes('node_modules');

    return insideProject && isSupportedCoverageSource(filePath) ? filePath : null;
}

async function readLoadedEntry(
    url: string,
    cached: unknown,
    projectRoot: string,
    cache: CoverageSourceCache
): Promise<LoadedCoverageEntry | null> {
    const filePath = projectScriptPath(url, projectRoot);

    if (filePath === null) {
        return null;
    }
    const source = await cache.read(filePath);
    const map = await readCoverageSourceMap({ cache, cached, source, url });

    return { filePath, map, source, url };
}

async function loadedCoverageEntries(request: LoadedCoverageRequest): Promise<readonly LoadedCoverageEntry[]> {
    const entries = new Map<string, LoadedCoverageEntry>();

    for (const batch of request.batches) {
        for (const entry of batch.entries) {
            const loaded = await readLoadedEntry(
                entry.url,
                batch.sourceMaps[entry.url],
                request.projectRoot,
                request.cache
            );

            if (loaded !== null) {
                entries.set(entry.url, loaded);
            }
        }
    }

    return Array.from(entries.values());
}

function singleOriginalTestFile(entry: LoadedCoverageEntry, excludedFiles: ReadonlySet<string>): string | null {
    if (!excludedFiles.has(entry.filePath) || entry.map === null) {
        return null;
    }
    const originals = entry.map.resolvedSources;
    const original = originals[0] ?? '';

    return originals.length === 1 && original.startsWith('file:') ? fileURLToPath(original) : null;
}

function originalTestFiles(entries: readonly LoadedCoverageEntry[], excludedFiles: ReadonlySet<string>): Set<string> {
    const files = new Set(excludedFiles);

    for (const entry of entries) {
        const original = singleOriginalTestFile(entry, excludedFiles);

        if (original !== null) {
            files.add(original);
        }
    }

    return files;
}

type CoverageOriginalSource = {
    readonly content: string | null;
    readonly url: string;
};
type SelectedCoverageSource = {
    readonly content: string;
    readonly filePath: string | null;
};
type SelectedCoverageEntry = {
    readonly map: CoverageMap | null;
    readonly sources: readonly string[];
    readonly url: string;
};

function selectedOriginalPath(url: string, request: LoadedCoverageRequest): string | null {
    if (!url.startsWith('file:')) {
        return null;
    }
    const filePath = fileURLToPath(url);

    return request.excludedFiles.has(filePath) || !request.includeSource(filePath) ? null : filePath;
}

async function originalSourceContent(
    original: CoverageOriginalSource,
    request: LoadedCoverageRequest
): Promise<SelectedCoverageSource> {
    const filePath = selectedOriginalPath(original.url, request);

    if (filePath === null) {
        return { content: original.content ?? '', filePath: null };
    }
    const content = original.content ?? await request.cache.read(filePath);
    const hasRuntime = isSupportedCoverageSource(filePath) && request.cache.inspect(content, filePath).hasRuntime;

    return { content, filePath: hasRuntime ? filePath : null };
}

async function selectLoadedEntry(
    entry: LoadedCoverageEntry,
    request: LoadedCoverageRequest
): Promise<SelectedCoverageEntry | null> {
    if (entry.map === null) {
        return request.includeSource(entry.filePath) && request.cache.inspect(entry.source, entry.filePath).hasRuntime
            ? { map: null, sources: [ entry.filePath ], url: entry.url }
            : null;
    }
    const { map } = entry;
    const originals = await Promise.all(map.resolvedSources.map(async function resolveOriginal(url, index) {
        return await originalSourceContent({ content: map.sourcesContent?.[index] ?? null, url }, request);
    }));

    return {
        map: normalizedCoverageSourceMap(
            map,
            originals.map(function originalContent(original) {
                return original.content;
            })
        ),
        sources: originals.flatMap(function executableOriginal(original) {
            return original.filePath === null ? [] : [ original.filePath ];
        }),
        url: entry.url
    };
}

export async function prepareLoadedCoverageSources(request: LoadedCoverageRequest): Promise<LoadedCoverageSources> {
    const loaded = await loadedCoverageEntries(request);
    const excludedFiles = originalTestFiles(loaded, request.excludedFiles);
    const selected = await Promise.all(loaded.map(async function selectEntry(entry) {
        return await selectLoadedEntry(entry, { ...request, excludedFiles });
    }));
    const retained = selected.filter(function isSelected(entry) {
        return entry !== null;
    });

    return {
        entries: new Set(retained.map(function entryUrl(entry) {
            return entry.url;
        })),
        excludedFiles,
        maps: new Map(retained.flatMap(function entryMap(entry) {
            return entry.map === null ? [] : [ [ entry.url, entry.map ] as const ];
        })),
        sources: new Set(retained.flatMap(function entrySources(entry) {
            return entry.sources;
        }))
    };
}
