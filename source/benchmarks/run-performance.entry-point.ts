import { execFile, type ExecFileOptions } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';
import { writeBenchmarkTemplate, writeConsumer, writeStartupConsumer } from './consumer-fixture.ts';
import { captureReference, readReference, verifyPerformance } from './performance-evidence.ts';
import { performanceCases, startupCases } from './performance-cases.ts';

const argumentOffset = 2;
const jsonIndent = 4;
const regularSamples = 20;
const captureSamples = 3;

async function commandOutput(executable: string, args: readonly string[], options: ExecFileOptions): Promise<string> {
    return await new Promise(function collectOutput(resolve, reject) {
        execFile(
            executable,
            Array.from(args),
            { ...options, encoding: 'utf8' },
            function completed(error, stdout, stderr) {
                if (error === null) {
                    resolve(stdout);
                } else {
                    reject(new Error(`${executable} failed.\n${stdout}\n${stderr}`, { cause: error }));
                }
            }
        );
    });
}

const modeSchema = z.enum([ 'run', 'capture', 'compare' ]);
const [ rawMode, outputPath, selection = 'all', baselinePath = '', compiler = 'cc' ] = process.argv.slice(
    argumentOffset
);
const mode = modeSchema.parse(rawMode);
const samples = mode === 'capture' ? captureSamples : regularSamples;
if (outputPath === undefined || mode !== 'run' && baselinePath === '') {
    throw new Error([
        'Usage: run-performance.entry-point.ts <run|capture|compare> <output directory>',
        '[all|startup|case-id] [reference file] [compiler]'
    ]
        .join(' '));
}
if (process.platform !== 'linux' && process.platform !== 'darwin') {
    throw new Error('Performance measurement supports Linux and Darwin.');
}
const modules = fileURLToPath(new URL('../../node_modules/', import.meta.url));
const output = resolvePath(outputPath);
const selectedCases = performanceCases
    .filter(function (spec) {
        return selection === 'all' || selection === spec.id;
    })
    .map(function describeTerminal(spec) {
        return { ...spec, terminal: spec.workload.endsWith('-pty') };
    });
const startupIds = startupCases.filter(function (id) {
    return [ 'all', 'startup', id ].includes(selection);
});
const caseIds = [
    ...startupIds,
    ...selectedCases.map(function (spec) {
        return spec.id;
    })
];
if (caseIds.length === 0) {
    throw new Error(`Unknown performance selection: ${selection}`);
}

const baseline = mode === 'compare'
    ? readReference(JSON.parse(await readFile(baselinePath, 'utf8')))
    : {};
if (
    mode === 'compare' && caseIds.some(function (id) {
        return !Object.hasOwn(baseline, id);
    })
) {
    throw new Error('The reference does not cover the selected workload inventory.');
}

await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const workspace = await realpath(output);
const launcher = join(workspace, 'command-usage');
const environment = { PATH: [ dirname(process.execPath), '/usr/bin', '/bin' ].join(':'), LANG: 'C', TZ: 'UTC' };
const rootImport = new URL('../packages/test/test.entry-point.ts', import.meta.url);
const cli = fileURLToPath(new URL('../packages/test/overkill.entry-point.ts', import.meta.url));
const startupDirectory = join(workspace, 'startup');
await writeStartupConsumer(startupDirectory);
const needsNativeLauncher = selectedCases.some(function usesNativeLauncher(spec) {
    return !spec.terminal;
});
if (needsNativeLauncher) {
    const nativeSource = fileURLToPath(new URL('./command-usage.c', import.meta.url));
    await commandOutput(compiler, [
        '-std=c11',
        '-Wall',
        '-pedantic-errors',
        '-O2',
        nativeSource,
        '-o',
        launcher
    ], {});
}
const cases = await Promise.all(selectedCases.map(async function (spec) {
    const directory = join(workspace, spec.id);
    await writeConsumer(directory, modules, spec);
    if (spec.workload === 'straggler') {
        await commandOutput(process.execPath, [ join(directory, 'consumer-driver.mjs') ], {
            cwd: directory,
            env: { ...environment, OVERKILL_PERFORMANCE_PRIME: 'yes' }
        });
    }
    return { ...spec, directory };
}));
await writeFile(
    join(workspace, 'measurement.json'),
    JSON.stringify({
        mode,
        samples,
        cases,
        baseline,
        launcher,
        environment,
        cli,
        startupIds,
        startup: { directory: startupDirectory, rootImport: rootImport.href }
    })
);
for (const script of [ 'performance-suite.mjs', 'performance-config.mjs' ]) {
    await writeBenchmarkTemplate(workspace, script);
}

await commandOutput(process.execPath, [
    cli,
    'bench',
    'run',
    '--config',
    'performance-config.mjs',
    '--profile',
    'performance',
    '--seed',
    '42',
    '--order',
    'lexical'
], { cwd: workspace, env: environment });

const result: unknown = JSON.parse(await readFile(join(workspace, 'measurements.json'), 'utf8'));
if (mode === 'compare') {
    verifyPerformance(result, caseIds, samples);
} else {
    const captured = captureReference(result, caseIds, samples);
    const destination = mode === 'capture' ? baselinePath : join(workspace, 'reference.json');
    await writeFile(destination, `${JSON.stringify(captured, null, jsonIndent)}\n`, { flag: 'wx' });
}
process.stdout.write(
    `Verified ${caseIds.length} performance workloads (${mode}). Report: ${join(workspace, 'report.html')}\n`
);
