import { type TestNode, suite, test } from '@overkill-dev/test';

import { defaultRunRequest, defaultIntegrationProfile, defaultRunConfig } from '../test-support/run-command-factory.ts';

import type { RunCommand } from '../run/run-types.ts';
import { validateRunInput } from '../run/run-validation.ts';
import { integrationProfileSchema, microtestProfileSchema } from './schema.ts';
import { attachmentLimitsSchema } from './evidence-policy.ts';

const files = { include: [ 'source/**/*.integration.test.ts' ] };
export const testNode: TestNode = suite('Configuration attachments', [
    test('normalized integration profiles reject unbounded attachment limits', function (scope) {
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
    }),
    test(
        'integration attachment limits default independently and preserve explicit overrides',
        function (scope) {
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
    ),
    test(
        'attachment budgets reject invalid values and microtest profiles reject attachments',
        function (scope) {
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
    )
]);
