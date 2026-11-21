import { attachComposedResourceActions } from '../packages/test/resource-wrapper-composition.ts';

export async function mappedResourceScope(value: unknown): Promise<unknown> {
    const body: unknown = Reflect.apply(attachComposedResourceActions, undefined, [ [ {
        kind: 'scope',
        name: 'withMapped',
        collision: 'replace-existing',
        mapScope() {
            return value;
        }
    } ], function (context: unknown) {
        const tag: unknown = Reflect.get(new Object(context), 'tag');
        return tag;
    }, 'withMapped' ]);
    if (typeof body !== 'function') {
        throw new TypeError('Expected a composed body.');
    }
    const input = {
        tag: 'original',
        signal: new AbortController().signal,
        cleanup() {
            return undefined;
        }
    };
    const result: unknown = Reflect.apply(body, undefined, [ input ]);
    return await result;
}
