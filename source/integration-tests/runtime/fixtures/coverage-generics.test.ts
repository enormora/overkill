import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';
import { replacements } from './coverage-generics.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

export const testNode = createSuite({
    ...metadata,
    title: 'generic method coverage',
    children: [ true, true, false ].map(function replacementCase(value, index) {
        return createTestCase({
            ...metadata,
            title: `replace ${index}`,
            body(scope) {
                scope.assert.equal(replacements.replace<number>(42, value), value ? 42 : null);
                return scope.assert.collect();
            }
        });
    })
});
