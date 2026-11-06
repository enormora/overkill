import { runIfMain } from '#test-runner';
import type { RunResult, PropertyInvocationSummary } from '../../packages/engine/engine.entry-point.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { orchestrator, type RunCommand } from '../../packages/run/run.entry-point.ts';
import {
    replayProject,
    writeReplayCase,
    replayAuthoringUrl,
    replayPropertyUrl
} from '../../test-support/replay-project-fixture.ts';

async function streamCommand(scope: TestScope, processModel: 'in-process' | 'supervised-process'): Promise<RunCommand> {
    const project = await replayProject(scope, {
        testFamily: 'property',
        files: { include: [ 'case.test.ts' ] },
        execution: { processModel, scheduling: 'serial' },
        property: { newTrials: 8, maxAutomaticEdges: 0, maxExhaustiveValues: 0 },
        timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
    });
    await writeReplayCase(
        project,
        `
import {test} from ${JSON.stringify(replayAuthoringUrl)};
import {withProperties, gen} from ${JSON.stringify(replayPropertyUrl)};
export const testNode = test('stream', withProperties(async parent => {
    const values = [];
    await parent.forall({key: 'stream', generator: gen.integer({min: 0, max: 10000}),
        test(value, sample) { values.push(value); sample.assert.true(true); return sample.assert.collect(); }});
    parent.assert.deepEqual(values, []);
    return parent.assert.collect();
}));`
    );
    return { ...project.command, request: { ...project.command.request, record: false } };
}
async function concurrentStream(
    command: RunCommand,
    processModel: 'in-process' | 'supervised-process'
): ReturnType<typeof orchestrator.run> {
    const profile = command.config.profiles.cases;
    if (profile?.testFamily !== 'property') {
        throw new TypeError('Expected property profile.');
    }
    return await orchestrator.run({
        ...command,
        config: {
            ...command.config,
            profiles: {
                cases: { ...profile, execution: { processModel, scheduling: 'concurrent', maxConcurrency: 2 } }
            }
        }
    });
}
function summaryFor(result: RunResult): PropertyInvocationSummary {
    const summary = result.perTest[0]?.property?.invocations[0]?.summary;
    if (summary === null || summary === undefined) {
        throw new Error('Missing property summary.');
    }
    return summary;
}
export const testNode = suite(
    'property integration validation',
    ([ 'in-process', 'supervised-process' ] as const).map(function executionMode(processModel) {
        return test(`${processModel} preserves exploration streams across scheduling`, async function (scope) {
            const command = await streamCommand(scope, processModel);
            const first = await orchestrator.run(command);
            const second = await concurrentStream(command, processModel);
            scope.assert.deepEqual([ first.runnerErrors, second.runnerErrors ], [ [], [] ]);
            scope.assert.deepEqual([ first.summary.failed, second.summary.failed ], [ 1, 1 ]);
            scope.assert.equal(JSON.stringify(first.perTest[0]?.outcome), JSON.stringify(second.perTest[0]?.outcome));
            const summary = summaryFor(first);
            scope.assert.equal(summary.accounting.phases.exploration.executed, 8);
            scope.assert.equal(summary.accounting.phases.confirmation.executed, 0);
            return scope.assert.collect();
        });
    })
);
await runIfMain(import.meta, testNode);
