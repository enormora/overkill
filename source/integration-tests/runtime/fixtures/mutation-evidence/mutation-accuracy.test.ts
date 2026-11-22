import { readFile, readdir, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod/v4';
import { createClock } from '@enormora/clock';
import { execFile } from 'node:child_process';
import {
    withMutationProject,
    writeAccuracyProject,
    type MutationMode,
    type MutationModuleUrls
} from './mutation-project.test.ts';

import { campaignEvidenceSchema, compareMutationCampaigns, type CampaignEvidence, type MutationCoverageMode } from '../../../../test-support/mutation-campaign-evidence.ts';
const positionSchema = z.strictObject({ line: z.number().int().positive(), column: z.number().int().nonnegative() });
const campaignResultSchema = z.strictObject({
    results: z.array(z.object({
        fileName: z.string(),
        location: z.strictObject({ start: positionSchema, end: positionSchema }),
        mutatorName: z.string(),
        replacement: z.string(),
        status: z.string(),
        statusReason: z.string().nullable().default(null),
        killedBy: z.array(z.string()).default([]),
        testsCompleted: z.number().int().nonnegative().default(0)
    }))
});

const campaignScript = `
import assert from 'node:assert/strict';
const [modules, mode, seed, coverage, catalog, files, plugins, targets] = JSON.parse(process.argv[1]);
const { Stryker } = await import(modules.core);
const results = await new Stryker({
    testRunner:'overkill', plugins, reporters:catalog ? ['catalog'] : [],
    files, mutate:[...targets, '!*.test.mjs', '!overkill.config.mjs', '!catalog-reporter.mjs', '!cost-lifecycle.mjs'],
    testFiles:files.filter(file => file.endsWith('.test.mjs')),
    overkill:{configPath:'overkill.config.mjs', freshState:mode.freshState, seed},
    mutator:{excludedMutations:['BlockStatement']}, concurrency:1, maxTestRunnerReuse:1000,
    disableBail:true, incremental:false, coverageAnalysis:coverage,
    logLevel:'off', fileLogLevel:'off', timeoutMS:30000, dryRunTimeoutMinutes:2, cleanTempDir:'always'
}).runMutationTest();
const excluded = results.filter(result => result.mutatorName === 'BlockStatement');
for (const result of excluded) {
    assert.equal(result.status, 'Ignored');
    assert.equal(result.statusReason, 'Ignored because of excluded mutation "BlockStatement"');
}
process.stdout.write(JSON.stringify({results:results.filter(result => result.mutatorName !== 'BlockStatement')}));
`;

type CampaignRequest = {
    readonly modules: MutationModuleUrls;
    readonly mode: MutationMode;
    readonly seed: string;
    readonly coverage: MutationCoverageMode;
    readonly catalog: boolean;
    readonly targets: readonly string[];
    readonly reload: 'unchanged' | 'native' | 'replace-worker';
};

export async function runMutationCampaign(
    request: CampaignRequest
): Promise<{ readonly results: z.infer<typeof campaignResultSchema>['results']; readonly durationMicroseconds: number; readonly workers: number; readonly configResolutions: number; readonly reloadRequests: number; }> {
    const { modules, mode, seed, coverage, catalog, targets, reload } = request;
    const files = (await readdir('.')).filter(file => file === 'package.json' || file.endsWith('.mjs') && file !== 'reload-plugin.mjs');
    const plugins = [ modules.adapter ];
    if (reload !== 'unchanged') {
        await writeFile('reload-trace', '');
        await writeFile('reload-plugin.mjs', `
import { appendFileSync } from 'node:fs';
import { strykerPlugins as adapterPlugins, strykerValidationSchema } from ${JSON.stringify(modules.adapter)};
import { declareFactoryPlugin, PluginKind } from ${JSON.stringify(modules.plugin)};
export { strykerValidationSchema };
const trace = event => appendFileSync(${JSON.stringify(process.cwd() + '/reload-trace')}, event + '\\n');
function createRunner(...args) {
    const runner = adapterPlugins[0].factory(...args);
    trace('worker ' + process.pid);
    return {
        ...runner,
        async init() {
            await runner.init();
            trace('config ' + process.pid);
        },
        async capabilities() {
            const capabilities = await runner.capabilities();
            return ${JSON.stringify(reload)} === 'replace-worker' ? { ...capabilities, reloadEnvironment: false } : capabilities;
        },
        mutantRun(options) {
            if (options.reloadEnvironment) trace('reload');
            return runner.mutantRun(options);
        }
    };
}
createRunner.inject = adapterPlugins[0].factory.inject;
export const strykerPlugins = [declareFactoryPlugin(PluginKind.TestRunner, 'overkill', createRunner)];
`);
        plugins[0] = pathToFileURL(process.cwd() + '/reload-plugin.mjs').href;
    }
    if (catalog) {
        await writeFile(
            'catalog-reporter.mjs',
            `
import { writeFileSync } from 'node:fs';
import { TestStatus } from ${JSON.stringify(modules.testRunner)};
import { declareFactoryPlugin, PluginKind } from ${JSON.stringify(modules.plugin)};
export const strykerPlugins = [declareFactoryPlugin(PluginKind.Reporter, 'catalog', () => ({
    onDryRunCompleted({result}) { writeFileSync('catalog.json', JSON.stringify(result.tests.map(test => ({
        id:test.id, name:test.name, status:test.status === TestStatus.Success ? 'success' : test.status === TestStatus.Skipped ? 'skipped' : 'failed'
    })))); }
}))];
`
        );
        plugins.push(pathToFileURL(`${process.cwd()}/catalog-reporter.mjs`).href);
    }
    const clock = createClock();
    const start = clock.currentMonotonicMicroseconds;
    const output = await new Promise<string>(function executeCampaign(resolve, reject) {
        execFile(
            process.execPath,
            [ '--disable-warning=PERM0004',
                '--input-type=module',
                '--eval',
                campaignScript,
                JSON.stringify([ modules, mode, seed, coverage, catalog, files, plugins, targets ])
            ],
            { cwd: process.cwd(), timeout: 110_000, maxBuffer: 1_048_576 },
            function complete(error, stdout, stderr) {
                if (error !== null) {
                    reject(new Error(`${stdout}\n${stderr}`, { cause: error }));
                } else {
                    resolve(stdout);
                }
            }
        );
    });
    const durationMicroseconds = Number(clock.currentMonotonicMicroseconds - start);
    const events = reload === 'unchanged' ? [] : (await readFile('reload-trace', 'utf8')).trim().split('\n');
    return {
        ...campaignResultSchema.parse(JSON.parse(output)), durationMicroseconds,
        workers: new Set(events.filter(event => event.startsWith('worker '))).size,
        configResolutions: new Set(events.filter(event => event.startsWith('config '))).size,
        reloadRequests: events.filter(event => event === 'reload').length
    };
}

export async function accuracyCampaign(
    modules: MutationModuleUrls,
    mode: MutationMode,
    seed: string,
    coverage: MutationCoverageMode
): Promise<CampaignEvidence> {
    return await withMutationProject(async function campaign(cwd) {
        await writeAccuracyProject(modules, mode);
        const result = await runMutationCampaign({ modules, mode, seed, coverage, catalog: true, targets: [ '*.mjs' ], reload: 'unchanged' });
        const tests: unknown = JSON.parse(await readFile('catalog.json', 'utf8'));
        const evidence = campaignEvidenceSchema.parse({
            coverage,
            durationMicroseconds: result.durationMicroseconds,
            tests,
            mutants: result.results.map((mutant) => ({
                file: relative(cwd, mutant.fileName).replaceAll('\\', '/'),
                location: mutant.location,
                mutator: mutant.mutatorName,
                replacement: mutant.replacement,
                status: mutant.status,
                killers: mutant.killedBy,
                testsCompleted: mutant.testsCompleted
            }))
        });
        assert.equal((await readdir('.')).includes('.overkill'), false);
        compareMutationCampaigns([ evidence ]);
        return evidence;
    });
}
