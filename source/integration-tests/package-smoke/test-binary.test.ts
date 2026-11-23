import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite } from '@overkill-dev/test';

import { packageConsumer } from './support/package-consumer.ts';
import { consumerEnvironment } from './support/consumer-environment.ts';
import {
    testStandardSubpathExportsChecks,
    assertLineReporterVariants,
    resourcesPackageRootExportChecks,
    simulationPackageExportsChecks,
    recordedRunId,
    assertCompletedRunRecord,
    assertPackagedFilters,
    assertRunConfigSubpathExport,
    assertRunResourceLifecycleSubpathExport,
    importPackagedFilters
} from './support/package-export-assertions.ts';
import { packageSmokeNodeModules } from './support/packaged-module.ts';
import {
    authoringSmokeScript,
    customAuthoringFacadeScript,
    customAuthoringSmokeScript,
    consolePolicySmokeScript,
    expectedRootImportOutput,
    expectedRunSubpathImportOutput,
    expectedStandardSubpathImportOutput,
    finalOnlyReporterConfigScript,
    lineReporterConfigScript,
    packageSmokePackageJsonScript,
    packageSmokeConfigScript,
    reporterConsoleConfigScript,
    reporterConsoleSmokeScript,
    rootImportScript,
    runSubpathImportScript,
    standardSubpathImportScript,
    throwsOnImportSmokeScript
} from './support/test-binary-scripts.ts';

const testPackageFolder = path.join(packageSmokeNodeModules, '@overkill-dev/test');
const runPackageFolder = path.join(packageSmokeNodeModules, '@overkill-dev/run');
const resourcesPackageFolder = path.join(packageSmokeNodeModules, '@overkill-dev/resources');
const simulationPackageFolder = path.join(packageSmokeNodeModules, '@overkill-dev/simulation');
const overkillBinEntryPointPath = path.join(testPackageFolder, 'packages/test/overkill.entry-point.js');

type PackageJson = {
    readonly bin: unknown;
    readonly engines: unknown;
    readonly exports: unknown;
};

type SpawnOutput = {
    readonly code: number | null;
    readonly stderr: string;
    readonly stdout: string;
};

const packageSmokePackageJsonFile = 'package.json';
const packageSmokeConfigFile = 'overkill.config.js';
const lineReporterConfigFile = 'line-reporter-overkill.config.js';
const finalOnlyReporterConfigFile = 'final-only-reporter-overkill.config.js';
const reporterConsoleConfigFile = 'reporter-console-overkill.config.js';
const authoringSmokeFile = 'authoring-smoke.test.mjs';
const consolePolicySmokeFile = 'console-policy-smoke.test.mjs';
const reporterConsoleSmokeFile = 'reporter-console-smoke.test.mjs';
const throwsOnImportSmokeFile = 'throws-on-import-smoke.test.mjs';
const customAuthoringFolder = 'testing';
const customAuthoringFacadeFile = path.join(customAuthoringFolder, 'custom-authoring.mjs');
const customAuthoringSmokeFile = 'custom-authoring-smoke.test.mjs';
async function collectStream(stream: Readonly<ChildProcessWithoutNullStreams['stdout']>): Promise<string> {
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

const consumerFacade = packageConsumer('Installed CLI and public exports', function consumerFixture(consumerDirectory) {
    const packageSmokeFolder = path.join(consumerDirectory, 'consumer');

    async function spawnCommand(command: string, args: readonly string[]): Promise<SpawnOutput> {
        await fs.mkdir(packageSmokeFolder, { recursive: true });
        const child = spawn(command, Array.from(args), {
            env: consumerEnvironment(consumerDirectory),
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
    async function spawnNode(args: readonly string[]): Promise<SpawnOutput> {
        return await spawnCommand(process.execPath, args);
    }
    const assertPackagedReplay = defineCompositeAssertion({
        name: 'packaged replay',
        async assert(check) {
            const id = await recordedRunId(packageSmokeFolder, authoringSmokeFile);
            const result = await spawnNode([ overkillBinEntryPointPath, 'replay', id ]);
            return check.group([
                check.equal(result.code, 0),
                check.equal(result.stderr, ''),
                check.equal(result.stdout, '')
            ]);
        }
    });
    const assertPackagedStandardSubpathImports = defineCompositeAssertion({
        name: 'packaged standard subpath imports',
        async assert(check, packageExports: Readonly<Record<string, unknown>>) {
            const resourcesPackageExports = await readPackageExports(resourcesPackageFolder, '@overkill-dev/resources');
            const simulationPackageExports = await readPackageExports(
                simulationPackageFolder,
                '@overkill-dev/simulation'
            );
            const result = await spawnNode([
                '--input-type=module',
                '--eval',
                standardSubpathImportScript
            ]);
            return check.group([
                testStandardSubpathExportsChecks(check.annotated('test standard subpath exports'), packageExports),
                resourcesPackageRootExportChecks(
                    check.annotated('resources package root export'),
                    resourcesPackageExports
                ),
                simulationPackageExportsChecks(check.annotated('simulation package exports'), simulationPackageExports),
                check.equal(result.code, 0),
                check.equal(result.stderr, ''),
                check.equal(result.stdout, expectedStandardSubpathImportOutput)
            ]);
        }
    });
    async function writePackageSmokeProject(): Promise<void> {
        await fs.mkdir(path.join(packageSmokeFolder, customAuthoringFolder), { recursive: true });
        await Promise.all([
            fs.writeFile(path.join(packageSmokeFolder, packageSmokeConfigFile), packageSmokeConfigScript),
            fs.writeFile(path.join(packageSmokeFolder, authoringSmokeFile), authoringSmokeScript),
            fs.writeFile(path.join(packageSmokeFolder, packageSmokePackageJsonFile), packageSmokePackageJsonScript),
            fs.writeFile(path.join(packageSmokeFolder, customAuthoringFacadeFile), customAuthoringFacadeScript),
            fs.writeFile(path.join(packageSmokeFolder, customAuthoringSmokeFile), customAuthoringSmokeScript)
        ]);
    }
    async function writeReporterPolicySmokeProject(): Promise<void> {
        await fs.mkdir(packageSmokeFolder, { recursive: true });
        await Promise.all([
            fs.writeFile(path.join(packageSmokeFolder, lineReporterConfigFile), lineReporterConfigScript),
            fs.writeFile(path.join(packageSmokeFolder, finalOnlyReporterConfigFile), finalOnlyReporterConfigScript),
            fs.writeFile(path.join(packageSmokeFolder, reporterConsoleConfigFile), reporterConsoleConfigScript),
            fs.writeFile(path.join(packageSmokeFolder, consolePolicySmokeFile), consolePolicySmokeScript),
            fs.writeFile(path.join(packageSmokeFolder, reporterConsoleSmokeFile), reporterConsoleSmokeScript),
            fs.writeFile(path.join(packageSmokeFolder, throwsOnImportSmokeFile), throwsOnImportSmokeScript)
        ]);
    }
    return {
        spawnNode,
        assertPackagedStandardSubpathImports,
        writeReporterPolicySmokeProject,
        writePackageSmokeProject,
        packageSmokeFolder,
        assertPackagedReplay
    };
});
const { test } = consumerFacade;

export const testNode = suite('Installed CLI and public exports', [
    test('@overkill-dev/test package owns the overkill binary', async function (scope) {
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
        scope.assert.deepEqual(testPackageJson.engines, { node: '^26.9.0' });
        scope.assert.deepEqual(runPackageJson.engines, { node: '^26.9.0' });

        return scope.assert.collect();
    }),
    test('@overkill-dev/reporter-line exposes every presentation variant', function (scope) {
        scope.assert(assertLineReporterVariants);

        return scope.assert.collect();
    }),
    test('imports @overkill-dev/test root facade', async function (scope) {
        const { spawnNode } = scope.resources.consumer;

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

        scope.assert(defineCompositeAssertion({
            name: 'imports @overkill-dev/test root facade',
            assert(check) {
                return check.group([
                    check.deepEqual(packageExports['.'], {
                        import: './packages/test/test.entry-point.js',
                        types: './packages/test/test.entry-point.d.ts'
                    }),
                    check.equal(result.code, 0),
                    check.equal(result.stderr, '')
                ]);
            }
        }));
        scope.assert.equal(result.stdout, expectedRootImportOutput);

        return scope.assert.collect();
    }),
    test('imports @overkill-dev/test standard subpaths', async function (scope) {
        const { assertPackagedStandardSubpathImports } = scope.resources.consumer;

        const testPackageJson = await readPackageJson(testPackageFolder);
        const packageExports = testPackageJson.exports;

        if (!isPackageExportsMap(packageExports)) {
            throw new Error('Expected @overkill-dev/test exports map.');
        }

        await scope.assert(assertPackagedStandardSubpathImports, packageExports);

        return scope.assert.collect();
    }),
    test('overkill binary prints command help', async function (scope) {
        const { spawnNode } = scope.resources.consumer;

        const result = await spawnNode([
            overkillBinEntryPointPath,
            '--help'
        ]);

        scope.assert.equal(result.code, 0);
        scope.assert.includes(result.stdout, 'overkill <subcommand>');
        scope.assert.equal(result.stderr, '');

        return scope.assert.collect();
    }),
    test(
        'overkill bin entry point default line reporter passes with capability restrictions',
        async function (scope) {
            const { writeReporterPolicySmokeProject, spawnNode } = scope.resources.consumer;

            await writeReporterPolicySmokeProject();

            const result = await spawnNode([
                overkillBinEntryPointPath,
                'run',
                '--config',
                lineReporterConfigFile,
                reporterConsoleSmokeFile
            ]);

            scope.assert.equal(result.code, 0);
            scope.assert.match(result.stdout, /^ {2}1 executed · [\d.]+ (?:µs|ms|s) execution · /mu);
            scope.assert.equal(result.stderr, '');

            return scope.assert.collect();
        }
    ),
    test(
        'overkill bin entry point line reporter shows test console policy violations',
        async function (scope) {
            const { writeReporterPolicySmokeProject, spawnNode } = scope.resources.consumer;

            await writeReporterPolicySmokeProject();

            const result = await spawnNode([
                overkillBinEntryPointPath,
                'run',
                '--config',
                lineReporterConfigFile,
                consolePolicySmokeFile
            ]);

            scope.assert.equal(result.code, 2);
            scope.assert.includes(result.stdout, 'Runner error: Runtime policy violation: console.');
            scope.assert.match(result.stdout, /^ {2}1 executed · [\d.]+ (?:µs|ms|s) execution · /mu);
            scope.assert.equal(result.stderr, '');

            return scope.assert.collect();
        }
    ),
    test(
        'overkill bin entry point falls back for final-only runner errors',
        async function (scope) {
            const { writeReporterPolicySmokeProject, spawnNode } = scope.resources.consumer;

            await writeReporterPolicySmokeProject();

            const result = await spawnNode([
                overkillBinEntryPointPath,
                'run',
                '--config',
                finalOnlyReporterConfigFile,
                throwsOnImportSmokeFile
            ]);

            scope.assert.equal(result.code, 2);
            scope.assert.includes(result.stdout, 'final-result-reporter');
            scope.assert.includes(
                result.stderr,
                `Overkill runner error: Failed to load test module: ${throwsOnImportSmokeFile}`
            );

            return scope.assert.collect();
        }
    ),
    test(
        'overkill bin entry point reports undeclared reporter console usage',
        async function (scope) {
            const { writeReporterPolicySmokeProject, spawnNode } = scope.resources.consumer;

            await writeReporterPolicySmokeProject();

            const result = await spawnNode([
                overkillBinEntryPointPath,
                'run',
                '--config',
                reporterConsoleConfigFile,
                reporterConsoleSmokeFile
            ]);

            scope.assert.equal(result.code, 2);
            scope.assert.includes(result.stdout, 'undeclared reporter console');
            scope.assert.includes(
                result.stderr,
                'Overkill runner error: reporter-console-violation: Reporter used undeclared console.log output.'
            );

            return scope.assert.collect();
        }
    ),
    test(
        '@overkill-dev/test root authoring creates runnable testNode exports',
        async function (scope) {
            const { writePackageSmokeProject, spawnNode, packageSmokeFolder, assertPackagedReplay } = scope
                .resources
                .consumer;

            await writePackageSmokeProject();

            const result = await spawnNode([
                overkillBinEntryPointPath,
                'run',
                '--record',
                authoringSmokeFile
            ]);

            scope.assert.equal(result.code, 0);
            scope.assert.equal(result.stderr, '');
            scope.assert.equal(result.stdout, '');

            await scope.assert(assertCompletedRunRecord, packageSmokeFolder, authoringSmokeFile);
            await scope.assert(assertPackagedReplay);
            return scope.assert.collect();
        }
    ),
    test('overkill list renders root authoring definition locations', async function (scope) {
        const { writePackageSmokeProject, spawnNode } = scope.resources.consumer;

        await writePackageSmokeProject();

        const result = await spawnNode([
            overkillBinEntryPointPath,
            'list',
            '--with-locations',
            authoringSmokeFile
        ]);

        scope.assert.equal(result.code, 0);
        scope.assert.equal(result.stderr, '');
        scope.assert.includes(result.stdout, `nested (${authoringSmokeFile}:`);
        scope.assert.includes(result.stdout, `passes (${authoringSmokeFile}:`);

        return scope.assert.collect();
    }),
    test('custom facade alias creates filtered runnable testNode exports', async function (scope) {
        const { writePackageSmokeProject, spawnNode } = scope.resources.consumer;

        await writePackageSmokeProject();

        const result = await spawnNode([
            overkillBinEntryPointPath,
            'run',
            '--filter',
            'tag=custom-authoring',
            customAuthoringSmokeFile
        ]);

        scope.assert.equal(result.code, 0);
        scope.assert.equal(result.stderr, '');
        scope.assert.equal(result.stdout, '');

        return scope.assert.collect();
    }),
    test('imports @overkill-dev/run subpath helpers', async function (scope) {
        const { spawnNode } = scope.resources.consumer;

        const packageExports = await readPackageExports(runPackageFolder, '@overkill-dev/run');
        const result = await spawnNode([
            '--input-type=module',
            '--eval',
            runSubpathImportScript
        ]);
        const filters = await importPackagedFilters(runPackageFolder);

        scope.assert(assertRunConfigSubpathExport, packageExports);
        scope.assert(assertRunResourceLifecycleSubpathExport, packageExports);
        scope.assert(defineCompositeAssertion({
            name: 'imports @overkill-dev/run subpath helpers',
            assert(check) {
                return check.group([ check.equal(result.code, 0), check.equal(result.stderr, '') ]);
            }
        }));
        scope.assert.equal(result.stdout, expectedRunSubpathImportOutput);
        scope.assert(assertPackagedFilters, filters);

        return scope.assert.collect();
    })
]);
