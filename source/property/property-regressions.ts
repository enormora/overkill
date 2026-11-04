import { propertyCorpusSnapshot } from '../engine/property-execution-host.ts';
import { caseIdentityKey, runtimeIdentitiesKey } from '../engine/identity.ts';
import type { PropertyWitnessFile } from '../engine/witness-file.ts';
import {
    serializeValue,
    type PropertyFailureObservation
} from '../packages/engine/engine.entry-point.ts';
import { retainRegressionCapture } from './property-regression-capture.ts';
import { decodePropertyInput, PropertyCodecError } from './property-graph.ts';
import { readGeneratorCodec } from './generator.ts';
import type { PropertyInvocationContext, PropertyRegressionInputs } from './property-execution-result.ts';
import type { NormalizedPropertyInvocation } from './property-definition.ts';
import { propertyWitnessTarget, samePropertyTarget } from './property-witness.ts';

type ReplayWork = { readonly consumeWork: () => void; };

function ownsEntry(entry: PropertyWitnessFile, context: PropertyInvocationContext): boolean {
    return caseIdentityKey(entry.case) === caseIdentityKey(context.host.workId.case) &&
        runtimeIdentitiesKey(entry.runtimes) === runtimeIdentitiesKey(context.host.workId.runtimes) &&
        samePropertyTarget(entry.target, propertyWitnessTarget(context.identity));
}

type RegressionDiagnostics = { readonly reason: string; readonly observation: PropertyFailureObservation | null; };
export function propertyRegressionInputs<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    context: PropertyInvocationContext,
    work: ReplayWork,
    diagnose: (diagnostic: RegressionDiagnostics) => void
): PropertyRegressionInputs<Value> {
    const snapshot = propertyCorpusSnapshot(context.host);
    const codec = readGeneratorCodec(invocation.generator);
    function decode(entry: PropertyWitnessFile): Value {
        if (codec !== null) {
            return decodePropertyInput(entry.counterexample, codec, work.consumeWork);
        }
        const value = decodePropertyInput(entry.counterexample, null, work.consumeWork);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Reviewed regression inputs deliberately bypass the current generator domain.
        return value as Value;
    }
    function* inputs(entries: readonly PropertyWitnessFile[], strict: boolean): Generator<() => Value> {
        const selected = entries.filter(function owned(candidate) {
            return ownsEntry(candidate, context);
        });
        for (const entry of selected) {
            try {
                decode(entry);
                function reconstructRegression(): Value {
                    return decode(entry);
                }
                retainRegressionCapture(reconstructRegression, entry.counterexample);
                yield reconstructRegression;
            } catch (error: unknown) {
                if (strict || !(error instanceof PropertyCodecError)) {
                    throw error;
                }
                diagnose({ reason: `Skipped incompatible local corpus entry: ${String(error)}`, observation: null });
            }
        }
    }
    return { checkedIn: inputs(snapshot.checkedIn, true), localCache: inputs(snapshot.localCache, false) };
}

export function corpusDiagnosticObservation(): PropertyFailureObservation {
    return { capture: { kind: 'unavailable' }, input: serializeValue(undefined), failure: serializeValue(undefined) };
}
