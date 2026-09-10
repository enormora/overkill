import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { WallClock } from '@enormora/wall-clock';
import type { RunResourceUsageTracker } from '../engine/run-result.ts';
import { defaultRunEngine } from '../run/default-run-engine.ts';
import { createRunIfMain, type RunIfMain } from '../run/run-if-main.ts';
import { createDirectProfileResolver } from '../run/run-if-main-profile.ts';
import { createRunConfigLoader } from '../run/run-config.ts';

type DirectRunProject = {
    readonly cwd: string;
    readonly file: string;
    readonly meta: Readonly<ImportMeta>;
};

export type DirectRunFixture = {
    readonly exitCode: () => number | string | null | undefined;
    readonly project: DirectRunProject;
    readonly runIfMain: RunIfMain;
    readonly setExitCode: (exitCode: number | string | null | undefined) => void;
    readonly stderr: () => string;
};

type DirectRunFixtureInput = {
    readonly config: DirectRunConfigFixture | null;
    readonly fileName: string;
    readonly files: readonly string[];
};

type DirectRunConfigFixture = Readonly<Record<string, unknown>>;

function importMeta(file: string): Readonly<ImportMeta> {
    return {
        dirname: dirname(file),
        filename: file,
        main: true,
        resolve(specifier: string) {
            return import.meta.resolve(specifier);
        },
        url: pathToFileURL(file).href
    };
}

function unavailableTimer(): never {
    throw new Error('Direct run fixture does not provide timers.');
}

function createWallClockFixture(): WallClock {
    return {
        clearInterval() {
            return undefined;
        },
        clearTimeout() {
            return undefined;
        },
        currentDate: new Date(0),
        currentTimestampInMilliseconds: 0,
        setInterval: unavailableTimer,
        setTimeout: unavailableTimer
    };
}

function createResourceUsageTracker(): RunResourceUsageTracker {
    return {
        finish() {
            return {
                activeResourceTypes: [],
                end: {
                    activeResourceCount: 0,
                    activeResourceTypes: [],
                    capturedAtMilliseconds: 0,
                    javaScriptEngineHeapBytes: 0,
                    residentSetBytes: 0
                },
                peakActiveResourceCount: 0,
                peakJavaScriptEngineHeapBytes: 0,
                peakResidentSetBytes: 0,
                peakResidentSetGrowthBytesPerSecond: 0,
                sampleCount: 1,
                start: {
                    activeResourceCount: 0,
                    activeResourceTypes: [],
                    capturedAtMilliseconds: 0,
                    javaScriptEngineHeapBytes: 0,
                    residentSetBytes: 0
                }
            };
        },
        start() {
            return undefined;
        }
    };
}

function relativeFile(cwd: string, file: string): string {
    return relative(cwd, file).replaceAll('\\', '/');
}

function exactPatternMatches(pattern: string, file: string): boolean {
    return pattern === file;
}

function recursiveTestPatternMatches(pattern: string, file: string): boolean {
    const marker = '**/*.test.ts';

    if (!pattern.endsWith(marker)) {
        return false;
    }

    return file.startsWith(pattern.slice(0, -marker.length)) && file.endsWith('.test.ts');
}

function patternMatches(pattern: string, file: string): boolean {
    return exactPatternMatches(pattern, file) || recursiveTestPatternMatches(pattern, file);
}

async function* asyncMatches(matches: readonly string[]): AsyncIterable<string> {
    for (const match of matches) {
        yield match;
    }
}

function createConfigModules(
    cwd: string,
    config: DirectRunConfigFixture | null
): Readonly<Record<string, unknown>> {
    if (config === null) {
        return {};
    }

    return {
        [resolve(cwd, 'overkill.config.js')]: { config }
    };
}

function globPatterns(patterns: string | readonly string[]): readonly string[] {
    return typeof patterns === 'string' ? [ patterns ] : patterns;
}

export function createDirectRunFixture(input: DirectRunFixtureInput): DirectRunFixture {
    const cwd = '/project';
    const file = resolve(cwd, input.fileName);
    const files = new Set([
        file,
        ...input.files.map(function toAbsoluteFile(fileName) {
            return resolve(cwd, fileName);
        })
    ]);
    const modules = createConfigModules(cwd, input.config);
    let exitCode: number | string | null | undefined = null;
    let stderr = '';
    const loadRunConfig = createRunConfigLoader({
        async fileExists(filePath) {
            return Object.hasOwn(modules, filePath);
        },
        async importModule(configPath) {
            if (!Object.hasOwn(modules, configPath)) {
                throw new Error(`Missing config fixture: ${configPath}`);
            }

            return modules[configPath];
        }
    });
    const resolveDirectProfile = createDirectProfileResolver({
        fileURLToPath,
        glob(pattern, options) {
            const patterns = globPatterns(pattern);
            const excludedPatterns = options.exclude;
            const matches = Array
                .from(files, function toRelativeFile(filePath) {
                    return relativeFile(options.cwd, filePath);
                })
                .filter(function isIncluded(fileName) {
                    return patterns.some(function includesFile(includePattern) {
                        return patternMatches(includePattern, fileName);
                    });
                })
                .filter(function isNotExcluded(fileName) {
                    return excludedPatterns.every(function excludesFile(excludePattern) {
                        return !patternMatches(excludePattern, fileName);
                    });
                });

            return asyncMatches(matches);
        },
        loadRunConfig,
        async realpath(filePath) {
            const absolutePath = resolve(filePath);

            return absolutePath;
        },
        async stat(filePath) {
            return {
                isFile() {
                    return files.has(resolve(filePath));
                }
            };
        }
    });

    return {
        exitCode() {
            return exitCode;
        },
        project: {
            cwd,
            file,
            meta: importMeta(file)
        },
        runIfMain: createRunIfMain({
            createResourceUsageTracker,
            createRuntimePolicy() {
                return null;
            },
            createWallClock: createWallClockFixture,
            currentWorkingDirectory() {
                return cwd;
            },
            readExitCode() {
                return exitCode;
            },
            resolveDirectProfile,
            runEngine: defaultRunEngine,
            setExitCode(nextExitCode) {
                exitCode = nextExitCode;
            },
            stderr: {
                write(chunk) {
                    stderr += chunk;
                }
            }
        }),
        setExitCode(nextExitCode) {
            exitCode = nextExitCode;
        },
        stderr() {
            return stderr;
        }
    };
}
