import { gen, property } from '@overkill-dev/test/property';

import { propertyTrialCounter } from './property-console-state.ts';

export const testNode = property({
    title: 'console violation stops property admission',
    generator: gen.constant(1),
    test(value, sample) {
        propertyTrialCounter.trials += 1;
        console.log('forbidden property output');
        sample.assert.equal(value, 1);
        return sample.assert.collect();
    }
});
