import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { createRunDiscovery } from '../run/run-discovery.ts';
import type { RunDiscovery } from '../run/run-discovery-types.ts';

type VirtualRunDiscoveryInput = {
    readonly cwd: string;
    readonly directories: readonly string[];
    readonly files: readonly string[];
    readonly realpaths: Readonly<Record<string, string>>;
};

type VirtualEntryKind = 'directory' | 'file';

function absolutePath(cwd: string, path: string): string {
    return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

function parentDirectories(cwd: string, file: string): readonly string[] {
    const directories: string[] = [];
    let directory = dirname(file);

    while (directory.startsWith(cwd)) {
        directories.push(directory);
        directory = dirname(directory);
    }

    return directories;
}

function createEntries(input: VirtualRunDiscoveryInput): ReadonlyMap<string, VirtualEntryKind> {
    const directories = new Set([
        resolve(input.cwd),
        ...input.directories.map(function toAbsoluteDirectory(path) {
            return absolutePath(input.cwd, path);
        })
    ]);
    const files = input.files.map(function toAbsoluteFile(path) {
        return absolutePath(input.cwd, path);
    });

    for (const file of files) {
        const directoriesForFile = parentDirectories(resolve(input.cwd), file);

        for (const directory of directoriesForFile) {
            directories.add(directory);
        }
    }

    return new Map([
        ...Array.from(directories, function directoryEntry(path): readonly [string, VirtualEntryKind] {
            return [ path, 'directory' ];
        }),
        ...Array.from(files, function fileEntry(path): readonly [string, VirtualEntryKind] {
            return [ path, 'file' ];
        })
    ]);
}

function relativeFile(cwd: string, file: string): string {
    return relative(cwd, file).replaceAll('\\', '/');
}

function recursiveTestPatternMatches(pattern: string, file: string): boolean {
    const marker = '**/*.test.ts';

    if (!pattern.endsWith(marker)) {
        return false;
    }

    return file.startsWith(pattern.slice(0, -marker.length)) && file.endsWith('.test.ts');
}

function recursivePatternMatches(pattern: string, file: string): boolean {
    const marker = '**';

    if (!pattern.endsWith(marker)) {
        return false;
    }

    return file.startsWith(pattern.slice(0, -marker.length));
}

function patternMatches(pattern: string, file: string): boolean {
    return pattern === file || recursiveTestPatternMatches(pattern, file) || recursivePatternMatches(pattern, file);
}

async function* asyncMatches(matches: readonly string[]): AsyncIterable<string> {
    for (const match of matches) {
        yield match;
    }
}

function globPatterns(pattern: string | readonly string[]): readonly string[] {
    return typeof pattern === 'string' ? [ pattern ] : pattern;
}

export function createVirtualRunDiscovery(input: VirtualRunDiscoveryInput): RunDiscovery {
    const cwd = resolve(input.cwd);
    const entries = createEntries(input);
    const realpaths = new Map(
        Object.entries(input.realpaths).map(function toAbsoluteEntry([ source, target ]) {
            return [ absolutePath(cwd, source), absolutePath(cwd, target) ];
        })
    );

    return createRunDiscovery({
        glob(pattern, options) {
            const patterns = globPatterns(pattern);
            const matches = Array
                .from(entries, function toRelativeEntry([ path ]) {
                    return relativeFile(options.cwd, path);
                })
                .filter(function isIncluded(path) {
                    return patterns.some(function includesEntry(includePattern) {
                        return patternMatches(includePattern, path);
                    });
                })
                .filter(function isNotExcluded(path) {
                    return options.exclude.every(function excludesEntry(excludePattern) {
                        return !patternMatches(excludePattern, path);
                    });
                });

            return asyncMatches(matches);
        },
        async realpath(path) {
            const absolute = resolve(path);
            const real = realpaths.get(absolute) ?? absolute;

            if (!entries.has(real)) {
                throw new Error(`Path does not exist: ${path}`);
            }

            return real;
        },
        async stat(path) {
            const entry = entries.get(resolve(path));

            return {
                isDirectory() {
                    return entry === 'directory';
                },
                isFile() {
                    return entry === 'file';
                }
            };
        }
    });
}
