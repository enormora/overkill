import { property, gen } from '@overkill-dev/test/property';

export const testNode = property({
    title: 'declared law',
    generator: gen.integer({ min: 0, max: 10 }),
    settings: { newTrials: 200 },
    test(value, sample) {
        sample.assert.equal(Number.isSafeInteger(value), true);
        return sample.assert.collect();
    }
});
