import { mkdir } from 'node:fs/promises';
import properLockfile from 'proper-lockfile';
import type { BaselineWriteOutcome } from '../baselines/baseline-model.ts';
import type { OrdinaryBaselineChange, StoredOrdinaryBaseline } from './baseline-record.ts';

export type BaselineStoreCommit = {
    readonly outcome: Exclude<BaselineWriteOutcome<StoredOrdinaryBaseline>, { readonly kind: 'read-only'; }>;
    readonly errors: readonly unknown[];
};

type PublicationInput = {
    readonly validate: (changes: readonly OrdinaryBaselineChange[]) => Promise<void>;
    readonly apply: (change: OrdinaryBaselineChange) => Promise<void>;
    readonly directory: string;
    readonly checkDirectory: (directory: string) => Promise<void>;
};
export function createBaselinePublication(
    input: PublicationInput
): (changes: readonly OrdinaryBaselineChange[]) => Promise<BaselineStoreCommit> {
    async function publishValidated(changes: readonly OrdinaryBaselineChange[]): Promise<BaselineStoreCommit> {
        const written: OrdinaryBaselineChange[] = [];
        for (const change of changes) {
            try {
                await input.apply(change);
                written.push(change);
            } catch (error: unknown) {
                return { outcome: { kind: 'failed', writtenChanges: written }, errors: [ error ] };
            }
        }
        return { outcome: { kind: 'written', changes: written }, errors: [] };
    }
    async function validateAndPublish(changes: readonly OrdinaryBaselineChange[]): Promise<BaselineStoreCommit> {
        try {
            await input.validate(changes);
            return await publishValidated(changes);
        } catch (error: unknown) {
            return { outcome: { kind: 'blocked' }, errors: [ error ] };
        }
    }
    async function releasePublication(
        release: () => Promise<void>,
        committed: BaselineStoreCommit
    ): Promise<BaselineStoreCommit> {
        try {
            await release();
            return committed;
        } catch (error: unknown) {
            const outcome = committed.outcome.kind === 'written'
                ? { kind: 'failed' as const, writtenChanges: committed.outcome.changes }
                : committed.outcome;
            return { outcome, errors: [ ...committed.errors, error ] };
        }
    }
    return async function publish(changes: readonly OrdinaryBaselineChange[]): Promise<BaselineStoreCommit> {
        if (changes.length === 0) {
            return { outcome: { kind: 'written', changes: [] }, errors: [] };
        }
        await input.checkDirectory(input.directory);
        await mkdir(input.directory, { recursive: true });
        await input.checkDirectory(input.directory);
        const release = await properLockfile.lock(input.directory, { realpath: false });
        const committed = await validateAndPublish(changes);
        return await releasePublication(release, committed);
    };
}
