import { z } from 'zod/v4';
import {
    attachmentsForProducer,
    currentAttachmentLimits
} from '../packages/resources/attachment-context.entry-point.ts';
import { processExecutionSchema, type ProcessExecution } from './process-protocol.ts';

import { processEvidenceMediaType } from './process-evidence-query.ts';
import type { ModuleImportObservation } from './module-measurement.ts';

const processEvidenceVersion = 2;

export type ProcessPhase = 'measured' | 'warmup';
export type ProcessEvidence = {
    readonly append: (phase: ProcessPhase, execution: ProcessExecution) => void;
    readonly moduleImport: (observation: ModuleImportObservation) => void;
    readonly retain: () => Promise<void>;
};

const legacyProcessEvidenceSchema = z.strictObject({
    version: z.literal(1),
    entries: z.array(z.strictObject({ phase: z.enum([ 'measured', 'warmup' ]), execution: processExecutionSchema })),
    omitted: z.number().int().nonnegative()
});
const moduleObservationSchema = z.strictObject({
    url: z.string(),
    nodeVersion: z.string(),
    nodeArguments: z.array(z.string()),
    durationMicroseconds: z.number().nonnegative(),
    processStartupMilliseconds: z.number().nonnegative(),
    failure: z.string().nullable()
});
const currentProcessEvidenceSchema = legacyProcessEvidenceSchema.extend({
    version: z.literal(processEvidenceVersion),
    entries: z.array(z.strictObject({
        phase: z.enum([ 'measured', 'warmup' ]),
        execution: processExecutionSchema,
        module: moduleObservationSchema.nullable()
    }))
});
export const processEvidenceSchema = z.union([
    currentProcessEvidenceSchema,
    legacyProcessEvidenceSchema.transform(function historicalModuleEvidence(value) {
        return {
            ...value,
            version: processEvidenceVersion,
            entries: value.entries.map(function historicalEntry(entry) {
                return { ...entry, module: null };
            })
        };
    })
]);

export function createProcessEvidence(): ProcessEvidence {
    const limits = currentAttachmentLimits();
    const maximumBytes = limits === null ? 0 : Math.min(limits.maxArtifactBytes, limits.maxInlineBytes);
    const entries: {
        readonly phase: ProcessPhase;
        readonly execution: ProcessExecution;
        readonly module: ModuleImportObservation | null;
    }[] = [];
    let latest: typeof entries[number] | null = null;
    let bytes = 128;
    let omitted = 0;
    let retained = false;
    return {
        append(phase, execution) {
            const entry = { phase, execution, module: null };
            latest = null;
            const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
            if (bytes + size > maximumBytes) {
                omitted += 1;
            } else {
                entries.push(entry);
                latest = entry;
                bytes += size;
            }
        },
        moduleImport(observation) {
            const size = Buffer.byteLength(JSON.stringify(observation));
            if (latest === null || bytes + size > maximumBytes) {
                omitted += 1;
            } else {
                entries[entries.indexOf(latest)] = { ...latest, module: observation };
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
                { version: processEvidenceVersion, entries, omitted }
            );
        }
    };
}
