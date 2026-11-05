import { propertyReplayWitness } from '../engine/property-corpus.ts';
import { propertyCorpusSnapshot } from '../engine/property-execution-host.ts';
import { CaseRunnerError } from '../engine/run-result.ts';
import type { PropertyWitnessFile } from '../engine/witness-file.ts';
import { propertyRegressionInputs } from './property-regressions.ts';
import { propertyWitnessTarget, samePropertyTarget } from './property-witness.ts';
import { executePropertyInput, type PropertyExecution } from './property-trial-phases.ts';
import type { PropertyExecutionResult } from './property-execution-result.ts';

async function executeWitness<Value>(
    execution: PropertyExecution<Value>,
    witness: PropertyWitnessFile
): Promise<PropertyExecutionResult<Value>> {
    const regressions = propertyRegressionInputs(
        execution.invocation,
        {
            ...execution,
            host: { ...execution.host, corpus: { checkedIn: [ witness ], localCache: [], diagnostics: [] } }
        },
        execution.work.context,
        execution.diagnoseRegression
    );
    const [ input ] = regressions.checkedIn;
    if (input === undefined) {
        throw new TypeError('Witness does not match the executing property identity.');
    }
    const failure = await executePropertyInput(execution, input);
    return failure ?? {
        kind: 'completed',
        accounting: execution.work.snapshot(),
        coverage: execution.coverage.snapshot(),
        exhaustive: null
    };
}
export async function replayPropertyInput<Value>(
    execution: PropertyExecution<Value>
): Promise<PropertyExecutionResult<Value> | null> {
    const witness = propertyReplayWitness(propertyCorpusSnapshot(execution.host));
    if (witness === null || !samePropertyTarget(witness.target, propertyWitnessTarget(execution.identity))) {
        return null;
    }
    try {
        return await executeWitness(execution, witness);
    } catch (error: unknown) {
        throw new CaseRunnerError('Property witness replay failed.', { cause: error, subtype: 'runtime-policy' });
    }
}
