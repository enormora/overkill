import { runIfMain } from '#test-runner';
import { ConfigError } from '../../config/config-error.ts';
import { RunResolutionError } from '../../run/run-errors.ts';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { isHitLimitGuard, isWrappedHitLimitGuard } from './mutation-hit-limit.ts';

const guard = new Error('Stryker: Hit count limit reached (42)');
const configuration = {
    kind: 'configuration-loading',
    failure: { kind: 'config-error', name: 'ConfigError', cause: guard }
};
const accepted: readonly unknown[] = [
    guard,
    configuration,
    new Error('Frozen policy revalidation failed: changed', { cause: configuration }),
    new ConfigError('configuration', { cause: guard }),
    new RunResolutionError('resolution', { cause: guard }, 'invalid-request')
];
const rejected: readonly unknown[] = [
    null,
    guard.message,
    new Error('unrelated'),
    new TypeError(guard.message),
    new Error(guard.message, { cause: new Error('cause') }),
    new Error('Frozen policy revalidation failed: changed', { cause: guard }),
    new Error('unrelated', { cause: guard }),
    { ...configuration, failure: { ...configuration.failure, cause: new Error('unrelated') } }
];
export const testNode = suite('mutation hit limit guard recognition', [
    ...accepted.map(function (error, index) {
        return test(`recognizes supported guard envelope ${index}`, function (scope: TestScope) {
            scope.assert.true(isWrappedHitLimitGuard(error));
            scope.assert.equal(isHitLimitGuard(error), error === guard);
            return scope.assert.collect();
        });
    }),
    ...rejected.map(function (error, index) {
        return test(`rejects unrelated guard envelope ${index}`, function (scope: TestScope) {
            scope.assert.false(isWrappedHitLimitGuard(error));
            scope.assert.false(isHitLimitGuard(error));
            return scope.assert.collect();
        });
    })
]);
await runIfMain(import.meta, testNode);
