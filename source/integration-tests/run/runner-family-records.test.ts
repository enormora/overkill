import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { defineTestFamily } from '../../packages/engine/engine.entry-point.ts';
import type { ReplayRunRecord } from '../../run/replay-record-types.ts';
import { orchestrator } from '../../packages/run/run.entry-point.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import {
    replayProject,
    writeReplayCase,
    replayPassingCase,
    replayRecords,
    type ReplayProject
} from '../../test-support/replay-project-fixture.ts';
import { family } from './fixtures/imported-runtime-family.ts';

type ProcessModel = 'in-process' | 'supervised-process' | 'worker-pool';
const configuredFamily = defineTestFamily({ ...family, module: null });
const commonPolicy = {
    settings: null,
    files: { include: [ 'case.test.ts' ] as const },
    timeouts: { collectionMilliseconds: 60_000, softMilliseconds: 60_000, hardMilliseconds: 60_000 }
};

async function configuredFamilyProject(scope: TestScope, processModel: ProcessModel): Promise<ReplayProject> {
    const policy = { ...commonPolicy, execution: { processModel, scheduling: 'serial' as const } };
    const project = await replayProject(scope, { ...policy, testFamily: configuredFamily });
    const familyUrl = import.meta.resolve('./fixtures/imported-runtime-family.ts');
    const engineUrl = import.meta.resolve('../../packages/engine/engine.entry-point.ts');
    const policySource = JSON.stringify(policy);
    await writeFile(
        path.join(project.cwd, 'overkill.config.ts'),
        `import {defineTestFamily} from ${JSON.stringify(engineUrl)};
import {family as definition} from ${JSON.stringify(familyUrl)};
const family=defineTestFamily({...definition,module:null});
export const config={profiles:{cases:{...${policySource},testFamily:family}}};`
    );
    await writeReplayCase(project, replayPassingCase('family case', true));
    return project;
}

function assertFamilyRecord(scope: TestScope, record: ReplayRunRecord): void {
    scope.assert.equal(record.version, 3);
    scope.assert.equal(record.facts.family?.id, family.id);
    scope.assert.equal(record.facts.family?.version, '1');
    scope.assert.equal(JSON.stringify(record.facts.family?.collection), '{"selected":2}');
    scope.assert.equal(record.replayPlan.family?.definition.source.kind, 'config-file');
}

async function assertFamilyReplay(scope: TestScope, project: ReplayProject): Promise<void> {
    const [ record ] = await replayRecords(project);
    scope.require.defined(record);
    assertFamilyRecord(scope, record);
    const replay = await orchestrator.replay({
        cwd: project.cwd,
        config: project.command.config,
        runId: record.id,
        debug: { mode: 'off', selectors: [] },
        signal: null
    });
    scope.assert.equal(replay.status, 'passed');
    scope.assert.equal(replay.summary.passed, 2);
    scope.assert.deepEqual(replay.runnerErrors, []);
}

export const testNode = suite(
    'imported family records',
    ([ 'in-process', 'supervised-process', 'worker-pool' ] as const).map(function placement(processModel) {
        return test(
            `records and reproduces config-only family variants through ${processModel}`,
            async function (scope: TestScope) {
                const project = await configuredFamilyProject(scope, processModel);
                const configPath = path.join(project.cwd, 'overkill.config.ts');
                const original = await orchestrator.run({
                    kind: 'configured',
                    command: project.command,
                    source: { kind: 'config-file', request: { cwd: project.cwd, configPath }, resolvedPath: configPath }
                });
                scope.assert.deepEqual(original.runnerErrors, []);
                scope.assert.equal(original.status, 'passed');
                if (original.status === 'passed') {
                    await assertFamilyReplay(scope, project);
                }
                return scope.assert.collect();
            }
        );
    })
);

await runIfMain(import.meta, testNode);
