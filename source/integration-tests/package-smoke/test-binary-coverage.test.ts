import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { suite } from '@overkill-dev/test';

import { consumerEnvironment } from './support/consumer-environment.ts';
import {
    coverageConfigScript,
    coverageSmokeScript,
    coverageTypeScriptSource
} from './support/package-coverage-scripts.ts';
import { packageConsumer } from './support/package-consumer.ts';

const { test } = packageConsumer('Installed CLI coverage', function consumerFixture(directory) {
    return { directory };
});

async function runPackagedCoverage(directory: string): Promise<string> {
    const binary = join(directory, 'node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js');
    return await new Promise(function executeCoverage(resolve, reject) {
        execFile(
            binary,
            [ 'run', '--coverage', '--config', 'coverage-overkill.config.js', 'coverage-smoke.test.mjs' ],
            { env: consumerEnvironment(directory), cwd: directory },
            function collectResult(error, stdout, stderr) {
                if (error instanceof Error) {
                    reject(new Error(`Packaged coverage failed:\n${stdout}${stderr}`, { cause: error }));
                } else {
                    resolve(stdout);
                }
            }
        );
    });
}

async function writeCoverageProject(directory: string): Promise<void> {
    await Promise.all([
        writeFile(join(directory, 'coverage-overkill.config.js'), coverageConfigScript),
        writeFile(join(directory, 'coverage-source.ts'), coverageTypeScriptSource),
        writeFile(join(directory, 'coverage-types.ts'), 'export type Value = number;\n'),
        writeFile(join(directory, 'coverage-smoke.test.mjs'), coverageSmokeScript)
    ]);
}

function coveredSourceRecord(lcov: string): string {
    const record = lcov.split('end_of_record').find(function describesConsumerSource(candidate) {
        return candidate.includes('SF:coverage-source.ts\n');
    });
    if (record === undefined) {
        throw new Error('Coverage report omitted the consumer source.');
    }
    return record;
}

export const testNode = suite('Installed CLI coverage', [
    test('reports supervised consumer source coverage', async function (scope) {
        const { directory } = scope.resources.consumer;
        await writeCoverageProject(directory);

        scope.assert.match(await runPackagedCoverage(directory), /^ {2}1 executed · [\d.]+ (?:µs|ms|s) execution · /mu);
        const lcov = await readFile(join(directory, 'coverage-smoke/lcov.info'), 'utf8');
        const record = coveredSourceRecord(lcov);

        scope.assert.includes(record, 'DA:3,3\n');
        scope.assert.includes(record, 'BRF:2\nBRH:2\n');
        scope.assert.false(lcov.includes('SF:coverage-smoke.test.mjs'));
        scope.assert.false(lcov.includes('coverage-types.ts'));
        return scope.assert.collect();
    })
]);
