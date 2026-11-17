import path from 'node:path';
import type { PropertyWitnessFile } from '../engine/witness-file.ts';
import { emptyPropertyCorpus, type PropertyCorpusSnapshot } from '../engine/property-corpus.ts';
import { runStatusFromSummary, type RunResult, type PerTestResult } from '../engine/run-result.ts';
import type { CorpusDiagnostic } from './property-corpus-cache.ts';
import { hasPropertyReplay } from './run-support.ts';
import { currentReplayWitness } from './replay-context.ts';
import { readPropertyCorpus, savePropertyCorpus } from './property-corpus-storage.ts';
import type { ResolvedRun } from './run-types.ts';

function selectedPropertyWitness(run: ResolvedRun): PropertyWitnessFile | null {
    const witness = currentReplayWitness();
    if (witness?.kind === 'property') {
        return witness;
    }
    return hasPropertyReplay(run.facts) ? run.facts.propertyReplay : null;
}
export type PropertyCorpusRuntime = {
    readonly read: typeof readPropertyCorpus;
    readonly save: typeof savePropertyCorpus;
};
export type PropertyCorpusExecution = {
    readonly resolve: (run: ResolvedRun) => Promise<PropertyCorpusSnapshot>;
    readonly persist: (run: ResolvedRun, result: RunResult) => Promise<RunResult>;
};
function appendCorpusDiagnostics(testCase: PerTestResult, diagnostics: readonly CorpusDiagnostic[]): PerTestResult {
    if (testCase.property === null) {
        return testCase;
    }
    const property = {
        invocations: testCase.property.invocations.map(function diagnosedInvocation(invocation) {
            return {
                ...invocation,
                diagnostics: [
                    ...invocation.diagnostics,
                    ...diagnostics.map(function diagnostic(item) {
                        return { reason: item.reason, observation: null };
                    })
                ]
            };
        })
    };
    return { ...testCase, property };
}
export function createPropertyCorpusExecution(runtime: PropertyCorpusRuntime): PropertyCorpusExecution {
    async function resolvedPropertyCorpus(run: ResolvedRun): Promise<PropertyCorpusSnapshot> {
        if (selectedPropertyWitness(run)?.target.kind === 'property-value') {
            return emptyPropertyCorpus;
        }
        const profile = run.config.profiles[run.request.profile];
        if (profile?.testFamily !== 'property') {
            return emptyPropertyCorpus;
        }
        return await runtime.read(
            run.facts.environment.projectRoot,
            path.resolve(run.facts.environment.projectRoot, run.config.runtimeStateDir),
            run.request.profile,
            profile.corpus
        );
    }

    function confirmedWitnesses(result: RunResult): readonly PropertyWitnessFile[] {
        return result.perTest.flatMap(function caseWitnesses(testCase) {
            return testCase.property?.invocations.flatMap(function confirmed(invocation) {
                return invocation.confirmedWitness === null ? [] : [ invocation.confirmedWitness ];
            }) ?? [];
        });
    }

    async function writeConfirmedCorpus(run: ResolvedRun, result: RunResult): Promise<RunResult> {
        const profile = run.config.profiles[run.request.profile];
        if (profile?.testFamily !== 'property') {
            return result;
        }
        const diagnostics = await runtime.save(
            path.resolve(run.facts.environment.projectRoot, run.config.runtimeStateDir),
            run.request.profile,
            profile.corpus,
            confirmedWitnesses(result)
        );
        if (diagnostics.length === 0) {
            return result;
        }
        const perTest = result.perTest.map(function diagnosed(testCase) {
            return appendCorpusDiagnostics(testCase, diagnostics);
        });
        return { ...result, perTest };
    }

    async function persistPropertyCorpus(run: ResolvedRun, result: RunResult): Promise<RunResult> {
        if (currentReplayWitness() !== null) {
            return result;
        }
        const profile = run.config.profiles[run.request.profile];
        if (profile?.testFamily !== 'property') {
            return result;
        }
        try {
            return await writeConfirmedCorpus(run, result);
        } catch (error: unknown) {
            const runnerErrors = [ ...result.runnerErrors, {
                attributedToAttempt: null,
                attributedTo: null,
                cause: error,
                diagnostics: [],
                message: 'Failed to write property corpus.',
                subtype: 'runtime-state' as const
            } ];
            return { ...result, runnerErrors, status: runStatusFromSummary(result.summary, runnerErrors) };
        }
    }

    return { resolve: resolvedPropertyCorpus, persist: persistPropertyCorpus };
}
export const { resolve: resolvedPropertyCorpus, persist: persistPropertyCorpus } = createPropertyCorpusExecution({
    read: readPropertyCorpus,
    save: savePropertyCorpus
});
