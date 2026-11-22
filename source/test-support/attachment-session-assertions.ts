import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { z } from 'zod/v4';
import { defaultFailureArtifactPolicy, defineReporter } from '../packages/engine/engine.entry-point.ts';
import { reporterWithAttachments } from '../run/attachment-reporter.ts';

const completedRecord = z.object({
    status: z.literal('completed'),
    result: z.object({
        artifacts: z.array(z.object({
            payload: z.object({ content: z.object({ value: z.object({ ready: z.literal(true) }) }) })
        }))
    })
});

export const assertFinalReporter = defineCompositeAssertion({
    name: 'final reporter',
    assert(check) {
        const reporter = {
            dispose: null,
            kind: 'final-result',
            name: 'final',
            sinks: [],
            async onResult() {
                return undefined;
            }
        } as const;
        const wrapped = reporterWithAttachments(defineReporter(function finalReporter() {
            return reporter;
        }));
        return check.group([ check.equal(
            wrapped({
                failureArtifacts: defaultFailureArtifactPolicy,
                relativizeLocationPath(location) {
                    return location.file;
                }
            }),
            reporter
        ) ]);
    }
});
export const completedAttachmentRecord = defineCompositeAssertion({
    name: 'persists the completed run with its ready attachment',
    assert(check, record: string | undefined) {
        if (record === undefined) {
            return check.defined(record);
        }
        const persisted = completedRecord.parse(JSON.parse(record));
        return check.equal(persisted.result.artifacts.length, 1);
    }
});
