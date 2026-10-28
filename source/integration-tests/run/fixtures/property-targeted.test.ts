import { property, gen } from '../../../packages/test/property.entry-point.ts';
export const testNode = property({
    title: 'targeted property',
    generator: gen.integer({ min: 0, max: 10_000 }),
    settings: { newTrials: 20, maxAutomaticEdges: 0, maxExhaustiveValues: 0 },
    test(value, sample) {
        sample.target('value', value);
        sample.assert.true(value >= 0 && value <= 10_000);
        return sample.assert.collect();
    }
});
