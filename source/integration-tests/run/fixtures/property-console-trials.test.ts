import { gen, property } from '../../../packages/test/property.entry-point.ts';

let trials = 0;

export function propertyTrialCount(): number {
    return trials;
}

export function resetPropertyTrialCount(): void {
    trials = 0;
}

export const testNode = property({
    title: 'console violation stops property admission',
    generator: gen.constant(1),
    test(value, sample) {
        trials += 1;
        console.log('forbidden property output');
        sample.assert.equal(value, 1);
        return sample.assert.collect();
    }
});
