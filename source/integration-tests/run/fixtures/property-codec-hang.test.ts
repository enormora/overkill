import { property, gen, defineCodec } from '../../../packages/property/property.entry-point.ts';

export const testNode = property({
    title: 'codec callback hangs',
    generator: gen.constant<number>(0).withCodec(defineCodec({
        name: 'hanging', version: 1, previousDecoders: [],
        encode(value: number) {
            while (value === 0) Math.sqrt(value);
            return value;
        },
        decode(value) {
            if (typeof value !== 'number') throw new TypeError('Expected a number.');
            return value;
        }
    })),
    test(value, sample) {
        sample.assert.equal(value, 0);
        return sample.assert.collect();
    }
});
