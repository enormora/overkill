import { property, gen } from '@overkill-dev/test/property';

export const testNode = property({
    title: 'generator callback hangs',
    generator: gen.constant(0).map(function neverReturns(value): number {
        while (value === 0) {
            Math.sqrt(value);
        }
        return value;
    }),
    test(value, sample) {
        sample.assert.equal(value, 0);
        return sample.assert.collect();
    }
});
