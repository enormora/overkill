import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSuite, createTestCase, runIfMain, type TestScope } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';

type PackageJson = {
    readonly bin: unknown;
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

async function readPackageJson(packageFolder: string): Promise<PackageJson> {
    return JSON.parse(await fs.readFile(path.join(packageFolder, 'package.json'), 'utf8')) as PackageJson;
}

function isBinMap(value: unknown): value is Readonly<Record<string, string>> {
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
