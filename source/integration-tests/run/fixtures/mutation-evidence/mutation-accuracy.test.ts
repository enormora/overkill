import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod/v4';
import { createClock } from '@enormora/clock';
import { execFile } from 'node:child_process';
import {
    expectedMutationManifest, withMutationProject, writeAccuracyProject,
    type MutationMode, type MutationModuleUrls
} from './mutation-project.test.ts';

export const mutationCoverageModes = [ 'perTest', 'all', 'off' ] as const;
export type MutationCoverageMode = typeof mutationCoverageModes[number];
const positionSchema = z.strictObject({ line: z.number().int().positive(), column: z.number().int().nonnegative() });
export const campaignEvidenceSchema = z.strictObject({
    coverage: z.enum(mutationCoverageModes), durationMicroseconds: z.number().int().nonnegative(),
    tests: z.array(z.strictObject({ id: z.string(), name: z.string(), status: z.enum([ 'success', 'skipped' ]) })),
    mutants: z.array(z.strictObject({
        file: z.string(), location: z.strictObject({ start: positionSchema, end: positionSchema }),
        mutator: z.string(), replacement: z.string(),
        status: z.enum([ 'Killed', 'Survived', 'NoCoverage' ]), killers: z.array(z.string()),
        testsCompleted: z.number().int().nonnegative()
    }))
});
export type CampaignEvidence = z.infer<typeof campaignEvidenceSchema>;
const campaignResultSchema = z.strictObject({
    results: z.array(z.object({
        fileName: z.string(), location: z.strictObject({ start: positionSchema, end: positionSchema }),
        mutatorName: z.string(), replacement: z.string(), status: z.string(),
        statusReason: z.string().nullable().default(null),
        killedBy: z.array(z.string()).default([]), testsCompleted: z.number().int().nonnegative().default(0)
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
};

export async function runMutationCampaign(
    request: CampaignRequest
): Promise<{ readonly results: z.infer<typeof campaignResultSchema>['results']; readonly durationMicroseconds: number; }> {
    const { modules, mode, seed, coverage, catalog, targets } = request;
    const files = (await readdir('.')).filter(file => file.endsWith('.mjs') || file === 'package.json');
    const plugins = [ modules.adapter ];
    if (catalog) {
        await writeFile('catalog-reporter.mjs', `
import { writeFileSync } from 'node:fs';
import { TestStatus } from ${JSON.stringify(modules.testRunner)};
import { declareFactoryPlugin, PluginKind } from ${JSON.stringify(modules.plugin)};
export const strykerPlugins = [declareFactoryPlugin(PluginKind.Reporter, 'catalog', () => ({
    onDryRunCompleted({result}) { writeFileSync('catalog.json', JSON.stringify(result.tests.map(test => ({
        id:test.id, name:test.name, status:test.status === TestStatus.Success ? 'success' : test.status === TestStatus.Skipped ? 'skipped' : 'failed'
    })))); }
}))];
`);
        plugins.push(pathToFileURL(`${process.cwd()}/catalog-reporter.mjs`).href);
    }
    const clock = createClock();
    const start = clock.currentMonotonicMicroseconds;
    const output = await new Promise<string>(function executeCampaign(resolve, reject) {
        execFile(process.execPath, [ '--input-type=module', '--eval', campaignScript,
            JSON.stringify([ modules, mode, seed, coverage, catalog, files, plugins, targets ]) ],
        { cwd: process.cwd(), timeout: 110_000, maxBuffer: 1_048_576 }, function complete(error, stdout, stderr) {
            if (error !== null) {
                reject(new Error(`${stdout}\n${stderr}`, { cause: error }));
            } else {
                resolve(stdout);
            }
        });
    });
    return { ...campaignResultSchema.parse(JSON.parse(output)),
        durationMicroseconds: Number(clock.currentMonotonicMicroseconds - start) };
}

export async function accuracyCampaign(
    modules: MutationModuleUrls, mode: MutationMode, seed: string, coverage: MutationCoverageMode
): Promise<CampaignEvidence> {
    return await withMutationProject(async function campaign(cwd) {
        await writeAccuracyProject(modules, mode);
        const result = await runMutationCampaign({ modules, mode, seed, coverage, catalog: true, targets: [ '*.mjs' ] });
        const tests: unknown = JSON.parse(await readFile('catalog.json', 'utf8'));
        const evidence = campaignEvidenceSchema.parse({
            coverage, durationMicroseconds: result.durationMicroseconds, tests,
            mutants: result.results.map(mutant => ({
                file: relative(cwd, mutant.fileName).replaceAll('\\', '/'), location: mutant.location,
                mutator: mutant.mutatorName, replacement: mutant.replacement, status: mutant.status,
                killers: mutant.killedBy, testsCompleted: mutant.testsCompleted
            }))
        });
        assert.equal((await readdir('.')).includes('.overkill'), false);
        validateCampaign(evidence);
        return evidence;
    });
}

function mutantKey(mutant: CampaignEvidence['mutants'][number]): string {
    return JSON.stringify([ mutant.file, mutant.location, mutant.mutator, mutant.replacement ]);
}

export function validateCampaign(evidence: CampaignEvidence): void {
    const tests = new Map(evidence.tests.map(test => [ test.id, test ]));
    assert.equal(tests.size, evidence.tests.length, 'Duplicate test identity');
    assert.equal(evidence.tests.length, 10, 'Incomplete dry-run catalog');
    assert.equal(evidence.tests.filter(test => test.status === 'skipped').length, 1);
    assert.equal(evidence.mutants.length, expectedMutationManifest.length, 'Mutant inventory changed');
    assert.equal(new Set(evidence.mutants.map(mutantKey)).size, evidence.mutants.length, 'Duplicate mutant');
    for (const expected of expectedMutationManifest) {
        const matches = evidence.mutants.filter(mutant => mutant.file === expected.file && mutant.location.start.line === expected.line);
        assert.equal(matches.length, 1, `Missing or repeated mutant: ${expected.file}:${expected.line}`);
        const [ mutant ] = matches;
        assert.ok(mutant);
        assert.equal(mutant.mutator, 'BooleanLiteral');
        assert.equal(mutant.replacement, 'false');
        const status = expected.status === 'NoCoverage' && evidence.coverage === 'off' ? 'Survived' : expected.status;
        assert.equal(mutant.status, status, mutantKey(mutant));
        const executed = evidence.coverage === 'perTest' ? expected.optimizedCases
            : status === 'NoCoverage' ? 0 : evidence.tests.filter(test => test.status === 'success').length;
        assert.equal(mutant.testsCompleted, executed, `Incorrect selection: ${mutantKey(mutant)}`);
        for (const killer of mutant.killers) {
            assert.ok(tests.has(killer), `Killer outside dry-run catalog: ${killer}`);
        }
        const expectedKillers = expected.killers.map(title => {
            const matching = evidence.tests.filter(test => test.name.split(' > ').includes(title));
            assert.equal(matching.length, 1, `Ambiguous expected killer: ${title}`);
            const [ test ] = matching;
            assert.ok(test);
            return test.id;
        });
        assert.deepEqual(mutant.killers.toSorted(), expectedKillers.toSorted(), mutantKey(mutant));
    }
}

export function compareMutationCampaigns(evidence: readonly CampaignEvidence[]): void {
    const [ baseline ] = evidence;
    assert.ok(baseline, 'Campaign evidence is empty');
    for (const campaign of evidence) {
        validateCampaign(campaign);
        assert.deepEqual(campaign.tests.toSorted((left, right) => left.id.localeCompare(right.id)),
            baseline.tests.toSorted((left, right) => left.id.localeCompare(right.id)));
        assert.deepEqual(campaign.mutants.map(mutantKey).toSorted(), baseline.mutants.map(mutantKey).toSorted());
    }
}
