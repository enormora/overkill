import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder } from '@overkill-dev/test/assert';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { table, type TestScope, suite } from '@overkill-dev/test';

import { defineTestFamily } from '../../packages/engine/engine.entry-point.ts';
import type { ReplayRunRecord } from '../../run/replay-record-types.ts';
import { orchestrator } from '../../packages/run/run.entry-point.ts';
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

async function configuredFamilyProject(
    cleanup: TestScope['cleanup'],
    processModel: ProcessModel
): Promise<ReplayProject> {
    const policy = { ...commonPolicy, execution: { processModel, scheduling: 'serial' as const } };
    const project = await replayProject(cleanup, { ...policy, testFamily: configuredFamily });
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

const familyRecordChecks = (
    check: CompositeCheckBuilder<'assert'>,
    record: ReplayRunRecord
): CompositeAssertionReturn<'assert'> => {
    return check.group([
        check.equal(record.version, 1),
        check.equal(record.facts.implementations, null),
        check.equal(record.replayPlan.implementations, null),
        check.equal(record.facts.family?.id, family.id),
        check.equal(record.facts.family?.version, '1'),
        check.equal(JSON.stringify(record.facts.family?.collection), '{"selected":2}'),
        check.equal(record.replayPlan.family?.definition.source.kind, 'config-file')
    ]);
};

const assertFamilyReplay = defineCompositeAssertion({
    name: 'family replay',
    async assert(check, project: ReplayProject) {
        const [ record ] = await replayRecords(project);
        if (record === undefined || record === null) {
            return check.defined(record);
        }
        const initialChecks = check.group([
            check.defined(record),
            familyRecordChecks(check.annotated('family record'), record)
        ]);
        const replay = await orchestrator.replay({
            cwd: project.cwd,
            config: project.command.config,
            runId: record.id,
            debug: { mode: 'off', selectors: [] },
            signal: null
        });
        return check.group([
            initialChecks,
            check.equal(replay.status, 'passed'),
            check.equal(replay.summary.passed, 2),
            check.deepEqual(replay.runnerErrors, [])
        ]);
    }
});

export const testNode = suite(
    'imported family records',
    [ table({
        title: 'records and reproduces config-only family variants',
        cases: [ 'in-process', 'supervised-process', 'worker-pool' ] as const,
        caseTitle(processModel) {
            return `records and reproduces config-only family variants through ${processModel}`;
        },
        async test(scope) {
            const processModel = scope.parameters;

            const project = await configuredFamilyProject(scope.cleanup, processModel);
            const configPath = path.join(project.cwd, 'overkill.config.ts');
            const original = await orchestrator.run({
                kind: 'configured',
                command: project.command,
                source: { kind: 'config-file', request: { cwd: project.cwd, configPath }, resolvedPath: configPath }
            });
            scope.assert.deepEqual(original.runnerErrors, []);
            scope.assert.equal(original.status, 'passed');
            if (original.status === 'passed') {
                await scope.assert(assertFamilyReplay, project);
            }
            return scope.assert.collect();
        }
    }) ]
);
