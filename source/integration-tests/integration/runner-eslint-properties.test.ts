import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { table, type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import { parseWitnessFile, type RunResult } from '../../packages/engine/engine.entry-point.ts';
import { orchestrator, type RunCommand } from '../../packages/run/run.entry-point.ts';
import {
    replayProject,
    writeReplayCase,
    replayPropertyUrl,
    executeReplayCli,
    type ReplayProject
} from '../../test-support/replay-project-fixture.ts';

type ProcessModel = 'supervised-process' | 'worker-pool';
const adapterEntryPoint = new URL('../../packages/eslint-test/eslint-test.entry-point.ts', import.meta.url);
const adapterUrl = adapterEntryPoint.href;
const generatedInput = "gen.constant(null).map(() => ({filename: 'file.js', code: 'debugger;', files: {}}))";
const generatedCase = `
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {defineConfigTests} from ${JSON.stringify(adapterUrl)};
import {gen} from ${JSON.stringify(replayPropertyUrl)};
const project = {kind: 'virtual', files: {}, dependencies: {kind: 'none'}};
export const testNode = defineConfigTests({
 name: 'project laws', project, inventories: [], files: [], fixtures: [],
 configs: {base: async ({root}) => {
  assert.equal(await readFile(path.join(root, 'file.js'), 'utf8'), 'debugger;');
  return [{rules: {'no-debugger': 'error'}}];
 }},
 generation: [{title: 'generated project', configs: 'all', project,
  generator: {kind: 'custom', input: ${generatedInput}},
  contracts: [{kind: 'crash-freedom'}]
 }]
}).properties();
`;

async function projectPropertyCommand(scope: TestScope, processModel: ProcessModel): Promise<RunCommand> {
    const project = await replayProject(scope, {
        testFamily: 'integration',
        files: { include: [ 'case.test.ts' ] },
        execution: processModel === 'worker-pool'
            ? { processModel, scheduling: 'serial', maxWorkers: 1 }
            : { processModel, scheduling: 'serial' },
        property: { newTrials: 2, maxAutomaticEdges: 0, maxExhaustiveValues: 0, maxWork: 100_000 },
        timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 10_000, hardMilliseconds: 15_000 }
    });
    await writeReplayCase(project, generatedCase);
    return { ...project.command, request: { ...project.command.request, record: false } };
}

type SavedConfigFailure = { readonly file: string; readonly result: RunResult; };

async function retainedConfigFailure(scope: TestScope, project: ReplayProject): Promise<SavedConfigFailure> {
    const result = await orchestrator.run(project.command);
    scope.assert.equal(result.summary.failed, 1);
    scope.assert.deepEqual(result.runnerErrors, []);
    const witness = result.artifacts.find(function retainedWitness(artifact) {
        return artifact.id.subtype === 'witness';
    });
    scope.require.defined(witness);
    if (witness.payload.kind !== 'runtime-attachment' || witness.payload.content.kind !== 'file') {
        throw new TypeError('Expected a retained property witness file.');
    }
    return { file: path.resolve(project.cwd, witness.payload.content.path), result };
}

async function assertConfigWitness(scope: TestScope, saved: SavedConfigFailure): Promise<void> {
    const confirmed = saved.result.perTest[0]?.property?.invocations[0]?.confirmedWitness;
    scope.require.defined(confirmed);
    scope.require.notNull(confirmed);
    scope.assert.deepEqual(parseWitnessFile(JSON.parse(await readFile(saved.file, 'utf8'))), confirmed);
}

async function replayConfigWitness(scope: TestScope, project: ReplayProject, file: string): Promise<void> {
    const replay = await orchestrator.replayWitness({
        debug: { mode: 'off', selectors: [] },
        cwd: project.cwd,
        config: project.command.config,
        signal: null,
        path: file,
        profile: 'cases'
    });
    scope.assert.equal(replay.summary.failed, 1);
    scope.assert.deepEqual(replay.runnerErrors, []);
    scope.assert.false(JSON.stringify(replay).includes('generated during replay'));
    const cli = await executeReplayCli(project, [ 'replay-witness', file ]);
    scope.assert.equal(cli.code, 1);
    scope.assert.includes(cli.output, 'rule crashed');
    scope.assert.false(cli.output.includes('generated during replay'));
}

async function replayConfigFailure(scope: TestScope, processModel: ProcessModel): Promise<void> {
    const command = await projectPropertyCommand(scope, processModel);
    const project = { cwd: command.cwd, command };
    const failingCase = generatedCase.replace(
        "return [{rules: {'no-debugger': 'error'}}];",
        `return [{
        plugins: {broken: {rules: {crash: {meta: {schema: []}, create() {
            return {Program() {throw new Error('rule crashed');}};
        }}}}}, rules: {'broken/crash': 'error'}
    }];`
    );
    await writeReplayCase(project, failingCase);
    const saved = await retainedConfigFailure(scope, project);
    await assertConfigWitness(scope, saved);
    await writeReplayCase(
        project,
        failingCase.replace(
            generatedInput,
            "gen.constant(null).map(() => {throw new Error('generated during replay');})"
        )
    );
    await replayConfigWitness(scope, project, saved.file);
}

export const testNode: TestNode = suite('project-backed ESLint properties', [
    table({
        title: 'retains and replays generated config failures',
        cases: [ 'supervised-process', 'worker-pool' ] as const,
        caseTitle(processModel) {
            return processModel;
        },
        async test(scope) {
            const processModel = scope.parameters;

            await replayConfigFailure(scope, processModel);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'runs generated projects with profile budgets',
        cases: [ 'supervised-process', 'worker-pool' ] as const,
        caseTitle(processModel) {
            return processModel;
        },
        async test(scope) {
            const processModel = scope.parameters;

            const command = await projectPropertyCommand(scope, processModel);
            const resolved = await orchestrator.resolve(command);
            const result = await orchestrator.run(command);
            scope.assert.equal(resolved.facts.cases[0]?.propertyPolicy?.newTrials, 2);
            scope.assert.equal(result.summary.passed, 1);
            scope.assert.equal(result.summary.failed, 0);
            scope.assert.equal(result.summary.runtimePolicy, 0);
            scope.assert.deepEqual(result.runnerErrors, []);
            return scope.assert.collect();
        }
    }),
    test('requires explicit integration property budgets before execution', async function (scope) {
        const command = await projectPropertyCommand(scope, 'supervised-process');
        const profile = command.config.profiles.cases;
        if (profile?.testFamily !== 'integration') {
            throw new TypeError('Expected an integration profile.');
        }
        await scope.assert.rejects(async function missingBudgets() {
            await orchestrator.resolve({
                ...command,
                config: { ...command.config, profiles: { cases: { ...profile, property: null } } }
            });
        }, { message: /Property collection requires profile policy/ });
        return scope.assert.collect();
    })
]);
