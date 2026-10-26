import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createClock } from '@enormora/clock';
import { z } from 'zod/v4';
import { defaultRunRequest } from '../../../../test-support/run-command-factory.ts';
import { runMutationCampaign } from './mutation-accuracy.test.ts';
import { mutationModeSchema, type MutationModuleUrls } from './mutation-project.test.ts';

const dimensions = {
    ...mutationModeSchema.shape, files: z.number().int().positive(), casesPerFile: z.number().int().positive()
};
export const mutationCostParametersSchema = z.discriminatedUnion('tier', [
    z.strictObject({ ...dimensions, tier: z.literal('campaign'), coverage: z.enum([ 'perTest', 'off' ]), mutants: z.literal(1) }),
    z.strictObject({ ...dimensions, tier: z.literal('execution-session'), coverage: z.literal('none') })
]);
export type MutationCostParameters = z.infer<typeof mutationCostParametersSchema>;
const duration = z.number().int().nonnegative();
export const sessionObservationSchema = z.strictObject({
    processId: z.number().int().positive(), graphIdentity: z.string().min(1),
    planReadyMicroseconds: duration, processEntryToLifecycleMicroseconds: duration,
    completedCases: z.number().int().positive(), invocationMicroseconds: duration, executionMicroseconds: duration
});
export const mutationCostEvidenceSchema = z.discriminatedUnion('tier', [
    z.strictObject({ tier: z.literal('campaign'), completedInvocations: z.number().int().positive(),
        campaignMicroseconds: duration }),
    z.strictObject({ tier: z.literal('execution-session'), completedInvocations: z.literal(2),
        observations: z.array(sessionObservationSchema).length(2), disposalMicroseconds: duration,
        environmentLifetime: z.enum([ 'fresh', 'reused' ]) })
]);
export type MutationCostEvidence = z.infer<typeof mutationCostEvidenceSchema>;

export async function writeCostLifecycle(modules: MutationModuleUrls, directory: string): Promise<void> {
    await writeFile(join(directory, 'cost-lifecycle.mjs'), `
import { createClock } from ${JSON.stringify(modules.clock)};
const graphs = new WeakMap();
let nextGraph = 0;
export async function createCostLifecycle() {
    const clock = createClock();
    const entered = clock.currentMonotonicMicroseconds;
    let planReadyMicroseconds = 0;
    let graphIdentity = null;
    let completedCases = 0;
    return {
        async select() {
            planReadyMicroseconds = Number(clock.currentMonotonicMicroseconds - entered);
            const graph = (await import('./case-0.test.mjs')).graphIdentity;
            if (!graphs.has(graph)) graphs.set(graph, ++nextGraph);
            graphIdentity = process.pid + ':' + graphs.get(graph);
            return {kind:'all'};
        },
        async beforeCases() {},
        async enterCase() {},
        async completeCase(result, errors) {
            if (result.verdict !== 'pass' || errors.length !== 0) throw new Error('Cost workload failed');
            completedCases++;
            return 'continue';
        },
        snapshot() { return {
            processId:process.pid, graphIdentity, completedCases, planReadyMicroseconds,
            processEntryToLifecycleMicroseconds:Number(entered)
        }; },
        async dispose() {}
    };
}
`);
}

async function measureExecutionSession(
    modules: MutationModuleUrls, parameters: MutationCostParameters
): Promise<MutationCostEvidence> {
    const runner: typeof import('../../../../packages/run/run.entry-point.ts') = await import(modules.runner);
    const config = await runner.loadConfig({ cwd: process.cwd(), configPath: 'overkill.config.mjs' });
    const command = {
        config, cwd: process.cwd(), engine: { kind: 'default' } as const,
        request: defaultRunRequest({ profile: 'microtest', execution: { mode: 'serial' }, seed: { value: 42n } })
    };
    const policy = await runner.orchestrator.freezePolicy({
        command, moduleBoundary: null,
        source: { kind: 'config-file', request: { cwd: process.cwd(), configPath: 'overkill.config.mjs' },
            resolvedPath: config.configPath }
    });
    const session = runner.orchestrator.createExecutionSession({
        command: { kind: 'frozen-policy', policy, invocation: { seed: { value: 42n }, selection: { kind: 'all' } },
            reporting: { reporters: [], outputRenderer: config.outputRenderer } },
        lifecycle: { moduleUrl: pathToFileURL(join(process.cwd(), 'cost-lifecycle.mjs')).href, exportName: 'createCostLifecycle' },
        environment: parameters.processModel === 'in-process' && parameters.freshState
            ? 'fresh-invocation' : 'profile-default'
    });
    const clock = createClock();
    const observations: z.infer<typeof sessionObservationSchema>[] = [];
    let disposalMicroseconds = 0;
    try {
        for (let invocation = 0; invocation < 2; invocation += 1) {
            const start = clock.currentMonotonicMicroseconds;
            const reply = await session.run({ data: null, timeoutMilliseconds: 30_000, signal: null });
            const invocationMicroseconds = Number(clock.currentMonotonicMicroseconds - start);
            assert.equal(reply.kind, 'result', JSON.stringify(reply));
            if (reply.kind !== 'result') throw new Error('Execution session did not return results');
            assert.equal(reply.deadlineExceeded, false);
            assert.equal(reply.result.status, 'passed', JSON.stringify(reply.result.runnerErrors));
            assert.equal(reply.result.summary.passed, parameters.files * parameters.casesPerFile);
            const data = sessionObservationSchema.parse({
                ...z.record(z.string(), z.unknown()).parse(reply.data), invocationMicroseconds,
                executionMicroseconds: reply.result.timings.summary.testExecutionWallTimeMicroseconds
            });
            assert.equal(data.completedCases, parameters.files * parameters.casesPerFile);
            observations.push(data);
        }
    } finally {
        const start = clock.currentMonotonicMicroseconds;
        await session.dispose();
        disposalMicroseconds = Number(clock.currentMonotonicMicroseconds - start);
    }
    const distinct = session.environmentLifetime === 'fresh' ? 2 : 1;
    assert.equal(new Set(observations.map(observation => observation.processId)).size, distinct);
    assert.equal(new Set(observations.map(observation => observation.graphIdentity)).size, distinct);
    return mutationCostEvidenceSchema.parse({ tier: 'execution-session', observations,
        environmentLifetime: session.environmentLifetime, completedInvocations: observations.length, disposalMicroseconds });
}

export async function measureMutationCosts(
    modules: MutationModuleUrls, parameters: MutationCostParameters
): Promise<MutationCostEvidence> {
    if (parameters.tier === 'execution-session') return await measureExecutionSession(modules, parameters);
    const campaign = await runMutationCampaign({ modules, mode: parameters, seed: '42', coverage: parameters.coverage,
        catalog: false, targets: [ 'subject-0.mjs' ] });
    assert.equal(campaign.results.length, parameters.mutants);
    for (const mutant of campaign.results) {
        assert.equal(mutant.status, 'Survived', JSON.stringify(mutant));
        assert.equal(mutant.mutatorName, 'BooleanLiteral');
        assert.equal(mutant.testsCompleted, parameters.coverage === 'perTest'
            ? parameters.casesPerFile : parameters.files * parameters.casesPerFile);
    }
    return { tier: 'campaign', completedInvocations: campaign.results.length,
        campaignMicroseconds: campaign.durationMicroseconds };
}
