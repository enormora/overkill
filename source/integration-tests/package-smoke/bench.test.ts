import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSuite, createTestCase, type TestScope } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';
import { runIfMain } from './direct-launcher.test.ts';
import {
    benchAuthoringScript,
    benchMacroScript,
    benchmarkSelectionConfigScript,
    benchmarkCommandsScript,
    standardBenchConsumerConfigScript,
    standardBenchConsumerScript
} from './bench-scripts.test.ts';

type ScriptOutput = {
    readonly exitCode: number;
    readonly stderr: string;
    readonly stdout: string;
};

async function executeNode(nodeArguments: readonly string[], cwd: string): Promise<ScriptOutput> {
    return await new Promise(function executeScript(resolve, reject) {
        execFile(process.execPath, Array.from(nodeArguments), {
            cwd,
            encoding: 'utf8'
        }, function collectResult(error, stdout, stderr) {
            if (!(error instanceof Error)) {
                resolve({ exitCode: 0, stderr, stdout });

                return;
            }

            if (typeof error.code !== 'number') {
                reject(error);

                return;
            }

            resolve({ exitCode: error.code, stderr, stdout });
        });
    });
}

async function createStandardBenchConsumer(scope: TestScope): Promise<string> {
    const consumerFolder = await mkdtemp(path.join(tmpdir(), 'overkill-standard-bench-'));

    scope.cleanup(async function removeConsumer() {
        await rm(consumerFolder, { force: true, recursive: true });
    });
    const packageScopeFolder = path.join(consumerFolder, 'node_modules/@overkill-dev');

    await mkdir(packageScopeFolder, { recursive: true });
    await cp(
        path.join(import.meta.dirname, 'node_modules/@overkill-dev/test'),
        path.join(packageScopeFolder, 'test'),
        { recursive: true }
    );
    await writeFile(path.join(consumerFolder, 'overkill.config.mjs'), standardBenchConsumerConfigScript);
    await writeFile(path.join(consumerFolder, 'bench.test.mjs'), standardBenchConsumerScript);
    return consumerFolder;
}

export const testNode = createSuite({
    annotations: {},
    children: [
        createTestCase({
            annotations: {},
            async body(scope) {
                const result = await executeNode(
                    [ '--input-type=module', '--eval', benchAuthoringScript ],
                    import.meta.dirname
                );

                scope.assert.equal(result.exitCode, 0);
                scope.assert.equal(result.stdout, 'bench authoring passed\n');
                scope.assert.equal(result.stderr, '');
                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'packaged bench facade composes with standard authoring and the public engine'
        }),
        createTestCase({
            annotations: {},
            async body(scope) {
                const result = await executeNode(
                    [ '--input-type=module', '--eval', benchMacroScript ],
                    import.meta.dirname
                );

                scope.assert.equal(result.exitCode, 0);
                scope.assert.equal(result.stdout, 'bench macro locations passed\n');
                scope.assert.equal(result.stderr, '');
                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'packaged copies share nested macro locations and restore them after errors'
        }),
        createTestCase({
            annotations: {},
            async body(scope) {
                const consumerFolder = await createStandardBenchConsumer(scope);
                const result = await executeNode([
                    path.join(consumerFolder, 'node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js'),
                    'run',
                    '--config',
                    'overkill.config.mjs',
                    'bench.test.mjs'
                ], consumerFolder);

                scope.assert.equal(result.exitCode, 0);
                scope.assert.equal(result.stderr, '');
                scope.assert.includes(result.stdout, '(4 pass, 0 fail, 1 skip)');
                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'standard-only installation runs benchmark authoring through the packaged binary'
        }),
        createTestCase({
            annotations: {},
            async body(scope) {
                const consumerFolder = await createStandardBenchConsumer(scope);
                await writeFile(path.join(consumerFolder, 'overkill.config.js'), benchmarkSelectionConfigScript);
                await writeFile(
                    path.join(consumerFolder, 'startup.bench.mjs'),
                    standardBenchConsumerScript
                );
                await writeFile(
                    path.join(import.meta.dirname, 'benchmark-command-consumer.mjs'),
                    benchmarkCommandsScript
                );
                scope.cleanup(async function removeBenchmarkConsumer() {
                    await rm(path.join(import.meta.dirname, 'benchmark-command-consumer.mjs'), { force: true });
                });
                const result = await executeNode(
                    [ path.join(import.meta.dirname, 'benchmark-command-consumer.mjs'), consumerFolder ],
                    import.meta.dirname
                );

                scope.assert.equal(result.exitCode, 0);
                scope.assert.includes(result.stdout, 'benchmark selection passed\n');
                scope.assert.equal(result.stderr, '');
                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'packaged singleton and constructed runners share benchmark profile selection'
        }),
        ...[ 'run', 'list' ].flatMap(function createPackagedBenchmarkCommandTests(verb) {
            return [
                createTestCase({
                    annotations: {},
                    async body(scope) {
                        const consumerFolder = await createStandardBenchConsumer(scope);
                        await writeFile(
                            path.join(consumerFolder, 'overkill.config.js'),
                            benchmarkSelectionConfigScript
                        );
                        await writeFile(
                            path.join(consumerFolder, 'startup.bench.mjs'),
                            standardBenchConsumerScript
                        );
                        for (const selection of [ [], [ '--profile=startup', '--config', 'overkill.config.js' ] ]) {
                            const result = await executeNode([
                                path.join(
                                    consumerFolder,
                                    'node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js'
                                ),
                                'bench',
                                verb,
                                ...selection,
                                'startup.bench.mjs'
                            ], consumerFolder);

                            scope.assert.equal(result.exitCode, 0);
                            scope.assert.equal(result.stderr, '');
                            scope.assert.includes(result.stdout, 'parameterized');
                        }

                        return scope.assert.collect();
                    },
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' } ],
                    title:
                        `standard-only installation selects bench ${verb} profiles and executes the shared runner flow`
                }),
                createTestCase({
                    annotations: {},
                    async body(scope) {
                        const consumerFolder = await createStandardBenchConsumer(scope);
                        const result = await executeNode([
                            path.join(
                                consumerFolder,
                                'node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js'
                            ),
                            'bench',
                            verb,
                            '--help'
                        ], consumerFolder);

                        scope.assert.equal(result.exitCode, 0);
                        scope.assert.equal(result.stderr, '');
                        scope.assert.includes(result.stdout, `overkill bench ${verb}`);
                        scope.assert.includes(result.stdout, '--config');
                        scope.assert.includes(result.stdout, '--profile');

                        return scope.assert.collect();
                    },
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' } ],
                    title: `standard-only installation exposes bench ${verb} help`
                })
            ];
        })
    ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/package-smoke/bench.test.ts'
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
