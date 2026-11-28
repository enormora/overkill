import { suite, test } from '@overkill-dev/test';
import { assignableFrom, sameType } from '@overkill-dev/type-test';
import { isEqualTo } from '../../test-support/type-relations.ts';
import {
    defineResource,
    withResourceChecks,
    ResourceCheckError,
    type ResourceCheckSnapshot
} from './resources.entry-point.ts';

const owner = defineResource({
    name: 'observed-service',
    scope: 'per-run',
    requirements: [],
    acquire() {
        return { secret: 'owner' };
    },
    dispose: null,
    serializeHandle() {
        return { url: 'http://localhost' };
    },
    deserializeHandle() {
        return { url: 'http://localhost' };
    }
});

export const testNode = suite('Resource check scopes and verdicts', [
    test('resource checks retain descriptor inference and receive the owner handle', function (scope) {
        const observed = withResourceChecks(owner, function (context) {
            scope.assert(sameType.withActual<string>(), context.handle.secret);
            scope.assert(assignableFrom.not<keyof typeof context.handle, 'url'>());
            context.cleanup.defer(function (signal) {
                scope.assert(sameType.withActual<true>(), isEqualTo<AbortSignal>()(signal));
            });
            return {
                prepare() {
                    return undefined;
                },
                finalize() {
                    return { kind: 'complete' };
                }
            };
        });
        scope.assert(sameType.withActual<true>(), isEqualTo<typeof owner>()(observed));
        return scope.assert.collect();
    }),
    test('standalone errors retain owner and interval evidence', function (scope) {
        const error = new ResourceCheckError('Resource checks failed.', { resourceChecks: [], errors: [] });
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<readonly ResourceCheckSnapshot[]>()(error.resourceChecks())
        );
        scope.assert(
            sameType<
                ResourceCheckSnapshot['owner']['scope'],
                'per-case' | 'per-file' | 'per-run' | 'per-suite' | 'shared-per-worker'
            >()
        );
        return scope.assert.collect();
    })
]);
