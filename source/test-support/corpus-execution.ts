import type { RunResult } from '../engine/run-result.ts';
import type { PropertyInvocationEvidence } from '../engine/property-failure-evidence.ts';
import { createPropertyCorpusExecution, type PropertyCorpusExecution } from '../run/property-corpus-execution.ts';
import { normalizeConfig } from '../config/config.ts';
import type { ResolvedRun } from '../run/run-types.ts';
import type { PropertyWitnessFile } from '../engine/witness-file.ts';
import { propertyCorpusEntry } from './property-corpus.ts';
import { attachmentRecording } from './attachment-recording.ts';
import { defaultRunRequest } from './run-command-factory.ts';

export type CorpusExecutionScenario = 'diagnostics' | 'pass' | 'read-error' | 'write-error';
type CorpusExecutionFixture = {
    readonly run: ResolvedRun;
    readonly execution: PropertyCorpusExecution;
    readonly events: readonly string[];
    readonly saved: readonly (readonly PropertyWitnessFile[])[];
    readonly failure: Error;
};
export async function corpusExecution(
    scenario: CorpusExecutionScenario,
    property: boolean
): Promise<CorpusExecutionFixture> {
    const original = await attachmentRecording(null);
    const events: string[] = [];
    const saved: (readonly PropertyWitnessFile[])[] = [];
    const failure = new Error('Corpus storage failed.');
    const config = property
        ? normalizeConfig({ profiles: { laws: { testFamily: 'property', files: { include: [ 'laws.ts' ] } } } })
        : original.resolved.config;
    const run = {
        ...original.resolved,
        config,
        request: property ? defaultRunRequest({ profile: 'laws' }) : original.resolved.request
    };
    const execution = createPropertyCorpusExecution({
        async read(projectRoot, directory, profile) {
            events.push(`read:${projectRoot}:${directory}:${profile}`);
            if (scenario === 'read-error') {
                throw failure;
            }
            return { checkedIn: [ propertyCorpusEntry ], localCache: [], diagnostics: [] };
        },
        async save(directory, profile, _policy, entries) {
            events.push(`save:${directory}:${profile}`);
            saved.push(entries);
            if (scenario === 'write-error') {
                throw failure;
            }
            return scenario === 'diagnostics' ? [ { path: '/cache', reason: 'Cache entry incompatible.' } ] : [];
        }
    });
    return { run, execution, events, saved, failure };
}

export function corpusDiagnostics(result: RunResult): PropertyInvocationEvidence['diagnostics'] {
    const invocation = result.perTest[0]?.property?.invocations[0];
    if (invocation === undefined) {
        throw new Error('Missing property invocation.');
    }
    return invocation.diagnostics;
}
