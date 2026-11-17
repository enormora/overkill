import { expect, test } from 'tstyche';
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

test('resource checks retain descriptor inference and receive the owner handle', function () {
    const observed = withResourceChecks(owner, function (context) {
        expect(context.handle.secret).type.toBe<string>();
        expect(context.handle).type.not.toHaveProperty('url');
        context.cleanup.defer(function (signal) {
            expect(signal).type.toBe<AbortSignal>();
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
    expect(observed).type.toBe<typeof owner>();
});

test('standalone errors retain owner and interval evidence', function () {
    const error = new ResourceCheckError('Resource checks failed.', { resourceChecks: [], errors: [] });
    expect(error.resourceChecks()).type.toBe<readonly ResourceCheckSnapshot[]>();
    expect<ResourceCheckSnapshot['owner']['scope']>().type.toBe<
        'per-case' | 'per-file' | 'per-run' | 'per-suite' | 'shared-per-worker'
    >();
});
