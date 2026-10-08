import path from 'node:path';
import { readFile } from 'node:fs/promises';
// eslint-disable-next-line node/no-unsupported-features/node-builtins -- Match native V8 offsets.
import { stripTypeScriptTypes } from 'node:module';
import type { V8CoverageEntry } from 'monocart-coverage-reports';
import { coverageLexemes, coverageTokens, isCoverageToken, type CoverageToken } from './coverage-tokens.ts';
import { createCoverageMethodNormalizer } from './coverage-method-ranges.ts';

const typeScriptExtensions = new Set([ '.cts', '.mts', '.ts' ]);
const sourceExtensions = new Set([ '.cjs', '.cts', '.js', '.mjs', '.mts', '.ts' ]);

export function isTypeScriptCoverageSource(filePath: string): boolean {
    return typeScriptExtensions.has(path.extname(filePath));
}

export function isSupportedCoverageSource(filePath: string): boolean {
    return sourceExtensions.has(path.extname(filePath));
}

function emptyModuleMarker(tokens: Iterator<CoverageToken, undefined>): boolean {
    return tokens.next().value?.value === '{' && tokens.next().value?.value === '}';
}

function hasRuntime(tokens: Iterator<CoverageToken, undefined>): boolean {
    for (let token = tokens.next().value; token !== undefined; token = tokens.next().value) {
        if (token.value !== ';' && (token.value !== 'export' || !emptyModuleMarker(tokens))) {
            return true;
        }
    }
    return false;
}

type CoverageSource = {
    readonly source: string;
    readonly hasRuntime: boolean;
    readonly comments: readonly string[];
    readonly normalize: ReturnType<typeof createCoverageMethodNormalizer>;
};
export type CoverageSourceCache = {
    readonly read: (filePath: string) => Promise<string>;
    readonly inspect: (source: string, filePath: string) => CoverageSource;
};

function createCoverageSource(source: string, filePath: string): CoverageSource {
    const runtimeSource = isTypeScriptCoverageSource(filePath)
        ? stripTypeScriptTypes(source, { mode: 'strip' })
        : source;
    let runtime: boolean | null = null;
    let lexemes: readonly CoverageToken[] | null = null;
    let normalize: ReturnType<typeof createCoverageMethodNormalizer> | null = null;

    function sourceLexemes(): readonly CoverageToken[] {
        lexemes = lexemes ?? Array.from(coverageLexemes(runtimeSource));
        return lexemes;
    }

    return {
        source: runtimeSource,
        get hasRuntime() {
            runtime = runtime ?? hasRuntime(
                lexemes === null ? coverageTokens(runtimeSource) : lexemes.filter(isCoverageToken).values()
            );
            return runtime;
        },
        get comments() {
            return sourceLexemes()
                .filter(function isComment(token) {
                    return token.type === 'MultiLineComment' || token.type === 'SingleLineComment';
                })
                .map(function commentText(token) {
                    return token.value;
                });
        },
        normalize(functions) {
            normalize = normalize ?? createCoverageMethodNormalizer(sourceLexemes().filter(isCoverageToken));
            return normalize(functions);
        }
    };
}

export function createCoverageSourceCache(): CoverageSourceCache {
    const files = new Map<string, Promise<string>>();
    const sources = new Map<string, Map<string, CoverageSource>>();

    return {
        async read(filePath) {
            const content = files.get(filePath) ?? readFile(filePath, 'utf8');

            files.set(filePath, content);
            return content;
        },
        inspect(source, filePath) {
            const versions = sources.get(filePath) ?? new Map<string, CoverageSource>();
            const inspection = versions.get(source) ?? createCoverageSource(source, filePath);

            versions.set(source, inspection);
            sources.set(filePath, versions);
            return inspection;
        }
    };
}

export function prepareNativeTypeScriptCoverage(entry: V8CoverageEntry, source: CoverageSource): void {
    const functions = source.normalize(entry.functions);

    Object.assign(entry, { fake: false, functions, source: source.source });
}
