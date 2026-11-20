import { table, type TestNode, suite } from '@overkill-dev/test';

import { ConfigError } from '../../config/config-error.ts';
import { RunResolutionError } from '../../run/run-errors.ts';

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
export const testNode: TestNode = suite('mutation hit limit guard recognition', [
    table({
        title: 'recognizes supported guard envelope',
        cases: accepted,
        caseTitle(_parameters, index) {
            return `${index}`;
        },
        test(scope) {
            const error = scope.parameters;

            scope.assert.true(isWrappedHitLimitGuard(error));
            scope.assert.equal(isHitLimitGuard(error), error === guard);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects unrelated guard envelope',
        cases: rejected,
        caseTitle(_parameters, index) {
            return `${index}`;
        },
        test(scope) {
            const error = scope.parameters;

            scope.assert.false(isWrappedHitLimitGuard(error));
            scope.assert.false(isHitLimitGuard(error));
            return scope.assert.collect();
        }
    })
]);
