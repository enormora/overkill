import { createTestFacade } from '../../../packages/test/test.entry-point.ts';

process.stdout.write('collection stdout\n');

const integration = createTestFacade({
    annotations: { tags: [ 'output' ] },
    controls: {},
    testFamily: 'integration'
});

export const testNode = integration.test({
    body(scope) {
        process.stdout.write('case stdout\n');
        process.stderr.write('case stderr\n');
        scope.assert.true(true);

        return scope.assert.collect();
    },
    annotations: {},
    controls: { capture: 'live' },
    title: 'captures output'
});
