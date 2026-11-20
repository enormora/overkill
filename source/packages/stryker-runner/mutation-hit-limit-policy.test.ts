import { table, type TestNode, suite } from '@overkill-dev/test';

import { ConfigError } from '../../config/config-error.ts';
import { RunResolutionError } from '../../run/run-errors.ts';

import { isHitLimitGuard, isWrappedHitLimitGuard } from './mutation-hit-limit.ts';

const guard = new Error('Stryker: Hit count limit reached (42)');
const configuration = {
    kind: 'configuration-loading',
    failure: { kind: 'config-error', name: 'ConfigError', cause: guard }
};
export const testNode: TestNode = suite('mutation hit limit guard recognition', [
    table({
        title: 'recognizes supported guard envelope',
        cases: [
            { description: 'direct guard', input: guard },
            { description: 'configuration failure', input: configuration },
            {
                description: 'frozen configuration failure',
                input: new Error('Frozen policy revalidation failed: changed', { cause: configuration })
            },
            { description: 'configuration error cause', input: new ConfigError('configuration', { cause: guard }) },
            {
                description: 'resolution error cause',
                input: new RunResolutionError('resolution', { cause: guard }, 'invalid-request')
            }
        ],
        caseTitle({ description }) {
            return description;
        },
        test(scope) {
            const error = scope.parameters.input;

            scope.assert.true(isWrappedHitLimitGuard(error));
            scope.assert.equal(isHitLimitGuard(error), error === guard);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects unrelated guard envelope',
        cases: [
            { description: 'null', input: null },
            { description: 'message string', input: guard.message },
            { description: 'unrelated exception', input: new Error('unrelated') },
            { description: 'wrong error type', input: new TypeError(guard.message) },
            { description: 'unexpected nested cause', input: new Error(guard.message, { cause: new Error('cause') }) },
            {
                description: 'bare frozen guard',
                input: new Error('Frozen policy revalidation failed: changed', { cause: guard })
            },
            { description: 'unrelated outer error', input: new Error('unrelated', { cause: guard }) },
            {
                description: 'unrelated configuration cause',
                input: { ...configuration, failure: { ...configuration.failure, cause: new Error('unrelated') } }
            }
        ],
        caseTitle({ description }) {
            return description;
        },
        test(scope) {
            const error = scope.parameters.input;

            scope.assert.false(isWrappedHitLimitGuard(error));
            scope.assert.false(isHitLimitGuard(error));
            return scope.assert.collect();
        }
    })
]);
