import { resolve } from 'node:path';
import {
    workIdentityKey,
    type FamilyPreparationInput,
    type FamilyPreparation,
    type FamilyAnalysisContext,
    type RunResult,
    type RunArtifact,
    type WorkId
} from '../engine/engine.entry-point.ts';
import { prepare as prepareCompilerPlan } from './compiler-plan.ts';
import { typeTestSettingsSchema, type TypeTestOptions } from './profile-settings.ts';
import type { CheckerPreparation, CollectedCheckerRun, PreparedCheckerRun } from './checker-plan.ts';

function selectedCheckerPlan(
    preparation: CheckerPreparation,
    workIds: readonly WorkId[]
): CheckerPreparation['testPlan'] {
    const wanted = new Set(workIds.map(workIdentityKey));
    const cases = preparation.testPlan.cases.filter(function selected(testCase) {
        return wanted.has(workIdentityKey(testCase.workId));
    });
    const [ first, ...rest ] = cases;
    if (first === undefined) {
        throw new TypeError('Expected selected compiler work.');
    }
    return { ...preparation.testPlan, cases: [ first, ...rest ] };
}

function checkerFactsArtifact(result: RunResult, facts: PreparedCheckerRun['facts']): RunArtifact {
    return {
        id: {
            familyVariant: null,
            subtype: 'adapter',
            sequence: result.artifacts.length,
            scope: { kind: 'run' },
            attempt: null,
            runtimes: [],
            workload: null
        },
        source: 'native',
        payload: { kind: 'adapter', adapter: '@overkill-dev/type-test', facts }
    };
}

async function reportCheckerResult(context: FamilyAnalysisContext, result: RunResult): Promise<void> {
    for (const error of result.runnerErrors) {
        await context.report({ kind: 'run-error', error });
    }
    for (const testCase of result.perTest) {
        context.signal.throwIfAborted();
        await context.report({ kind: 'case-start', workId: testCase.workId });
        await context.report({ kind: 'case-end', result: testCase, artifacts: [] });
    }
    for (const artifact of result.artifacts) {
        await context.report({ kind: 'artifact', artifact });
    }
}

async function executeCheckerCollection(collected: CollectedCheckerRun, context: FamilyAnalysisContext): Promise<void> {
    context.signal.throwIfAborted();
    const lowered = await collected.lower();
    const result = await lowered.execute();
    await reportCheckerResult(context, result);
    await context.report({ kind: 'artifact', artifact: checkerFactsArtifact(result, lowered.facts) });
}

export async function prepare(input: FamilyPreparationInput<TypeTestOptions>): Promise<FamilyPreparation> {
    const settings = typeTestSettingsSchema.parse(input.settings);
    const preparation = await prepareCompilerPlan(input.testPlan, {
        ...settings,
        projectConfigPath: resolve(input.projectRoot, settings.projectConfigPath)
    }, input.expandVariants);
    return {
        testPlan: preparation.testPlan,
        facts: null,
        async dispose() {
            return undefined;
        },
        async collect(selection) {
            const collected = await preparation.collect(selectedCheckerPlan(preparation, selection.workIds));
            return {
                kind: 'analysis',
                facts: collected.facts,
                async execute(context) {
                    await executeCheckerCollection(collected, context);
                }
            };
        }
    };
}
