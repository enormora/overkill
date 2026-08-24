import { writeFileSync } from 'node:fs';
import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
    children: [
        createTestCase({
            async body() {
                writeFileSync('source/integration-tests/run/fixtures/fs-write-policy-output.txt', 'no');
            },
            metadata: {},
            name: 'writes a file'
        })
    ],
    metadata: {},
    name: 'fixture'
});
