import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { execFile } from 'node:child_process';
import {
    DryRunStatus,
    MutantRunStatus,
    type MutantRunOptions,
    type CompleteDryRunResult
} from '@stryker-mutator/api/test-runner';
import type { TestScope } from '../../packages/engine/engine.entry-point.ts';
import { createOverkillTestRunner } from '../../packages/stryker-runner/overkill-test-runner.ts';

export const originalRoot = process.cwd();
const extension = extname(import.meta.url);
const engineModule = new URL(`../../packages/engine/engine.entry-point${extension}`, import.meta.url);
const configModule = new URL(`../../packages/run/config.entry-point${extension}`, import.meta.url);
const adapterModule = new URL(`../../packages/stryker-runner/stryker-runner.entry-point${extension}`, import.meta.url);
export const engineUrl = engineModule.href;
export const configUrl = configModule.href;
export const adapterUrl = adapterModule.href;
type ProcessModel = 'in-process' | 'supervised-process';
type MutationFixture = {
    readonly cwd: string;
    readonly mutantId: string;
    readonly runner: ReturnType<typeof createOverkillTestRunner>;
    readonly reloadEnvironment: boolean;
};

function quietLog(): void {
    return undefined;
}

export async function executeMutationScript(
    script: string,
    scriptArguments: readonly string[],
    cwd: string
): Promise<string> {
    return await new Promise<string>(function receiveScriptOutput(resolve, reject) {
        execFile(
            process.execPath,
            [ '--input-type=module', '--eval', script, ...scriptArguments ],
            { cwd, timeout: 120_000 },
            function completeScript(error, stdout, stderr) {
                if (error === null) {
                    resolve(stdout);
                } else {
                    reject(new Error([ stdout, stderr ].join('\n'), { cause: error }));
                }
            }
        );
    });
}

async function writeMutationModules(cwd: string): Promise<string> {
    const output = await executeMutationScript(
        `
import { Instrumenter } from ${JSON.stringify(import.meta.resolve('@stryker-mutator/instrumenter'))};
import { writeFile } from 'node:fs/promises';
const logger = { info() {}, debug() {}, isDebugEnabled: () => false };
const result = await new Instrumenter(logger).instrument([
    { name: ${JSON.stringify(join(cwd, 'subject.mjs'))},
      content: 'export function value() { return true; }', mutate: true }
], { excludedMutations: ['BlockStatement'], ignorers: [], plugins: null });
await writeFile(result.files[0].name, result.files[0].content);
const mutant = result.mutants.find(mutant => mutant.mutatorName === 'BooleanLiteral');
if (mutant === undefined) throw new Error('Missing boolean mutant.');
console.log(mutant.id);
`,
        [],
        cwd
    );
    await writeFile(
        join(cwd, 'case.test.mjs'),
        `
import { createSuite, createTestCase } from ${JSON.stringify(engineUrl)};
import { value } from './subject.mjs';
const metadata = { annotations: {}, controls: {}, definitionLocations: [{kind:'unknown'}] };
export const testNode = createSuite({ ...metadata, title: 'structural > suite / ../../../../segment',
    children: ['first', 'second'].map(title => createTestCase({ ...metadata,
        title: title + 'x'.repeat(32768), body(scope) {
        scope.cleanup(async () => { await Promise.resolve(); value(); });
        scope.assert.equal(value(), true); return scope.assert.collect();
    } })) });`
    );
    return output.trim();
}

async function mutationProject(
    scope: TestScope,
    processModel: ProcessModel
): Promise<Pick<MutationFixture, 'cwd' | 'mutantId'>> {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'overkill-stryker-lifecycle-')));
    scope.cleanup(async function removeMutationProject() {
        process.chdir(originalRoot);
        await rm(cwd, { recursive: true, force: true });
    });
    await writeFile(join(cwd, 'package.json'), '{"type":"module"}');
    await writeFile(
        join(cwd, 'overkill.config.mjs'),
        `
import { defineConfig } from ${JSON.stringify(configUrl)};
export const config = defineConfig({ profiles: { microtest: {
    testFamily: 'microtest', files: { include: ['case.test.mjs'] },
    execution: { processModel: ${JSON.stringify(processModel)}, scheduling: 'concurrent' },
    timeouts: { collectionMilliseconds: 30000 }
} } });`
    );
    const mutantId = await writeMutationModules(cwd);
    return { cwd, mutantId };
}

async function createMutationFixture(
    scope: TestScope,
    processModel: ProcessModel,
    freshState: boolean
): Promise<MutationFixture> {
    const { cwd, mutantId } = await mutationProject(scope, processModel);
    process.chdir(cwd);
    const runner = createOverkillTestRunner(
        { overkill: { configPath: 'overkill.config.mjs', seed: '42', freshState } },
        {
            [join(originalRoot, 'case.test.mjs')]: { mutate: false },
            [join(originalRoot, 'overkill.config.mjs')]: { mutate: false },
            [join(originalRoot, 'subject.mjs')]: { mutate: true }
        },
        { info: quietLog }
    );
    scope.cleanup(async function disposeRunner() {
        await runner.dispose();
    });
    return { cwd, mutantId, runner, reloadEnvironment: freshState || processModel === 'supervised-process' };
}

async function assertCapabilities(fixture: MutationFixture): Promise<void> {
    assert.deepEqual(await fixture.runner.capabilities(), { reloadEnvironment: fixture.reloadEnvironment });
    await fixture.runner.init();
    assert.deepEqual(await fixture.runner.capabilities(), { reloadEnvironment: fixture.reloadEnvironment });
}

async function assertDryRun(fixture: MutationFixture): Promise<CompleteDryRunResult> {
    const dry = await fixture.runner.dryRun({ coverageAnalysis: 'perTest', disableBail: false, timeout: 30_000 });
    assert.equal(dry.status, DryRunStatus.Complete, JSON.stringify(dry));
    const identities = new Set(dry.tests.map(function testIdentity(test) {
        return test.id;
    }));
    assert.equal(dry.tests.length, 2);
    assert.equal(identities.size, 2);
    const counters = Object.values(dry.mutantCoverage?.perTest ?? {});
    assert.deepEqual(
        counters.map(function hitCount(counts) {
            return counts[fixture.mutantId];
        }),
        [ 2, 2 ]
    );
    return dry;
}

function mutantOptions(fixture: MutationFixture): Readonly<MutantRunOptions> {
    return {
        activeMutant: {
            id: fixture.mutantId,
            fileName: 'subject.mjs',
            location: { start: { line: 0, column: 0 }, end: { line: 0, column: 10 } },
            mutatorName: 'BooleanLiteral',
            replacement: 'false'
        },
        mutantActivation: 'runtime',
        reloadEnvironment: false,
        sandboxFileName: join(fixture.cwd, 'subject.mjs'),
        timeout: 30_000,
        disableBail: true
    };
}

async function assertKills(
    fixture: MutationFixture,
    options: Readonly<MutantRunOptions>,
    dry: Readonly<CompleteDryRunResult>
): Promise<void> {
    const killed = await fixture.runner.mutantRun(options);
    assert.equal(killed.status, MutantRunStatus.Killed, JSON.stringify(killed));
    assert.equal(killed.nrOfTests, 2);
    const selected = await fixture.runner.mutantRun({
        ...options,
        disableBail: false,
        testFilter: [ dry.tests[0]?.id ?? '' ]
    });
    assert.equal(selected.status, MutantRunStatus.Killed, JSON.stringify(selected));
    assert.equal(selected.nrOfTests, 1);
}

async function assertReloads(fixture: MutationFixture, options: Readonly<MutantRunOptions>): Promise<void> {
    for (const mutantActivation of [ 'runtime', 'static' ] as const) {
        const reloaded = await fixture.runner.mutantRun({ ...options, mutantActivation, reloadEnvironment: true });
        assert.equal(
            reloaded.status,
            fixture.reloadEnvironment ? MutantRunStatus.Killed : MutantRunStatus.Error,
            JSON.stringify(reloaded)
        );
    }
    const afterStatic = await fixture.runner.mutantRun(options);
    assert.equal(afterStatic.status, MutantRunStatus.Killed, JSON.stringify(afterStatic));
}

async function assertRejectedSelection(fixture: MutationFixture, options: Readonly<MutantRunOptions>): Promise<void> {
    const unknown = await fixture.runner.mutantRun({ ...options, testFilter: [ 'unknown' ] });
    assert.equal(unknown.status, MutantRunStatus.Error, JSON.stringify(unknown));
}

async function assertCatalogDrift(
    fixture: MutationFixture,
    options: Readonly<MutantRunOptions>,
    dry: Readonly<CompleteDryRunResult>
): Promise<void> {
    if (!fixture.reloadEnvironment) {
        return;
    }
    const original = await readFile(join(fixture.cwd, 'case.test.mjs'), 'utf8');
    await writeFile(join(fixture.cwd, 'case.test.mjs'), original.replace("'first'", "'changed'"));
    const drifted = await fixture.runner.mutantRun({ ...options, testFilter: [ dry.tests[1]?.id ?? '' ] });
    assert.equal(drifted.status, MutantRunStatus.Error, JSON.stringify(drifted));
    await writeFile(join(fixture.cwd, 'case.test.mjs'), original);
}

async function assertMemoryOnly(fixture: MutationFixture, scope: TestScope): Promise<void> {
    const files = await readdir(fixture.cwd);
    scope.assert.equal(files.includes('.overkill'), false);
}

export async function verifyMutationLifecycle(
    scope: TestScope,
    processModel: ProcessModel,
    freshState: boolean
): Promise<void> {
    const fixture = await createMutationFixture(scope, processModel, freshState);
    await assertCapabilities(fixture);
    const dry = await assertDryRun(fixture);
    const options = mutantOptions(fixture);
    await assertKills(fixture, options, dry);
    await assertReloads(fixture, options);
    await assertRejectedSelection(fixture, options);
    await assertCatalogDrift(fixture, options, dry);
    await assertMemoryOnly(fixture, scope);
}
