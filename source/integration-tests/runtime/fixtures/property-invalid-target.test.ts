import { property, gen } from '@overkill-dev/test/property';

export const testNode = property({
    title: 'invalid target',
    generator: gen.constant(1),
    test(_value, sample) {
        sample.target('value', Number.NaN);
        return sample.assert.collect();
    }
});
