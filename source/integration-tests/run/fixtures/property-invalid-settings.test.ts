import { property } from '../../../packages/test/property.entry-point.ts';
import { unexecutedGenerator } from '../../../test-support/property-generator.ts';

export const testNode = property({
    title: 'invalid law',
    generator: unexecutedGenerator<number>(),
    settings: { maxWork: 0 },
    test() {
        throw new Error('Invalid policy must fail before execution.');
    }
});
