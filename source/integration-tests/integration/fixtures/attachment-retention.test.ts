import { suite, test } from '@overkill-dev/test';

import { defineResource, withResource } from '@overkill-dev/test/resources';

const fixture = defineResource({
    acquire() {
        return {};
    },
    dispose: null,
    name: 'fixture',
    requirements: [],
    scope: 'per-case'
});
let attemptNumber = 0;
export const testNode = suite('attachment retention', [
    test(
        'retries retain their own files',
        withResource(fixture, async (scope) => {
            const writer = await scope.attachments.open({ kind: 'binary', mediaType: 'image/png', name: 'screenshot' });
            await writer.write(new Uint8Array([ attemptNumber ]));
            await writer.close();
            attemptNumber += 1;
            scope.assert.equal(attemptNumber, 3);
            return scope.assert.collect();
        })
    ),
    test(
        'unclosed writers retain their prefix',
        withResource(fixture, async (scope) => {
            const writer = await scope.attachments.open({ kind: 'text', mediaType: 'text/plain', name: 'log' });
            await writer.write('last service message');
            return scope.assert.collect();
        })
    )
]);
