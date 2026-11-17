import type { ReadingAttribution } from '../engine/measurement-evidence.ts';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import { measurementContext } from './measurement-context.ts';
import { MeasurementContractError } from './measurement-contract-error.ts';

const attributions = new WeakMap<WeakKey, ReadingAttribution>();
export function attributeReading(reading: WeakKey): ReadingAttribution | null {
    const context = measurementContext.getStore();
    const previous = attributions.get(reading);
    if (context === undefined) {
        return previous ?? null;
    }
    const current = { invocation: context.invocation, target: context.target.identity };
    if (previous !== undefined && canonicalIdentityJson(previous) !== canonicalIdentityJson(current)) {
        throw new MeasurementContractError('Metric reading belongs to another invocation or target.', {});
    }
    attributions.set(reading, current);
    return current;
}
