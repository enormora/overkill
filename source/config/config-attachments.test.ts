import { defaultRunRequest, defaultIntegrationProfile, defaultRunConfig } from '../test-support/run-command-factory.ts';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import type { RunCommand } from '../run/run-types.ts';
import { validateRunInput } from '../run/run-validation.ts';
import { attachmentLimitsSchema, integrationProfileSchema, microtestProfileSchema } from './schema.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const files = { include: [ 'source/**/*.integration.test.ts' ] };
export const testNode = createSuite({
    ...metadata,
    title: 'source/config/config-attachments.test.ts',
    children: [
        createTestCase({
            ...metadata,
            title: 'normalized integration profiles reject unbounded attachment limits',
            body(scope: TestScope) {
                const profile = {
                    ...defaultIntegrationProfile({}),
                    attachments: {
                        maxArtifactBytes: 1024,
                        maxInlineBytes: Number.POSITIVE_INFINITY,
                        maxScopeAttachments: 5,
                        maxScopeBytes: 2048
                    }
                };
                const command: RunCommand = {
                    config: defaultRunConfig({ profiles: { integration: profile } }),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: defaultRunRequest()
                };
                scope.assert.throws(function rejectUnboundedLimit() {
                    validateRunInput(command);
                }, { message: 'Attachment maxInlineBytes must be a positive safe integer.' });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'integration attachment limits default independently and preserve explicit overrides',
            body(scope: TestScope) {
                const profile = integrationProfileSchema.parse({ testFamily: 'integration', files });
                scope.assert.deepEqual(profile.attachments, {
                    maxArtifactBytes: 10_485_760,
                    maxInlineBytes: 1_048_576,
                    maxScopeAttachments: 100,
                    maxScopeBytes: 10_485_760
                });
                const limits = attachmentLimitsSchema.parse({ maxInlineBytes: 3 });
                scope.assert.deepEqual(limits, {
                    maxArtifactBytes: 10_485_760,
                    maxInlineBytes: 3,
                    maxScopeAttachments: 100,
                    maxScopeBytes: 10_485_760
                });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'attachment budgets reject invalid values and microtest profiles reject attachments',
            body(scope: TestScope) {
                for (const value of [ 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1 ]) {
                    for (
                        const field of [ 'maxInlineBytes', 'maxArtifactBytes', 'maxScopeBytes', 'maxScopeAttachments' ]
                    ) {
                        scope.assert.equal(attachmentLimitsSchema.safeParse({ [field]: value }).success, false);
                    }
                }
                scope.assert.equal(
                    microtestProfileSchema.safeParse({ testFamily: 'microtest', attachments: {} }).success,
                    false
                );
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
