import { property, gen } from '../../../packages/test/property.entry-point.ts';

export const testNode = property({
    title: 'regression input',
    generator: gen.constant(42),
    test(value, sample) {
        sample.failureKey('regression');
        sample.assert.equal(value, 0);
        return sample.assert.collect();
    }
});
