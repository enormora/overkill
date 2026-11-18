import { spawn } from 'node:child_process';
import { glob } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import coverageConfiguration from '../../.c8rc.json' with { type: 'json' };
import { createCoverageSourceCache } from '../run/coverage-runtime-source.ts';

const sources = createCoverageSourceCache();
const nonExecutableSources: string[] = [];

const eligibleSources = glob('source/**/*.ts', { exclude: coverageConfiguration.exclude });

for await (const file of eligibleSources) {
    if (!sources.inspect(await sources.read(file), file).hasRuntime) {
        nonExecutableSources.push(file);
    }
}

const coverageArguments = [
    fileURLToPath(import.meta.resolve('c8/bin/c8.js')),
    '--config',
    '.c8rc.json',
    ...[ ...coverageConfiguration.exclude, ...nonExecutableSources ].flatMap(function excludeCoverageSource(file) {
        return [ '--exclude', file ];
    }),
    process.execPath,
    'source/overkill.test.ts'
];

process.exitCode = await new Promise<number>(function collectCoverageExit(resolve, reject) {
    const coverage = spawn(process.execPath, coverageArguments, { stdio: 'inherit' });

    coverage.once('error', reject);
    coverage.once('close', function coverageCompleted(code) {
        resolve(code ?? 1);
    });
});
