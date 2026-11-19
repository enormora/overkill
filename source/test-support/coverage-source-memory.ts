import type { CoverageNativeBatch } from '../run/coverage-native-data.ts';
import type { CoverageSourceAccess } from '../run/coverage-source-selection.ts';
import { createCoverageSourceCache, type CoverageSourceCache } from '../run/coverage-runtime-source.ts';
import type { SourceMapData } from '../source-map-data.ts';

type MemoryCoverageSources = {
    readonly cache: CoverageSourceCache;
    readonly reads: readonly string[];
};
export function memoryCoverageSources(files: Readonly<Record<string, string>>): MemoryCoverageSources {
    const cache = createCoverageSourceCache();
    const reads: string[] = [];
    return {
        reads,
        cache: {
            inspect: cache.inspect,
            async read(path) {
                reads.push(path);
                const source = files[path];
                if (source === undefined) {
                    throw new Error(`Missing source ${path}`);
                }
                return source;
            }
        }
    };
}
export function coverageSourceMap(
    sources: readonly string[],
    sourcesContent: readonly (string | null)[]
): SourceMapData {
    return { version: 3, names: [], sources, sourcesContent, sourceRoot: '', mappings: 'AAAA', ignoreList: [] };
}

export function memoryCoverageAccess(
    files: Readonly<Record<string, string>>,
    batches: readonly CoverageNativeBatch[]
): CoverageSourceAccess {
    async function* enumerateFiles(): AsyncGenerator<string> {
        for (const file of Object.keys(files)) {
            yield file;
        }
    }
    return {
        cache: memoryCoverageSources(files).cache,
        async batches() {
            return batches;
        },
        files: enumerateFiles
    };
}
