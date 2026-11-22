import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { table, type TestNode, suite, test, type TestScope } from '#tests';

import { z } from 'zod/v4';

import { normalizedBenchConfigScript, normalizedBenchFixtureScript } from './support/normalization-scripts.ts';
import {
    benchAuthoringScript,
    benchMacroScript,
    benchmarkSelectionConfigScript,
    benchmarkCommandsScript,
    standardBenchConsumerConfigScript,
    standardBenchConsumerScript
} from './support/bench-scripts.ts';

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

const calibrationReferenceSchema = z.looseObject({
    snapshot: z.looseObject({ samples: z.array(z.number().positive()) })
});
async function useFasterCalibrationReference(consumerFolder: string): Promise<void> {
    const directory = path.join(consumerFolder, 'references/calibration');
    const [ name ] = await readdir(directory);
    if (name === undefined) {
        throw new Error('Missing captured calibration reference.');
    }
    const filename = path.join(directory, name);
    const reference = calibrationReferenceSchema.parse(JSON.parse(await readFile(filename, 'utf8')));
    const samples = reference.snapshot.samples.map(function fasterSample(value) {
        return value / 2;
    });
    await writeFile(filename, JSON.stringify({ ...reference, snapshot: { ...reference.snapshot, samples } }));
}
function assertSuccessfulCommand(scope: TestScope, result: ScriptOutput): void {
    scope.assert.equal(result.exitCode, 0);
    scope.assert.equal(result.stderr, '');
}

async function captureFixedCalibration(scope: TestScope, binary: string, consumerFolder: string): Promise<void> {
    const captured = await executeNode([ binary, 'bench', 'calibrate', '--profile', 'normalized' ], consumerFolder);
    assertSuccessfulCommand(scope, captured);
    scope.assert.includes(captured.stdout, 'Captured calibration reference');
    await useFasterCalibrationReference(consumerFolder);
}

async function assertUncapturedCommands(scope: TestScope, binary: string, consumerFolder: string): Promise<void> {
    const listed = await executeNode(
        [ binary, 'bench', 'list', '--profile', 'normalized' ],
        consumerFolder
    );
    assertSuccessfulCommand(scope, listed);
    const files = await readdir(consumerFolder);
    scope.assert.false(files.includes('references'));
    const uncaptured = await executeNode(
        [ binary, 'bench', 'run', '--profile', 'normalized' ],
        consumerFolder
    );
    assertSuccessfulCommand(scope, uncaptured);
    scope.assert.match(uncaptured.stdout, /Run passed · 1 passed · [\d.]+ (?:µs|ms|s)$/mu);
}

export const testNode: TestNode = suite('Bench', [
    test(
        'standard-only installation captures and normalizes declared calibration resources',
        async function (scope) {
            const consumerFolder = await createStandardBenchConsumer(scope);
            await writeFile(path.join(consumerFolder, 'overkill.config.js'), normalizedBenchConfigScript);
            await writeFile(path.join(consumerFolder, 'normalization.bench.mjs'), normalizedBenchFixtureScript);
            const binary = path.join(
                consumerFolder,
                'node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js'
            );
            await assertUncapturedCommands(scope, binary, consumerFolder);
            await captureFixedCalibration(scope, binary, consumerFolder);
            const measured = await executeNode(
                [ binary, 'bench', 'run', '--profile', 'normalized' ],
                consumerFolder
            );
            assertSuccessfulCommand(scope, measured);
            scope.assert.match(measured.stdout, /Run passed · 1 passed · [\d.]+ (?:µs|ms|s)$/mu);
            return scope.assert.collect();
        }
    ),
    test(
        'standard-only installation runs real calibration through benchmark baseline commands',
        async function (scope) {
            const consumerFolder = await createStandardBenchConsumer(scope);
            await writeFile(path.join(consumerFolder, 'overkill.config.js'), benchmarkSelectionConfigScript);
            await writeFile(path.join(consumerFolder, 'startup.bench.mjs'), standardBenchConsumerScript);
            const result = await executeNode([
                path.join(consumerFolder, 'node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js'),
                'bench',
                'baseline',
                'bootstrap',
                '--profile',
                'startup'
            ], consumerFolder);
            scope.assert.equal(result.exitCode, 0);
            scope.assert.equal(result.stderr, '');
            scope.assert.match(result.stdout, /Run passed · 4 passed · 1 skipped · [\d.]+ (?:µs|ms|s)$/mu);
            return scope.assert.collect();
        }
    ),
    test('packaged bench facade composes with standard authoring and the public engine', async function (scope) {
        const result = await executeNode(
            [ '--input-type=module', '--eval', benchAuthoringScript ],
            import.meta.dirname
        );

        scope.assert.equal(result.exitCode, 0);
        scope.assert.equal(result.stdout, 'bench authoring passed\n');
        scope.assert.equal(result.stderr, '');
        return scope.assert.collect();
    }),
    test('packaged copies share nested macro locations and restore them after errors', async function (scope) {
        const result = await executeNode(
            [ '--input-type=module', '--eval', benchMacroScript ],
            import.meta.dirname
        );

        scope.assert.equal(result.exitCode, 0);
        scope.assert.equal(result.stdout, 'bench macro locations passed\n');
        scope.assert.equal(result.stderr, '');
        return scope.assert.collect();
    }),
    test(
        'standard-only installation runs benchmark authoring through the packaged binary',
        async function (scope) {
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
            scope.assert.match(result.stdout, /Run passed · 4 passed · 1 skipped · [\d.]+ (?:µs|ms|s)$/mu);
            return scope.assert.collect();
        }
    ),
    test('packaged singleton and constructed runners share benchmark profile selection', async function (scope) {
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
    }),
    table({
        title: 'standard-only installation selects bench profiles and executes the shared runner flow',
        cases: [ 'run', 'list' ].flatMap(function createPackagedBenchmarkCommandTests(verb) {
            return { verb };
        }),
        caseTitle({ verb }) {
            return [ verb ].map(String).join(', ');
        },
        async test(scope) {
            const { verb } = scope.parameters;

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
        }
    }),
    table({
        title: 'standard-only installation exposes bench help',
        cases: [ 'run', 'list' ].flatMap(function createPackagedBenchmarkCommandTests(verb) {
            return { verb };
        }),
        caseTitle({ verb }) {
            return [ verb ].map(String).join(', ');
        },
        async test(scope) {
            const { verb } = scope.parameters;

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
        }
    })
]);
