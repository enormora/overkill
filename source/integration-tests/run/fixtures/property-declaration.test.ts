import { property } from '../../../packages/test/property.entry-point.ts';
import { unexecutedGenerator } from '../../../test-support/property-generator.ts';

export const testNode = property({
    title: 'declared law',
    generator: unexecutedGenerator<number>(),
    settings: { newTrials: 200 },
    test() {
        throw new Error('Property execution must remain unavailable.');
    }
});
