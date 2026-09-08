import { createTestFacade } from '../../../packages/test/test.entry-point.ts';

process.stdout.write('collection stdout\n');

const integration = createTestFacade({
    metadata: { tags: [ 'output' ] },
    testFamily: 'integration'
});

export const testNode = integration.test({
    body(scope) {
        process.stdout.write('case stdout\n');
        process.stderr.write('case stderr\n');
        scope.assert.true(true);

        return scope.assert.collect();
    },
    metadata: { capture: 'live' },
    title: 'captures output'
});
