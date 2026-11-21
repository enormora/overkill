import { gen, property } from '@overkill-dev/test/property';

export const testNode = property({
    title: 'invalid law',
    generator: gen.constant(null).map<number>(function () {
        throw new Error('Authoring must not invoke generator methods.');
    }),
    settings: { maxWork: 0 },
    test() {
        throw new Error('Invalid policy must fail before execution.');
    }
});
