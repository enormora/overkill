import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSuite, createTestCase, type TestScope } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';
import { runIfMain } from './direct-launcher.test.ts';
import {
    authoringSmokeScript,
    expectedRootImportOutput,
    expectedRunConfigImportOutput,
    expectedStandardSubpathImportOutput,
    packageSmokeConfigScript,
    rootImportScript,
    runConfigImportScript,
    standardSubpathImportScript
} from './test-binary-scripts.ts';

type PackageJson = {
    readonly bin: unknown;
    readonly exports: unknown;
};

type SpawnOutput = {
    readonly code: number | null;
    readonly stderr: string;
    readonly stdout: string;
};

type FiltersModule = {
    readonly all: (filters: readonly [unknown, ...(readonly unknown[])]) => unknown;
    readonly file: (pattern: string) => unknown;
    readonly not: (filter: unknown) => unknown;
    readonly parseRunFilterExpression: (expression: string) => unknown;
    readonly tag: (value: string) => unknown;
    readonly title: (value: string) => unknown;
};

const packageSmokeFolder = fileURLToPath(new URL('.', import.meta.url));
const packageSmokeNodeModules = path.join(packageSmokeFolder, 'node_modules');
const testPackageFolder = path.join(packageSmokeNodeModules, '@overkill-dev/test');
const runPackageFolder = path.join(packageSmokeNodeModules, '@overkill-dev/run');
const packageSmokeConfigFile = 'overkill.config.js';
const authoringSmokeFile = 'authoring-smoke.test.mjs';
async function readPackageJson(packageFolder: string): Promise<PackageJson> {
    return JSON.parse(await fs.readFile(path.join(packageFolder, 'package.json'), 'utf8')) as PackageJson;
}

function isBinMap(value: unknown): value is Readonly<Record<string, string>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPackageExportsMap(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readPackageExports(
    packageFolder: string,
    packageName: string
): Promise<Readonly<Record<string, unknown>>> {
    const packageJson = await readPackageJson(packageFolder);
    const packageExports = packageJson.exports;

    if (!isPackageExportsMap(packageExports)) {
        throw new Error(`Expected ${packageName} exports map.`);
    }

    return packageExports;
}

async function collectStream(stream: Readable): Promise<string> {
    return await new Promise(function collect(resolve, reject) {
        const chunks: Buffer[] = [];

        stream.on('data', function recordChunk(chunk: Buffer) {
            chunks.push(chunk);
        });
        stream.on('error', reject);
        stream.on('end', function resolveOutput() {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
    });
}

async function spawnNode(args: readonly string[]): Promise<SpawnOutput> {
    const child = spawn(process.execPath, Array.from(args), {
        cwd: packageSmokeFolder,
        stdio: [ 'ignore', 'pipe', 'pipe' ]
    });
    const stdout = collectStream(child.stdout);
    const stderr = collectStream(child.stderr);
    const code = await new Promise<number | null>(function wait(resolve, reject) {
        child.on('error', reject);
        child.on('close', resolve);
    });

    return {
        code,
        stderr: await stderr,
        stdout: await stdout
    };
}

async function importPackagedFilters(): Promise<FiltersModule> {
    const modulePath = path.join(runPackageFolder, 'packages/run/filters.entry-point.js');

    return await import(pathToFileURL(modulePath).href) as FiltersModule;
}

function assertTestStandardSubpathExports(scope: TestScope, packageExports: Readonly<Record<string, unknown>>): void {
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
    scope.assert.deepEqual(packageExports['./resources'], {
        import: './packages/test/resources.entry-point.js',
        types: './packages/test/resources.entry-point.d.ts'
    });
    scope.assert.deepEqual(packageExports['./baselines'], {
        import: './packages/test/baselines.entry-point.js',
        types: './packages/test/baselines.entry-point.d.ts'
    });
}

function assertRunConfigSubpathExport(scope: TestScope, packageExports: Readonly<Record<string, unknown>>): void {
    scope.assert.deepEqual(packageExports['./config'], {
        import: './packages/run/config.entry-point.js',
        types: './packages/run/config.entry-point.d.ts'
    });
}

function assertPackagedFilters(scope: TestScope, filters: FiltersModule): void {
    const { all, file, not, parseRunFilterExpression, tag, title } = filters;

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
}

async function writeAuthoringSmokeFile(): Promise<void> {
    await fs.writeFile(path.join(packageSmokeFolder, authoringSmokeFile), authoringSmokeScript);
}

async function writePackageSmokeProject(): Promise<void> {
    await Promise.all([
        fs.writeFile(path.join(packageSmokeFolder, packageSmokeConfigFile), packageSmokeConfigScript),
        writeAuthoringSmokeFile()
    ]);
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/package-smoke/test-binary.test.ts',
    metadata: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test package owns the overkill binary',
            metadata: {},
            async body(scope: TestScope) {
                const testPackageJson = await readPackageJson(testPackageFolder);
                const runPackageJson = await readPackageJson(runPackageFolder);
                const testBin = testPackageJson.bin;

                if (!isBinMap(testBin)) {
                    throw new Error('Expected @overkill-dev/test bin map.');
                }

                scope.assert.deepEqual(testBin, {
                    overkill: './packages/test/overkill.entry-point.js'
                });
                scope.assert.equal(runPackageJson.bin, undefined);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'consumer imports packaged @overkill-dev/test root facade',
            metadata: {},
            async body(scope: TestScope) {
                const testPackageJson = await readPackageJson(testPackageFolder);
                const packageExports = testPackageJson.exports;
                const result = await spawnNode([
                    '--input-type=module',
                    '--eval',
                    rootImportScript
                ]);

                if (!isPackageExportsMap(packageExports)) {
                    throw new Error('Expected @overkill-dev/test exports map.');
                }

                scope.assert.deepEqual(packageExports['.'], {
                    import: './packages/test/test.entry-point.js',
                    types: './packages/test/test.entry-point.d.ts'
                });
                scope.assert.equal(result.code, 0);
                scope.assert.equal(result.stderr, '');
                scope.assert.equal(result.stdout, expectedRootImportOutput);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'consumer imports packaged @overkill-dev/test standard subpaths',
            metadata: {},
            async body(scope: TestScope) {
                const testPackageJson = await readPackageJson(testPackageFolder);
                const packageExports = testPackageJson.exports;
                const result = await spawnNode([
                    '--input-type=module',
                    '--eval',
                    standardSubpathImportScript
                ]);

                if (!isPackageExportsMap(packageExports)) {
                    throw new Error('Expected @overkill-dev/test exports map.');
                }

                assertTestStandardSubpathExports(scope, packageExports);
                scope.assert.equal(result.code, 0);
                scope.assert.equal(result.stderr, '');
                scope.assert.equal(result.stdout, expectedStandardSubpathImportOutput);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'packaged overkill binary prints command help',
            metadata: {},
            async body(scope: TestScope) {
                const result = await spawnNode([
                    path.join(testPackageFolder, 'packages/test/overkill.entry-point.js'),
                    '--help'
                ]);

                scope.assert.equal(result.code, 0);
                scope.assert.includes(result.stdout, 'overkill <subcommand>');
                scope.assert.equal(result.stderr, '');

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'packaged @overkill-dev/test root authoring creates runnable testNode exports',
            metadata: {},
            async body(scope: TestScope) {
                await writePackageSmokeProject();

                const result = await spawnNode([
                    path.join(testPackageFolder, 'packages/test/overkill.entry-point.js'),
                    'run',
                    authoringSmokeFile
                ]);

                scope.assert.equal(result.code, 0);
                scope.assert.equal(result.stderr, '');
                scope.assert.equal(result.stdout, '');

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'packaged overkill list renders root authoring definition locations',
            metadata: {},
            async body(scope: TestScope) {
                await writePackageSmokeProject();

                const result = await spawnNode([
                    path.join(testPackageFolder, 'packages/test/overkill.entry-point.js'),
                    'list',
                    '--with-locations',
                    authoringSmokeFile
                ]);

                scope.assert.equal(result.code, 0);
                scope.assert.equal(result.stderr, '');
                scope.assert.includes(result.stdout, `nested (${authoringSmokeFile}:`);
                scope.assert.includes(result.stdout, `passes (${authoringSmokeFile}:`);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'consumer imports packaged @overkill-dev/run/filters helpers',
            metadata: {},
            async body(scope: TestScope) {
                const packageExports = await readPackageExports(runPackageFolder, '@overkill-dev/run');
                const result = await spawnNode([
                    '--input-type=module',
                    '--eval',
                    runConfigImportScript
                ]);
                const filters = await importPackagedFilters();

                assertRunConfigSubpathExport(scope, packageExports);
                scope.assert.equal(result.code, 0);
                scope.assert.equal(result.stderr, '');
                scope.assert.equal(result.stdout, expectedRunConfigImportOutput);
                assertPackagedFilters(scope, filters);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
