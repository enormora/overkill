import type { ResourceCheckObservation } from '../resources/resource-checks.ts';
import type { ResourceCheckWriter } from '../resources/resource-check-contract.ts';

type ObservationContext = { readonly ledger: ResourceCheckWriter; };

export const observer = {
    version: '1',
    implementation(context: ObservationContext, input: string): ResourceCheckObservation {
        context.ledger.record({ kind: 'lifetime' }, input, { kind: 'pass' });
        return {
            prepare() {
                return undefined;
            },
            finalize() {
                return { kind: 'complete' };
            }
        };
    }
};
