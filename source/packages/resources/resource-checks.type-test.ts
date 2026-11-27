import { suite, test } from '@overkill-dev/test';
import { assignableFrom, sameType } from '@overkill-dev/type-test';
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

export const testNode = suite('resource checks', [
    test('resource checks retain descriptor inference and receive the owner handle', function (typeScope) {
        const observed = withResourceChecks(owner, function (context) {
            typeScope.assert(sameType.withActual<string>(), context.handle.secret);
            typeScope.assert(assignableFrom.not<keyof typeof context.handle, 'url'>());
            context.cleanup.defer(function (signal) {
                typeScope.assert(sameType.withActual<AbortSignal>(), signal);
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
        typeScope.assert(sameType.withActual<typeof owner>(), observed);
        return typeScope.assert.collect();
    }),
    test('standalone errors retain owner and interval evidence', function (typeScope) {
        const error = new ResourceCheckError('Resource checks failed.', { resourceChecks: [], errors: [] });
        typeScope.assert(sameType.withActual<readonly ResourceCheckSnapshot[]>(), error.resourceChecks());
        typeScope.assert(
            sameType<
                ResourceCheckSnapshot['owner']['scope'],
                'per-case' | 'per-file' | 'per-run' | 'per-suite' | 'shared-per-worker'
            >()
        );
        return typeScope.assert.collect();
    })
]);
