import { createTestFacade } from '../../../packages/test/test.entry-point.ts';

const integration = createTestFacade();

export const testNode = integration.suite('host process node arguments', [
    integration.test('receives expose gc', function receivesExposeGc(scope) {
        scope.assert.equal(process.execArgv.includes('--expose-gc'), true);

        return scope.assert.collect();
    })
]);
