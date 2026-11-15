import { profileFamilyId, type ProfileConfig } from '../config/types.ts';
import { recordedReplayFiles } from './replay-files.ts';
import type {
    RunCommand,
    RunCollectionSource,
    RunCollectionRoot
} from './run-types.ts';
import type { RunDiscovery } from './run-discovery-types.ts';
import { currentReplayWire } from './replay-wire.ts';

export type CollectionSource = RunCollectionSource;
export type DirectEntrypointCollectionSource = Extract<RunCollectionSource, { readonly kind: 'direct-entrypoint'; }>;

export const configuredFilesRunCollectionSource: Extract<RunCollectionSource, { readonly kind: 'configured-files'; }> =
    Object.freeze({
        kind: 'configured-files'
    });

function runCollectionRoot(source: RunCollectionSource, cwd: string): RunCollectionRoot {
    return source.kind === 'direct-entrypoint'
        ? source.root
        : { annotations: {}, controls: {}, title: cwd };
}

type CollectionContext = {
    readonly testFamily: string;
    readonly root: RunCollectionRoot;
    readonly replay: ReturnType<typeof currentReplayWire>;
};
export function runCollectionContext(
    source: CollectionSource,
    cwd: string,
    profile: ProfileConfig
): CollectionContext {
    return {
        testFamily: profileFamilyId(profile),
        root: runCollectionRoot(source, cwd),
        replay: source.kind === 'replay' ? source.replay : null
    };
}

export function selectedRunCollectionSource(): CollectionSource {
    const replay = currentReplayWire();
    return replay === null ? configuredFilesRunCollectionSource : { kind: 'replay', replay };
}

export async function readCollectionFiles(
    command: RunCommand,
    profile: ProfileConfig,
    dependencies: Pick<RunDiscovery, 'discoverRunFilesWithProjectRoot'>,
    source: CollectionSource
): ReturnType<RunDiscovery['discoverRunFilesWithProjectRoot']> {
    if (source.kind === 'frozen-policy') {
        return { files: source.policy.files, projectRoot: source.policy.projectRoot };
    }
    const saved = await recordedReplayFiles(command.cwd);
    return saved ?? await dependencies.discoverRunFilesWithProjectRoot({
        cwd: command.cwd,
        paths: command.request.paths,
        profileFiles: profile.files
    });
}
