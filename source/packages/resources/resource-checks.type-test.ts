import { expect, test } from 'tstyche';
import { defineResource, withResourceChecks } from './resources.entry-point.ts';

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
