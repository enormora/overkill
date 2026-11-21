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
import { typeTestSettingsSchema, type TypeTestSettings } from './profile-settings.ts';
import type { CheckerPreparation, CollectedCheckerRun, CheckerExecution } from './checker-plan.ts';

function selectedCheckerPlan(
    preparation: CheckerPreparation,
    workIds: readonly WorkId[]
): CheckerPreparation['testPlan'] {
    const available = new Map(preparation.testPlan.cases.map(function byIdentity(testCase) {
        return [ workIdentityKey(testCase.workId), testCase ];
    }));
    const cases = workIds.map(function selected(workId) {
        const testCase = available.get(workIdentityKey(workId));
        if (testCase === undefined) {
            throw new TypeError('Unknown selected compiler work.');
        }
        return testCase;
    });
    const [ first, ...rest ] = cases;
    if (first === undefined) {
        throw new TypeError('Expected selected compiler work.');
    }
    return { ...preparation.testPlan, cases: [ first, ...rest ] };
}

function checkerFactsArtifact(result: RunResult, facts: CheckerExecution['facts']): RunArtifact {
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
    const { result, facts } = await collected.execute();
    await reportCheckerResult(context, result);
    await context.report({ kind: 'artifact', artifact: checkerFactsArtifact(result, facts) });
}

export async function prepare(input: FamilyPreparationInput<TypeTestSettings>): Promise<FamilyPreparation> {
    const settings = typeTestSettingsSchema.parse(input.settings);
    const preparation = await prepareCompilerPlan(
        input.testPlan,
        {
            ...settings,
            projectConfigPath: resolve(input.projectRoot, settings.projectConfigPath)
        },
        input.projectRoot,
        input.expandVariants
    );
    return {
        testPlan: preparation.testPlan,
        facts: preparation.facts,
        async dispose() {
            await preparation.dispose();
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
