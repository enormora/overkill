import { writeFile } from 'node:fs/promises';
import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
                definitionLocations: [ { column: null, file: '', line: null } ],
    children: [
        createTestCase({
                definitionLocations: [ { column: null, file: '', line: null } ],
            async body(scope) {
                await writeFile('source/integration-tests/run/fixtures/fs-write-policy-output.txt', 'no');

                return scope.assert.collect();
            },
            metadata: {},
            title: 'writes a file'
        })
    ],
    metadata: {},
    title: 'fixture'
});
