import { createTestCase, unknownSourceLocation } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createTestCase({
    title: 'entry with a then export',
    annotations: {},
    controls: {},
    definitionLocations: [ unknownSourceLocation ],
    body(scope) {
        scope.assert.fail({ message: 'Discovery should reject this entry before execution.' });
        return scope.assert.collect();
    }
});

export function then(resolve: (value: { readonly testNode: typeof testNode; }) => void): void {
    resolve({ testNode });
}
