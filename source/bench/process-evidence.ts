import { z } from 'zod/v4';
import {
    attachmentsForProducer,
    currentAttachmentLimits
} from '../packages/resources/attachment-context.entry-point.ts';
import { processExecutionSchema, type ProcessExecution } from './process-protocol.ts';

import { processEvidenceMediaType } from './process-evidence-query.ts';

export type ProcessPhase = 'measured' | 'warmup';
export type ProcessEvidence = {
    readonly append: (phase: ProcessPhase, execution: ProcessExecution) => void;
    readonly retain: () => Promise<void>;
};

export const processEvidenceSchema = z.strictObject({
    version: z.literal(1),
    entries: z.array(z.strictObject({ phase: z.enum([ 'measured', 'warmup' ]), execution: processExecutionSchema })),
    omitted: z.number().int().nonnegative()
});

export function createProcessEvidence(): ProcessEvidence {
    const limits = currentAttachmentLimits();
    const maximumBytes = limits === null ? 0 : Math.min(limits.maxArtifactBytes, limits.maxInlineBytes);
    const entries: { readonly phase: ProcessPhase; readonly execution: ProcessExecution; }[] = [];
    let bytes = 128;
    let omitted = 0;
    let retained = false;
    return {
        append(phase, execution) {
            const entry = { phase, execution };
            const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
            if (bytes + size > maximumBytes) {
                omitted += 1;
            } else {
                entries.push(entry);
                bytes += size;
            }
        },
        async retain() {
            if (limits === null || retained) {
                return;
            }
            retained = true;
            await attachmentsForProducer({ kind: 'case' }).json(
                { name: 'benchmark-processes', mediaType: processEvidenceMediaType },
                { version: 1, entries, omitted }
            );
        }
    };
}
