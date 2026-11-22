import { property, gen } from '@overkill-dev/test/property';

export const testNode = property({
    title: 'hangs after confirming the original failure',
    generator: gen.integer({ min: 0, max: 100 }),
    examples: [ () => 100 ],
    test(value, sample) {
        while (value === 0) {
            Math.sqrt(value);
        }
        sample.assert.fail({ message: 'original failure before shrinking' });
        return sample.assert.collect();
    }
});
