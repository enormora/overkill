import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSuite, createTestCase, runIfMain, type TestScope } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';

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
};

const packageSmokeFolder = fileURLToPath(new URL('.', import.meta.url));
const packageSmokeNodeModules = path.join(packageSmokeFolder, 'node_modules');
const testPackageFolder = path.join(packageSmokeNodeModules, '@overkill-dev/test');
const runPackageFolder = path.join(packageSmokeNodeModules, '@overkill-dev/run');
const authoringSmokeFile = 'authoring-smoke.test.mjs';
const authoringSmokeScript = [
    "import { suite, test } from '@overkill-dev/test';",
    '',
    "export const testNode = suite('consumer root', [",
    '    suite({',
    "        name: 'nested',",
    "        metadata: { tags: [ 'smoke' ] },",
    '        children: [',
    '            test({',
    "                name: 'passes',",
    "                metadata: { tags: [ 'authoring' ] },",
    '                body(scope) {',
    '                    scope.assert.equal(1, 1);',
    '                    return scope.assert.collect();',
    '                }',
    '            })',
    '        ]',
    '    })',
    ']);',
    ''
]
    .join('\n');
const rootImportScript = [
    "const testModule = await import('@overkill-dev/test');",
    'console.log(JSON.stringify(Object.keys(testModule)));',
    'console.log(String(testModule.defineConfig));',
    'console.log(String(testModule.orchestrator));',
    'console.log(String(testModule.createLineReporter));',
    'console.log(String(testModule.testDouble));',
    'console.log(typeof testModule.test);',
    'console.log(typeof testModule.suite);',
    'const testNode = testModule.suite("smoke", [',
    '    testModule.test("passes", (scope) => {',
    '        scope.assert.true(true);',
    '        return scope.assert.collect();',
    '    })',
    ']);',
    'console.log(testNode.kind);',
    'console.log(testNode.children[0].kind);',
    'try {',
    '    testModule.table();',
    '} catch (error) {',
    '    console.log(error instanceof Error ? error.message : String(error));',
    '}'
]
    .join('\n');
const standardSubpathImportScript = [
    "const configModule = await import('@overkill-dev/test/config');",
    "const reportersModule = await import('@overkill-dev/test/reporters');",
    "const assertModule = await import('@overkill-dev/test/assert');",
    "const benchModule = await import('@overkill-dev/test/bench');",
    "const resourcesModule = await import('@overkill-dev/test/resources');",
    "const baselinesModule = await import('@overkill-dev/test/baselines');",
    'console.log(JSON.stringify(Object.keys(configModule)));',
    'console.log(JSON.stringify(Object.keys(reportersModule)));',
    'console.log(JSON.stringify(Object.keys(assertModule)));',
    'console.log(configModule.defineConfig({ profiles: {} }).profiles === undefined);',
    'console.log(reportersModule.createLineReporter().name);',
    'console.log(reportersModule.createBriefReporter().name);',
    'const dotReporter = reportersModule.createDotReporter();',
    'console.log(dotReporter.name);',
    'if (dotReporter.dispose !== null) {',
    '    dotReporter.dispose();',
    '}',
    'console.log(reportersModule.createGithubActionsOutputRenderer().render({',
    "    annotation: null, kind: 'stdout-line', role: 'primary', text: 'hello'",
    '}));',
    'console.log(typeof assertModule.defineCompositeAssertion);',
    'for (const [name, module] of [',
    "    [ 'bench', benchModule ],",
    "    [ 'resources', resourcesModule ],",
    "    [ 'baselines', baselinesModule ]",
    ']) {',
    '    console.log(JSON.stringify(Object.keys(module)));',
    '    try {',
    '        module.unavailable();',
    '    } catch (error) {',
    '        console.log(error instanceof Error ? error.message : String(error));',
    '    }',
    '}'
]
    .join('\n');
const runConfigImportScript = [
    "const configModule = await import('@overkill-dev/run/config');",
    'console.log(JSON.stringify(Object.keys(configModule)));',
    'console.log(configModule.defineConfig({ profiles: {} }).profiles === undefined);',
    'console.log(typeof configModule.loadRunConfig);',
    "console.log(new configModule.RunConfigError('Invalid config.').name);"
]
    .join('\n');
const expectedRootImportOutput = [
    '["createTestFacade","defineMacro","runIfMain","suite","table","test"]',
    'undefined',
    'undefined',
    'undefined',
    'undefined',
    'function',
    'function',
    'suite',
    'test',
    'The @overkill-dev/test table() authoring API is not implemented yet.',
    ''
]
    .join('\n');
const expectedStandardSubpathImportOutput = [
    '["defineConfig"]',
    '["createBriefReporter","createDotReporter","createGithubActionsOutputRenderer","createLineReporter"]',
    '["defineCompositeAssertion","defineNarrowingCompositeAssertion"]',
    'false',
    'line',
    'brief',
    'dot',
    'hello',
    'function',
    '["unavailable"]',
    'The @overkill-dev/test/bench subpath is reserved until its leaf package exists.',
    '["unavailable"]',
    'The @overkill-dev/test/resources subpath is reserved until its leaf package exists.',
    '["unavailable"]',
    'The @overkill-dev/test/baselines subpath is reserved until its leaf package exists.',
    ''
]
    .join('\n');
const expectedRunConfigImportOutput = [
    '["RunConfigError","defineConfig","loadRunConfig"]',
    'false',
    'function',
    'RunConfigError',
    ''
]
    .join('\n');

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
    const { all, file, not, parseRunFilterExpression, tag } = filters;

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

export const testSuite = createSuite({
    name: 'source/integration-tests/package-smoke/test-binary.test.ts',
    metadata: {},
    children: [
        createTestCase({
            name: '@overkill-dev/test package owns the overkill binary',
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
            name: 'consumer imports packaged @overkill-dev/test root facade',
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
            name: 'consumer imports packaged @overkill-dev/test standard subpaths',
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
            name: 'packaged overkill binary prints command help',
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
            name: 'packaged @overkill-dev/test root authoring creates runnable testNode exports',
            metadata: {},
            async body(scope: TestScope) {
                await writeAuthoringSmokeFile();

                const result = await spawnNode([
                    path.join(testPackageFolder, 'packages/test/overkill.entry-point.js'),
                    'run',
                    authoringSmokeFile
                ]);

                scope.assert.equal(result.code, 0);
                scope.assert.equal(result.stderr, '');
                scope.assert.includes(result.stdout, 'passes');
                scope.assert.includes(result.stdout, '1 discovered, 1 planned, 1 executed');

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'packaged overkill list renders root authoring definition locations',
            metadata: {},
            async body(scope: TestScope) {
                await writeAuthoringSmokeFile();

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
            name: 'consumer imports packaged @overkill-dev/run/filters helpers',
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

await runIfMain(import.meta, testSuite, { reporters: [ createLineReporter() ] });
