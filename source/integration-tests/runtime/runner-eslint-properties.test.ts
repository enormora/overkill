import type { ParameterizedTestScope } from '@overkill-dev/test';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { table, type TestScope, suite, test } from '@overkill-dev/test';

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

async function projectPropertyCommand(cleanup: TestScope['cleanup'], processModel: ProcessModel): Promise<RunCommand> {
    const project = await replayProject(cleanup, {
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

const assertConfigWitness = defineCompositeAssertion({
    name: 'config witness',
    async assert(check, saved: SavedConfigFailure) {
        const confirmed = saved.result.perTest[0]?.property?.invocations[0]?.confirmedWitness;
        if (confirmed === undefined || confirmed === null) {
            return check.defined(confirmed);
        }
        if (confirmed === null) {
            return check.notNull(confirmed);
        }
        return check.group([
            check.deepEqual(parseWitnessFile(JSON.parse(await readFile(saved.file, 'utf8'))), confirmed)
        ]);
    }
});

const replayConfigWitness = defineCompositeAssertion({
    name: 'replay config witness',
    async assert(check, project: ReplayProject, file: string) {
        const replay = await orchestrator.replayWitness({
            debug: { mode: 'off', selectors: [] },
            cwd: project.cwd,
            config: project.command.config,
            signal: null,
            path: file,
            profile: 'cases'
        });
        const initialChecks = check.group([
            check.equal(replay.summary.failed, 1),
            check.deepEqual(replay.runnerErrors, []),
            check.false(JSON.stringify(replay).includes('generated during replay'))
        ]);
        const cli = await executeReplayCli(project, [ 'replay-witness', file ]);
        return check.group([
            initialChecks,
            check.equal(cli.code, 1),
            check.includes(cli.output, 'rule crashed'),
            check.false(cli.output.includes('generated during replay'))
        ]);
    }
});

export const testNode = suite('project-backed ESLint properties', [
    table({
        title: 'retains and replays generated config failures',
        cases: [ 'supervised-process', 'worker-pool' ] as const,
        caseTitle(processModel) {
            return processModel;
        },
        async test(scope: ParameterizedTestScope<'supervised-process' | 'worker-pool'>) {
            const processModel = scope.parameters;
            const replayConfigFailureCommand = await projectPropertyCommand(scope.cleanup, processModel);
            const replayConfigFailureProject = {
                cwd: replayConfigFailureCommand.cwd,
                command: replayConfigFailureCommand
            };
            const replayConfigFailureFailingCase = generatedCase.replace(
                "return [{rules: {'no-debugger': 'error'}}];",
                `return [{
        plugins: {broken: {rules: {crash: {meta: {schema: []}, create() {
            return {Program() {throw new Error('rule crashed');}};
        }}}}}, rules: {'broken/crash': 'error'}
    }];`
            );
            await writeReplayCase(replayConfigFailureProject, replayConfigFailureFailingCase);

            const retainedConfigFailureResult = await orchestrator.run(replayConfigFailureProject.command);
            scope.assert.equal(retainedConfigFailureResult.summary.failed, 1);
            scope.assert.deepEqual(retainedConfigFailureResult.runnerErrors, []);
            const retainedConfigFailureWitness = retainedConfigFailureResult.artifacts.find(
                function retainedWitness(artifact) {
                    return artifact.id.subtype === 'witness';
                }
            );
            scope.require.defined(retainedConfigFailureWitness);
            if (
                retainedConfigFailureWitness.payload.kind !== 'runtime-attachment' ||
                retainedConfigFailureWitness.payload.content.kind !== 'file'
            ) {
                throw new TypeError('Expected a retained property witness file.');
            }
            const replayConfigFailureSaved = {
                file: path.resolve(replayConfigFailureProject.cwd, retainedConfigFailureWitness.payload.content.path),
                result: retainedConfigFailureResult
            };

            await scope.assert(assertConfigWitness, replayConfigFailureSaved);
            await writeReplayCase(
                replayConfigFailureProject,
                replayConfigFailureFailingCase.replace(
                    generatedInput,
                    "gen.constant(null).map(() => {throw new Error('generated during replay');})"
                )
            );
            await scope.assert(replayConfigWitness, replayConfigFailureProject, replayConfigFailureSaved.file);

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

            const command = await projectPropertyCommand(scope.cleanup, processModel);
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
        const command = await projectPropertyCommand(scope.cleanup, 'supervised-process');
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
