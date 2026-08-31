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

async function readPackageJson(packageFolder: string): Promise<PackageJson> {
    return JSON.parse(await fs.readFile(path.join(packageFolder, 'package.json'), 'utf8')) as PackageJson;
}

function isBinMap(value: unknown): value is Readonly<Record<string, string>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPackageExportsMap(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
                const { all, file, not, parseRunFilterExpression, tag } = await importPackagedFilters();

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

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createLineReporter() ] });
