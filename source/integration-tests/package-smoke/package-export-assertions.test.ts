import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TestScope } from '@overkill-dev/engine';

type PackagedFilters = {
    readonly all: (filters: readonly [unknown, ...(readonly unknown[])]) => unknown;
    readonly file: (pattern: string) => unknown;
    readonly not: (filter: unknown) => unknown;
    readonly parseRunFilterExpression: (expression: string) => unknown;
    readonly runtime: (name: string) => unknown;
    readonly runtimeDimension: (name: string, dimension: string, value: string) => unknown;
    readonly runtimeVariant: (name: string, variantId: string) => unknown;
    readonly tag: (value: string) => unknown;
    readonly title: (value: string) => unknown;
};

const packagedFilterNames: readonly (keyof PackagedFilters)[] = [
    'all',
    'file',
    'not',
    'parseRunFilterExpression',
    'runtime',
    'runtimeDimension',
    'runtimeVariant',
    'tag',
    'title'
];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

function isPackagedFilters(value: unknown): value is PackagedFilters {
    return isRecord(value) && packagedFilterNames.every(function hasFilterExport(name) {
        return typeof value[name] === 'function';
    });
}

export async function importPackagedFilters(runPackageFolder: string): Promise<PackagedFilters> {
    const modulePath = path.join(runPackageFolder, 'packages/run/filters.entry-point.js');
    const filters: unknown = await import(pathToFileURL(modulePath).href);

    if (!isPackagedFilters(filters)) {
        throw new TypeError('Packaged run filters do not expose the expected contract.');
    }

    return filters;
}

export function assertPackagedFilters(scope: TestScope, filters: PackagedFilters): void {
    const {
        all,
        file,
        not,
        parseRunFilterExpression,
        runtime,
        runtimeDimension,
        runtimeVariant,
        tag,
        title
    } = filters;

    scope.assert.deepEqual(all([ tag('fast'), not(file('source/**')) ]), {
        filters: [
            { field: 'tag', kind: 'equals', value: 'fast' },
            {
                filter: { field: 'file', kind: 'glob', pattern: 'source/**' },
                kind: 'not'
            }
        ],
        kind: 'all'
    });
    scope.assert.deepEqual(title('smoke'), { field: 'title', kind: 'contains', value: 'smoke' });
    scope.assert.deepEqual(parseRunFilterExpression('tag=fast !tag=flaky'), {
        filters: [
            { field: 'tag', kind: 'equals', value: 'fast' },
            {
                filter: { field: 'tag', kind: 'equals', value: 'flaky' },
                kind: 'not'
            }
        ],
        kind: 'all'
    });
    scope.assert.deepEqual(runtime('browser'), { kind: 'runtime', runtime: 'browser' });
    scope.assert.deepEqual(runtimeVariant('browser', 'chromium'), {
        kind: 'runtime-variant',
        runtime: 'browser',
        variantId: 'chromium'
    });
    scope.assert.deepEqual(runtimeDimension('browser', 'engine', 'chromium'), {
        dimension: 'engine',
        kind: 'runtime-dimension',
        runtime: 'browser',
        value: 'chromium'
    });
}

export function assertResourcesPackageRootExport(
    scope: TestScope,
    packageExports: Readonly<Record<string, unknown>>
): void {
    scope.assert.deepEqual(packageExports['.'], {
        import: './packages/resources/resources.entry-point.js',
        types: './packages/resources/resources.entry-point.d.ts'
    });
}

export function assertSimulationPackageExports(
    scope: TestScope,
    packageExports: Readonly<Record<string, unknown>>
): void {
    scope.assert.deepEqual(packageExports['.'], {
        import: './packages/simulation/simulation.entry-point.js',
        types: './packages/simulation/simulation.entry-point.d.ts'
    });
    scope.assert.deepEqual(packageExports['./http'], {
        import: './packages/simulation/http.entry-point.js',
        types: './packages/simulation/http.entry-point.d.ts'
    });
}

export function assertRunConfigSubpathExport(
    scope: TestScope,
    packageExports: Readonly<Record<string, unknown>>
): void {
    scope.assert.deepEqual(packageExports['./config'], {
        import: './packages/run/config.entry-point.js',
        types: './packages/run/config.entry-point.d.ts'
    });
}

export function assertRunResourceLifecycleSubpathExport(
    scope: TestScope,
    packageExports: Readonly<Record<string, unknown>>
): void {
    scope.assert.deepEqual(packageExports['./resource-lifecycle'], {
        import: './packages/run/resource-lifecycle.entry-point.js',
        types: './packages/run/resource-lifecycle.entry-point.d.ts'
    });
}

export function assertTestStandardSubpathExports(
    scope: TestScope,
    packageExports: Readonly<Record<string, unknown>>
): void {
    scope.assert.deepEqual(packageExports['./config'], {
        import: './packages/test/config.entry-point.js',
        types: './packages/test/config.entry-point.d.ts'
    });
    scope.assert.deepEqual(packageExports['./reporters'], {
        import: './packages/test/reporters.entry-point.js',
        types: './packages/test/reporters.entry-point.d.ts'
    });
    scope.assert.deepEqual(packageExports['./assert'], {
        import: './packages/test/assert.entry-point.js',
        types: './packages/test/assert.entry-point.d.ts'
    });
    scope.assert.deepEqual(packageExports['./bench'], {
        import: './packages/test/bench.entry-point.js',
        types: './packages/test/bench.entry-point.d.ts'
    });
    scope.assert.deepEqual(packageExports['./compatibility'], {
        import: './packages/test/compatibility.entry-point.js',
        types: './packages/test/compatibility.entry-point.d.ts'
    });
    scope.assert.deepEqual(packageExports['./resources'], {
        import: './packages/test/resources.entry-point.js',
        types: './packages/test/resources.entry-point.d.ts'
    });
    scope.assert.deepEqual(packageExports['./simulation'], {
        import: './packages/test/simulation.entry-point.js',
        types: './packages/test/simulation.entry-point.d.ts'
    });
    scope.assert.deepEqual(packageExports['./baselines'], {
        import: './packages/test/baselines.entry-point.js',
        types: './packages/test/baselines.entry-point.d.ts'
    });
}
