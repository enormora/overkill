import type { ResolvedRunInput } from './run-input-resolution.ts';
import { createOrdinaryBaselineStore } from './baseline-store.ts';
import { runWithSnapshotRun } from './execution-session-context.ts';
import { snapshotRunSchema } from './snapshot-wire.ts';
import { isSupportedSnapshotRecord } from './snapshot-identity.ts';

export async function withSnapshotRun<Value>(input: ResolvedRunInput, run: () => Promise<Value>): Promise<Value> {
    const { profile } = input;
    if (profile.testFamily === 'benchmark' || profile.testFamily === 'type-test' || !profile.baselines.snapshots) {
        return await run();
    }
    if (profile.testFamily !== 'integration') {
        throw new TypeError('Snapshots require an integration profile.');
    }
    const store = await createOrdinaryBaselineStore({
        projectRoot: input.projectRoot,
        directory: profile.baselines.directory,
        maxBytes: profile.attachments.maxArtifactBytes
    });
    const entries = await store.list();
    return await runWithSnapshotRun(
        snapshotRunSchema.parse({
            profile: input.request.profile,
            mode: input.request.baselineUpdateMode,
            maxBytes: profile.attachments.maxArtifactBytes,
            entries: entries
                .filter(function supportedProfile(entry) {
                    return entry.baseline.profile.normalize('NFC') === input.request.profile.normalize('NFC') &&
                        isSupportedSnapshotRecord(entry.baseline);
                })
                .map(function record(entry) {
                    return entry.baseline;
                })
        }),
        run
    );
}
