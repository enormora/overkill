import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { parseRunnerResult } from './run-result-schema.ts';
import { runnerResult } from './runner-result.ts';

export const testNode = suite('runner maintenance diagnostics', [
    test('preserves engine verdicts and diagnostic messages', function (scope: TestScope) {
        const result = {
            ...runResultFactory.build(),
            maintenanceDiagnostics: [ 'History maintenance failed: denied' ]
        };
        const returned = runnerResult(result);
        scope.assert.equal(returned.status, result.status);
        scope.assert.equal(returned.runnerErrors, result.runnerErrors);
        scope.assert.deepEqual(returned.maintenanceDiagnostics, result.maintenanceDiagnostics);
        scope.assert.deepEqual(parseRunnerResult(returned).maintenanceDiagnostics, result.maintenanceDiagnostics);
        return scope.assert.collect();
    }),
    test('unrecorded engine results receive empty maintenance diagnostics', function (scope: TestScope) {
        scope.assert.deepEqual(runnerResult(runResultFactory.build()).maintenanceDiagnostics, []);
        return scope.assert.collect();
    }),
    test('rejects invalid returned diagnostic payloads', function (scope: TestScope) {
        scope.assert.throws(function () {
            return parseRunnerResult({ ...runResultFactory.build(), maintenanceDiagnostics: [ 42 ] });
        }, { message: /string/ });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
