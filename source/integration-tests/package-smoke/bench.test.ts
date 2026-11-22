import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';

import path from 'node:path';
import {
    defineCompositeAssertion,
    type CompositeCheckBuilder,
    type CompositeAssertionReturn
} from '@overkill-dev/test/assert';

import { suite } from '@overkill-dev/test';

import { z } from 'zod/v4';
import { consumerEnvironment } from './support/consumer-environment.ts';
import { packageConsumer } from './support/package-consumer.ts';

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
        execFile(process.execPath, [ '--disable-warning=PERM0004', ...Array.from(nodeArguments) ], {
            env: consumerEnvironment(cwd),
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
const successfulCommandChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    result: ScriptOutput
): CompositeAssertionReturn<'assert'> {
    return check.group([ check.equal(result.exitCode, 0), check.equal(result.stderr, '') ]);
};
const assertSuccessfulCommand = defineCompositeAssertion({
    name: 'successful command',
    assert: successfulCommandChecks
});

const captureFixedCalibration = defineCompositeAssertion({
    name: 'capture fixed calibration',
    async assert(check, binary: string, consumerFolder: string) {
        const captured = await executeNode([ binary, 'bench', 'calibrate', '--profile', 'normalized' ], consumerFolder);
        const initialChecks = check.group([
            successfulCommandChecks(check.annotated('successful command'), captured),
            check.includes(captured.stdout, 'Captured calibration reference')
        ]);
        await useFasterCalibrationReference(consumerFolder);
        return initialChecks;
    }
});

const assertUncapturedCommands = defineCompositeAssertion({
    name: 'uncaptured commands',
    async assert(check, binary: string, consumerFolder: string) {
        const listed = await executeNode(
            [ binary, 'bench', 'list', '--profile', 'normalized' ],
            consumerFolder
        );
        const initialChecks = successfulCommandChecks(check.annotated('successful command'), listed);
        const files = await readdir(consumerFolder);
        const intermediateChecks = check.false(files.includes('references'));
        const uncaptured = await executeNode(
            [ binary, 'bench', 'run', '--profile', 'normalized' ],
            consumerFolder
        );
        return check.group([
            initialChecks,
            intermediateChecks,
            successfulCommandChecks(check.annotated('successful command'), uncaptured),
            check.match(uncaptured.stdout, /Run passed · 1 passed · [\d.]+ (?:µs|ms|s)$/mu)
        ]);
    }
});

const consumerFacade = packageConsumer('Installed benchmark API', function consumerFixture(consumerDirectory) {
    async function createStandardBenchConsumer(): Promise<string> {
        const consumerFolder = await mkdtemp(path.join(consumerDirectory, 'overkill-standard-bench-'));
        const packageScopeFolder = path.join(consumerFolder, 'node_modules/@overkill-dev');

        await mkdir(packageScopeFolder, { recursive: true });
        await cp(
            path.join(consumerDirectory, 'node_modules/@overkill-dev/test'),
            path.join(packageScopeFolder, 'test'),
            { recursive: true }
        );
        await writeFile(path.join(consumerFolder, 'overkill.config.mjs'), standardBenchConsumerConfigScript);
        await writeFile(path.join(consumerFolder, 'bench.test.mjs'), standardBenchConsumerScript);
        return consumerFolder;
    }
    return { createStandardBenchConsumer, consumerDirectory };
});
const { test } = consumerFacade;

export const testNode = suite('Installed benchmark API', [
    test(
        'standard-only installation captures and normalizes declared calibration resources',
        async function (scope) {
            const { createStandardBenchConsumer } = scope.resources.consumer;

            const consumerFolder = await createStandardBenchConsumer();
            await Promise.all([
                writeFile(path.join(consumerFolder, 'overkill.config.js'), normalizedBenchConfigScript),
                writeFile(path.join(consumerFolder, 'normalization.bench.mjs'), normalizedBenchFixtureScript)
            ]);
            const binary = path.join(
                consumerFolder,
                'node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js'
            );
            await scope.assert(assertUncapturedCommands, binary, consumerFolder);
            await scope.assert(captureFixedCalibration, binary, consumerFolder);
            const measured = await executeNode(
                [ binary, 'bench', 'run', '--profile', 'normalized' ],
                consumerFolder
            );
            scope.assert(assertSuccessfulCommand, measured);
            scope.assert.match(measured.stdout, /Run passed · 1 passed · [\d.]+ (?:µs|ms|s)$/mu);
            return scope.assert.collect();
        }
    ),
    test(
        'standard-only installation runs real calibration through benchmark baseline commands',
        async function (scope) {
            const { createStandardBenchConsumer } = scope.resources.consumer;

            const consumerFolder = await createStandardBenchConsumer();
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
    test('bench facade composes with standard authoring and the public engine', async function (scope) {
        const { consumerDirectory } = scope.resources.consumer;

        const result = await executeNode(
            [ '--input-type=module', '--eval', benchAuthoringScript ],
            consumerDirectory
        );

        scope.assert.equal(result.exitCode, 0);
        scope.assert.equal(result.stdout, 'bench authoring passed\n');
        scope.assert.equal(result.stderr, '');
        return scope.assert.collect();
    }),
    test('copies share nested macro locations and restore them after errors', async function (scope) {
        const { consumerDirectory } = scope.resources.consumer;

        const result = await executeNode(
            [ '--input-type=module', '--eval', benchMacroScript ],
            consumerDirectory
        );

        scope.assert.equal(result.exitCode, 0);
        scope.assert.equal(result.stdout, 'bench macro locations passed\n');
        scope.assert.equal(result.stderr, '');
        return scope.assert.collect();
    }),
    test(
        'standard-only installation runs benchmark authoring through the packaged binary',
        async function (scope) {
            const { createStandardBenchConsumer } = scope.resources.consumer;

            const consumerFolder = await createStandardBenchConsumer();
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
    test('singleton and constructed runners share benchmark profile selection', async function (scope) {
        const { createStandardBenchConsumer, consumerDirectory } = scope.resources.consumer;

        const consumerFolder = await createStandardBenchConsumer();
        await writeFile(path.join(consumerFolder, 'overkill.config.js'), benchmarkSelectionConfigScript);
        await writeFile(
            path.join(consumerFolder, 'startup.bench.mjs'),
            standardBenchConsumerScript
        );
        await writeFile(
            path.join(consumerDirectory, 'benchmark-command-consumer.mjs'),
            benchmarkCommandsScript
        );
        const result = await executeNode(
            [ path.join(consumerDirectory, 'benchmark-command-consumer.mjs'), consumerFolder ],
            consumerDirectory
        );

        scope.assert.equal(result.exitCode, 0);
        scope.assert.includes(result.stdout, 'benchmark selection passed\n');
        scope.assert.equal(result.stderr, '');
        return scope.assert.collect();
    }),
    test('standard-only installation runs a selected benchmark profile', async function (scope) {
        const { createStandardBenchConsumer } = scope.resources.consumer;
        const consumerFolder = await createStandardBenchConsumer();
        await writeFile(path.join(consumerFolder, 'overkill.config.js'), benchmarkSelectionConfigScript);
        await writeFile(path.join(consumerFolder, 'startup.bench.mjs'), standardBenchConsumerScript);

        const result = await executeNode([
            path.join(consumerFolder, 'node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js'),
            'bench',
            'run',
            '--profile=startup',
            '--config',
            'overkill.config.js',
            'startup.bench.mjs'
        ], consumerFolder);

        scope.assert(assertSuccessfulCommand, result);
        scope.assert.includes(result.stdout, 'parameterized');
        return scope.assert.collect();
    })
]);
