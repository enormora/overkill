import { createTestFacade } from '../../../packages/test/test.entry-point.ts';

process.stdout.write('collection stdout\n');

const integration = createTestFacade({
    annotations: { tags: [ 'output' ] },
    controls: {},
    testFamily: 'integration'
});

export const testNode = integration.test('captures output', function testOutput(scope) {
    process.stdout.write('case stdout\n', function ignoreWriteResult() {
        return undefined;
    });
    process.stderr.write('case stderr\n', 'utf8', function ignoreErrorWriteResult() {
        return undefined;
    });
    scope.assert.true(true);

    return scope.assert.collect();
});
