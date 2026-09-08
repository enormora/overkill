import { createTestFacade } from '../../../packages/test/test.entry-point.ts';

process.stdout.write('collection stdout\n');

const integration = createTestFacade({
    metadata: { tags: [ 'output' ] },
    testFamily: 'integration'
});

export const testNode = integration.test('captures output', function testOutput(scope) {
    process.stdout.write('case stdout\n');
    process.stderr.write('case stderr\n');
    scope.assert.true(true);

    return scope.assert.collect();
});
