import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type TypeScript from 'typescript';

type PathObservation<Value> = { readonly path: string; readonly value: Value; };
export type FrozenInputs = {
    readonly files: readonly PathObservation<string | null>[];
    readonly directories: readonly PathObservation<boolean>[];
    readonly probes: readonly PathObservation<boolean>[];
    readonly directoryEntries: readonly PathObservation<readonly string[]>[];
    readonly realPaths: readonly PathObservation<string>[];
};

export function sourceFingerprint(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}

function observations<Value>(values: ReadonlyMap<string, Value>): readonly PathObservation<Value>[] {
    return Array
        .from(values, function ([ path, value ]) {
            return { path, value };
        })
        .toSorted(function (left, right) {
            return left.path.localeCompare(right.path);
        });
}

type FileSystemObservation = { readonly system: TypeScript.System; readonly snapshot: () => FrozenInputs; };
type CapturedProject = {
    readonly project: TypeScript.ParsedCommandLine;
    readonly program: TypeScript.Program;
    readonly inputs: FrozenInputs;
};

function observeCompilerFileSystem(compiler: typeof TypeScript): FileSystemObservation {
    const observed = {
        files: new Map<string, string | null>(),
        probes: new Map<string, boolean>(),
        directories: new Map<string, boolean>(),
        directoryEntries: new Map<string, readonly string[]>(),
        realPaths: new Map<string, string>()
    };
    const system: TypeScript.System = {
        ...compiler.sys,
        readFile(path, encoding) {
            const text = compiler.sys.readFile(path, encoding);
            observed.files.set(resolve(path), text === undefined ? null : sourceFingerprint(text));
            return text;
        },
        fileExists(path) {
            const exists = compiler.sys.fileExists(path);
            observed.probes.set(resolve(path), exists);
            return exists;
        },
        directoryExists(path) {
            const exists = compiler.sys.directoryExists(path);
            observed.directories.set(resolve(path), exists);
            return exists;
        },
        getDirectories(path) {
            const entries = compiler.sys.getDirectories(path);
            observed.directoryEntries.set(
                resolve(path),
                entries.toSorted(function (left, right) {
                    return left.localeCompare(right);
                })
            );
            return entries;
        }
    };
    const { realpath } = compiler.sys;
    if (realpath !== undefined) {
        system.realpath = function resolveRealPath(path) {
            const resolved = realpath(path);
            observed.realPaths.set(resolve(path), resolved);
            return resolved;
        };
    }
    return {
        system,
        snapshot() {
            return {
                files: observations(observed.files),
                directories: observations(observed.directories),
                probes: observations(observed.probes),
                directoryEntries: observations(observed.directoryEntries),
                realPaths: observations(observed.realPaths)
            };
        }
    };
}

function parseOriginalProject(
    compiler: typeof TypeScript,
    system: TypeScript.System,
    projectConfigPath: string
): TypeScript.ParsedCommandLine {
    const errors: TypeScript.Diagnostic[] = [];
    const project = compiler.getParsedCommandLineOfConfigFile(projectConfigPath, {}, {
        ...system,
        onUnRecoverableConfigFileDiagnostic(diagnostic) {
            errors.push(diagnostic);
        }
    });
    if (project === undefined || errors.length > 0 || project.errors.length > 0) {
        throw new Error(`Cannot parse original project: ${projectConfigPath}`);
    }
    return project;
}

function observedCompilerHost(
    compiler: typeof TypeScript,
    options: TypeScript.CompilerOptions,
    system: TypeScript.System
): TypeScript.CompilerHost {
    return Object.assign(compiler.createCompilerHost(options), {
        readFile: system.readFile,
        fileExists: system.fileExists,
        directoryExists: system.directoryExists,
        getDirectories: system.getDirectories,
        ...system.realpath === undefined ? {} : { realpath: system.realpath }
    });
}

export function captureProjectInputs(compiler: typeof TypeScript, projectConfigPath: string): CapturedProject {
    const observation = observeCompilerFileSystem(compiler);
    const { system } = observation;
    const project = parseOriginalProject(compiler, system, projectConfigPath);
    system.readFile(compiler.sys.getExecutingFilePath());
    const program = compiler.createProgram({
        rootNames: project.fileNames,
        options: project.options,
        host: observedCompilerHost(compiler, project.options, system),
        ...project.projectReferences === undefined ? {} : { projectReferences: project.projectReferences }
    });
    program.getTypeChecker();
    return { project, program, inputs: observation.snapshot() };
}

function verifyObservations<Value>(
    values: readonly PathObservation<Value>[],
    current: (path: string) => Value,
    kind: 'input' | 'resolution'
): void {
    for (const observation of values) {
        if (!isDeepStrictEqual(current(observation.path), observation.value)) {
            throw new Error(`Type-test ${kind} changed after collection: ${observation.path}`);
        }
    }
}

function fileFingerprint(system: TypeScript.System, path: string): string | null {
    const text = system.readFile(path);
    return text === undefined ? null : sourceFingerprint(text);
}

export function verifyProjectInputs(compiler: typeof TypeScript, inputs: FrozenInputs): void {
    verifyObservations(inputs.files, function (path) {
        return fileFingerprint(compiler.sys, path);
    }, 'input');
    verifyObservations(inputs.directories, compiler.sys.directoryExists, 'resolution');
    verifyObservations(inputs.probes, compiler.sys.fileExists, 'resolution');
    verifyObservations(
        inputs.directoryEntries,
        function (path) {
            return compiler.sys.getDirectories(path).toSorted(function (left, right) {
                return left.localeCompare(right);
            });
        },
        'resolution'
    );
    verifyObservations(inputs.realPaths, function (path) {
        return compiler.sys.realpath?.(path) ?? null;
    }, 'resolution');
}
