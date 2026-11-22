import { execFile } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';

import { join } from 'node:path';
import { consumerEnvironment } from './support/consumer-environment.ts';
import { packageConsumer } from './support/package-consumer.ts';

import { resolvePackagedExport } from './support/packaged-module.ts';

const modules = {
    core: import.meta.resolve('@stryker-mutator/core'),
    engine: await resolvePackagedExport('@overkill-dev/engine'),
    config: await resolvePackagedExport('@overkill-dev/run/config')
};

const campaign = `
import assert from 'node:assert/strict';
const { Stryker } = await import(${JSON.stringify(modules.core)});
const adapter = import.meta.resolve('@overkill-dev/stryker-runner');
const { strykerPlugins } = await import(adapter);
process.chdir(process.argv[1]);
assert.equal(strykerPlugins.length, 1);
assert.equal(strykerPlugins[0].kind, 'TestRunner');
assert.equal(strykerPlugins[0].name, 'overkill');
const results = await new Stryker({
    testRunner: 'overkill',
    plugins: [adapter],
    files: ['subject.mjs', 'case.test.mjs', 'overkill.config.mjs', 'package.json'],
    mutate: ['subject.mjs'],
    testFiles: ['case.test.mjs'],
    overkill: { configPath: 'overkill.config.mjs', profile: 'microtest', seed: '42' },
    concurrency: 1,
    coverageAnalysis: 'perTest',
    reporters: [],
    logLevel: 'off',
    fileLogLevel: 'off',
    incremental: false,
    cleanTempDir: 'always'
}).runMutationTest();
assert.equal(results.length, 1);
assert.equal(results[0].mutatorName, 'BooleanLiteral');
assert.equal(results[0].status, 'Killed');
process.stdout.write('packaged Stryker campaign passed\\n');
`;

const consumerFacade = packageConsumer(
    'installed Stryker plugin kills one mutant in a one-line module',
    function consumerFixture(consumerDirectory) {
        async function runPackagedCampaign(cwd: string): Promise<string> {
            return await new Promise(function collectCampaign(resolve, reject) {
                execFile(
                    process.execPath,
                    [ '--input-type=module', '--eval', campaign, cwd ],
                    {
                        env: consumerEnvironment(consumerDirectory),
                        cwd: consumerDirectory,
                        timeout: 60_000
                    },
                    function completed(error, stdout, stderr) {
                        if (error === null) {
                            resolve(stdout);
                        } else {
                            reject(new Error(`${stdout}\n${stderr}`, { cause: error }));
                        }
                    }
                );
            });
        }
        return { consumerDirectory, runPackagedCampaign };
    }
);
const { test } = consumerFacade;

export const testNode = test(
    'installed Stryker plugin kills one mutant in a one-line module',
    async function (scope) {
        const { consumerDirectory, runPackagedCampaign } = scope.resources.consumer;

        const cwd = await realpath(await mkdtemp(join(consumerDirectory, 'overkill-package-stryker-')));
        await writeFile(join(cwd, 'package.json'), '{"type":"module"}');
        await writeFile(join(cwd, 'subject.mjs'), 'export const value = true;\n');
        await writeFile(
            join(cwd, 'overkill.config.mjs'),
            `
import { defineConfig } from ${JSON.stringify(modules.config)};
export const config = defineConfig({ profiles: { microtest: {
    testFamily: 'microtest',
    files: { include: ['case.test.mjs'] },
    execution: { processModel: 'in-process' },
    timeouts: { collectionMilliseconds: 30000, softMilliseconds: 5000, hardMilliseconds: 10000 }
} } });
`
        );
        await writeFile(
            join(cwd, 'case.test.mjs'),
            `
import { createTestCase } from ${JSON.stringify(modules.engine)};
import { value } from './subject.mjs';
export const testNode = createTestCase({
    title: 'value', annotations: {}, controls: {}, definitionLocations: [{kind:'unknown'}],
    body(scope) { scope.assert.equal(value, true); return scope.assert.collect(); }
});
`
        );
        scope.assert.equal(await runPackagedCampaign(cwd), 'packaged Stryker campaign passed\n');
        return scope.assert.collect();
    }
);
