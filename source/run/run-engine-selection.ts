import type { Engine } from '../engine/engine.ts';
import { invalidRequest, RunCollectionError } from './run-errors.ts';
import type { RunEngineSelection } from './run-types.ts';

type ModuleNamespace = Readonly<Record<string, unknown>>;
type EngineGetter = () => unknown;

export type RunEngineModuleLoaderDependencies = {
    readonly importModule: (moduleUrl: string) => Promise<unknown>;
};

export type RunEngineModuleLoader = (
    engine: Extract<RunEngineSelection, { readonly kind: 'module'; }>
) => Promise<Engine>;

type RunEngineResolverDependencies = {
    readonly defaultEngine: Engine;
    readonly loadRunEngineModule: RunEngineModuleLoader;
};

const engineMethodNames = [
    'createRoot',
    'createSuite',
    'createTable',
    'createTestCase',
    'createTestPlan',
    'createTestPlanFromTestFiles',
    'execute',
    'formatCaseId',
    'ownsTestNode'
] as const;

function isModuleNamespace(value: unknown): value is ModuleNamespace {
    return typeof value === 'object' && value !== null;
}

function isEngine(value: unknown): value is Engine {
    return isModuleNamespace(value) && engineMethodNames.every(function isEngineMethod(name) {
        return typeof value[name] === 'function';
    });
}

function isEngineGetter(value: unknown): value is EngineGetter {
    return typeof value === 'function';
}

function readModuleExport(
    moduleNamespace: ModuleNamespace,
    engine: Extract<RunEngineSelection, { readonly kind: 'module'; }>
): unknown {
    if (!Object.hasOwn(moduleNamespace, engine.exportName)) {
        throw new RunCollectionError(
            `Custom engine module must export ${engine.exportName}.`,
            { cause: null },
            'loader'
        );
    }

    return moduleNamespace[engine.exportName];
}

function readEngineValue(value: unknown): Engine {
    if (!isEngine(value)) {
        throw new RunCollectionError('Custom engine module export must be an Engine.', { cause: null }, 'loader');
    }

    return value;
}

export function validateRunEngineSelection(engine: RunEngineSelection): void {
    if (engine.kind === 'module') {
        if (engine.moduleUrl.length === 0) {
            invalidRequest('Custom engine moduleUrl must not be empty.');
        }

        if (engine.exportName.length === 0) {
            invalidRequest('Custom engine exportName must not be empty.');
        }
    }
}

async function importModule(moduleUrl: string, dependencies: RunEngineModuleLoaderDependencies): Promise<unknown> {
    try {
        return await dependencies.importModule(moduleUrl);
    } catch (error: unknown) {
        throw new RunCollectionError('Failed to load custom engine module.', { cause: error }, 'loader');
    }
}

function assertModuleNamespace(moduleNamespace: unknown): ModuleNamespace {
    if (isModuleNamespace(moduleNamespace)) {
        return moduleNamespace;
    }

    throw new RunCollectionError('Custom engine module namespace must be an object.', { cause: null }, 'loader');
}

function readSelectedEngine(
    moduleNamespace: ModuleNamespace,
    engine: Extract<RunEngineSelection, { readonly kind: 'module'; }>
): Engine {
    const exportedValue = readModuleExport(moduleNamespace, engine);

    if (engine.exportKind === 'getter') {
        if (!isEngineGetter(exportedValue)) {
            throw new RunCollectionError('Custom engine getter export must be a function.', { cause: null }, 'loader');
        }

        return readEngineValue(exportedValue());
    }

    return readEngineValue(exportedValue);
}

export function createRunEngineModuleLoader(dependencies: RunEngineModuleLoaderDependencies): RunEngineModuleLoader {
    return async function loadRunEngineModule(engine) {
        const moduleNamespace = assertModuleNamespace(await importModule(engine.moduleUrl, dependencies));

        return readSelectedEngine(moduleNamespace, engine);
    };
}

export async function resolveRunEngine(
    engine: RunEngineSelection,
    dependencies: RunEngineResolverDependencies
): Promise<Engine> {
    if (engine.kind === 'instance') {
        return engine.engine;
    }

    if (engine.kind === 'module') {
        return await dependencies.loadRunEngineModule(engine);
    }

    return dependencies.defaultEngine;
}
