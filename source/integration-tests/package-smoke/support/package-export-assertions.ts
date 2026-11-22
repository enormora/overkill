import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { z } from 'zod/v4';
import type * as LineReporterPackage from '../../../packages/reporter-line/reporter-line.entry-point.ts';
import { resolvePackagedExport } from './packaged-module.ts';

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

export const assertPackagedFilters = defineCompositeAssertion({
    name: 'packaged filters',
    assert(check, filters: PackagedFilters) {
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
        return check.group([
            check.deepEqual(all([ tag('fast'), not(file('source/**')) ]), {
                filters: [
                    { field: 'tag', kind: 'equals', value: 'fast' },
                    {
                        filter: { field: 'file', kind: 'glob', pattern: 'source/**' },
                        kind: 'not'
                    }
                ],
                kind: 'all'
            }),
            check.deepEqual(title('smoke'), { field: 'title', kind: 'contains', value: 'smoke' }),
            check.deepEqual(parseRunFilterExpression('tag=fast !tag=flaky'), {
                filters: [
                    { field: 'tag', kind: 'equals', value: 'fast' },
                    {
                        filter: { field: 'tag', kind: 'equals', value: 'flaky' },
                        kind: 'not'
                    }
                ],
                kind: 'all'
            }),
            check.deepEqual(runtime('browser'), { kind: 'runtime', runtime: 'browser' }),
            check.deepEqual(runtimeVariant('browser', 'chromium'), {
                kind: 'runtime-variant',
                runtime: 'browser',
                variantId: 'chromium'
            }),
            check.deepEqual(runtimeDimension('browser', 'engine', 'chromium'), {
                dimension: 'engine',
                kind: 'runtime-dimension',
                runtime: 'browser',
                value: 'chromium'
            })
        ]);
    }
});

export const resourcesPackageRootExportChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    packageExports: Readonly<Record<string, unknown>>
): CompositeAssertionReturn<'assert'> {
    return check.group([ check.deepEqual(packageExports['.'], {
        import: './packages/resources/resources.entry-point.js',
        types: './packages/resources/resources.entry-point.d.ts'
    }) ]);
};

export const simulationPackageExportsChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    packageExports: Readonly<Record<string, unknown>>
): CompositeAssertionReturn<'assert'> {
    return check.group([
        check.deepEqual(packageExports['.'], {
            import: './packages/simulation/simulation.entry-point.js',
            types: './packages/simulation/simulation.entry-point.d.ts'
        }),
        check.deepEqual(packageExports['./http'], {
            import: './packages/simulation/http.entry-point.js',
            types: './packages/simulation/http.entry-point.d.ts'
        })
    ]);
};

export const assertRunConfigSubpathExport = defineCompositeAssertion({
    name: 'run config subpath export',
    assert(check, packageExports: Readonly<Record<string, unknown>>) {
        return check.group([ check.deepEqual(packageExports['./config'], {
            import: './packages/run/config.entry-point.js',
            types: './packages/run/config.entry-point.d.ts'
        }) ]);
    }
});

export const assertRunResourceLifecycleSubpathExport = defineCompositeAssertion({
    name: 'run resource lifecycle subpath export',
    assert(check, packageExports: Readonly<Record<string, unknown>>) {
        return check.group([ check.deepEqual(packageExports['./resource-lifecycle'], {
            import: './packages/run/resource-lifecycle.entry-point.js',
            types: './packages/run/resource-lifecycle.entry-point.d.ts'
        }) ]);
    }
});

export const testStandardSubpathExportsChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    packageExports: Readonly<Record<string, unknown>>
): CompositeAssertionReturn<'assert'> {
    return check.group([
        check.deepEqual(packageExports['./config'], {
            import: './packages/test/config.entry-point.js',
            types: './packages/test/config.entry-point.d.ts'
        }),
        check.deepEqual(packageExports['./reporters'], {
            import: './packages/test/reporters.entry-point.js',
            types: './packages/test/reporters.entry-point.d.ts'
        }),
        check.deepEqual(packageExports['./assert'], {
            import: './packages/test/assert.entry-point.js',
            types: './packages/test/assert.entry-point.d.ts'
        }),
        check.deepEqual(packageExports['./bench'], {
            import: './packages/test/bench.entry-point.js',
            types: './packages/test/bench.entry-point.d.ts'
        }),
        check.deepEqual(packageExports['./compatibility'], {
            import: './packages/test/compatibility.entry-point.js',
            types: './packages/test/compatibility.entry-point.d.ts'
        }),
        check.deepEqual(packageExports['./resources'], {
            import: './packages/test/resources.entry-point.js',
            types: './packages/test/resources.entry-point.d.ts'
        }),
        check.deepEqual(packageExports['./simulation'], {
            import: './packages/test/simulation.entry-point.js',
            types: './packages/test/simulation.entry-point.d.ts'
        }),
        check.deepEqual(packageExports['./baselines'], {
            import: './packages/test/baselines.entry-point.js',
            types: './packages/test/baselines.entry-point.d.ts'
        })
    ]);
};

const completedRecordSchema = z.object({
    status: z.literal('completed'),
    request: z.object({ record: z.literal(true), paths: z.array(z.string()) })
});
export const assertCompletedRunRecord = defineCompositeAssertion({
    name: 'completed run record',
    async assert(check, directory: string, file: string) {
        const folder = path.join(directory, '.overkill', 'runs');
        const entries = await readdir(folder);
        const names = entries.filter(function recordFile(name) {
            return name.endsWith('.json');
        });
        const records: unknown[] = await Promise.all(names.map(async function readRecord(name) {
            const value: unknown = JSON.parse(await readFile(path.join(folder, name), 'utf8'));
            return value;
        }));
        return check.group([ check.true(records.some(function matchingRecord(value) {
            const parsed = completedRecordSchema.safeParse(value);
            return parsed.success && parsed.data.request.paths.includes(file);
        })) ]);
    }
});

export async function recordedRunId(directory: string, file: string): Promise<string> {
    const folder = path.join(directory, '.overkill', 'runs');
    const entries = await readdir(folder);
    const schema = completedRecordSchema.extend({ id: z.string().min(1) });
    const names = entries
        .filter(function json(name) {
            return name.endsWith('.json');
        })
        .toSorted(function newest(left, right) {
            return right.localeCompare(left);
        });
    for (const name of names) {
        const parsed = schema.safeParse(JSON.parse(await readFile(path.join(folder, name), 'utf8')));
        if (parsed.success && parsed.data.request.paths.includes(file)) {
            return parsed.data.id;
        }
    }
    throw new Error('Expected a completed recorded run.');
}

const { createLineProgressReporter, createLineTreeReporter } = await import(
    await resolvePackagedExport('@overkill-dev/reporter-line')
) as typeof LineReporterPackage;

export const assertLineReporterVariants = defineCompositeAssertion({
    name: 'line reporter variants',
    assert(check) {
        return check.group([
            check.equal(typeof createLineProgressReporter, 'function'),
            check.equal(typeof createLineTreeReporter, 'function')
        ]);
    }
});
