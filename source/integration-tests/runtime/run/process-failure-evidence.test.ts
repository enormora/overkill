import { setTimeout as wait } from 'node:timers/promises';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, suite } from '@overkill-dev/test';

import { createLocalProcessServiceResource, withResources } from '../../../packages/test/resources.entry-point.ts';
import { defaultAttachmentLimits } from '../../../engine/runtime-attachment.ts';
import { executeEvidence } from '../../../test-support/failure-evidence-fixture.ts';
import type { AttachmentFixture } from '../../../test-support/attachment-fixture.ts';

const assertProcessOutput = defineCompositeAssertion({
    name: 'process output',
    assert(check, fixture: AttachmentFixture, name: string, expected: string) {
        const artifact = fixture.store.selectedArtifacts().find(function matchingOutput(entry) {
            return entry.payload.name === name;
        });
        if (artifact === undefined) {
            return check.defined(artifact);
        }
        if (artifact.payload.content.kind !== 'text') {
            throw new Error('Expected process evidence.');
        }
        return check.group([ check.equal(artifact.payload.content.text, expected) ]);
    }
});

export const testNode = suite(
    'Process failure evidence',
    [ table({
        title: 'process evidence survives forced shutdown and readiness failure',
        cases: [ false, true ],
        caseTitle: String,
        async test(scope) {
            const readinessFails = scope.parameters;
            const processBoundaryResource = createLocalProcessServiceResource({
                name: 'daemon',
                scope: 'per-case',
                requirements: [],
                dependencies: {},
                address: { kind: 'loopback', port: 0 },
                outputBufferBytes: 64,
                shutdown: { gracefulSignal: 'SIGTERM', forceSignal: 'SIGKILL', graceMilliseconds: 10 },
                command() {
                    return {
                        command: process.execPath,
                        arguments: [
                            '--disable-warning=PERM0004',
                            '-e',
                            'process.on("SIGTERM", () => {}); process.stdout.write(Buffer.from([114,101,97,100,121,240])); process.stderr.write(Buffer.from([119,97,114,110,105,110,103,195])); setInterval(() => {}, 1000);'
                        ],
                        environment: {},
                        workingDirectory: null
                    };
                },
                async ready(owner) {
                    while (!owner.output.stdout.text().includes('ready')) {
                        await wait(5);
                    }
                    if (readinessFails) {
                        throw new Error('Readiness failed.');
                    }
                    return { ready: true };
                }
            });
            const processBoundaryFixture = await executeEvidence(
                scope.cleanup,
                withResources({ resource: processBoundaryResource }, function failingBody(testScope) {
                    testScope.assert.fail();
                    return testScope.assert.collect();
                }),
                1,
                defaultAttachmentLimits
            );
            scope.assert(assertProcessOutput, processBoundaryFixture, 'stdout', 'ready�');
            scope.assert(assertProcessOutput, processBoundaryFixture, 'stderr', 'warning�');
            scope.assert.equal(processBoundaryFixture.result.status, 'failed');
            scope.assert.equal(processBoundaryFixture.result.runnerErrors.length, readinessFails ? 1 : 0);

            return scope.assert.collect();
        }
    }) ]
);
