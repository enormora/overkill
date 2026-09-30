import type {
    ConfiguredFilesRunCollectionSource,
    RunCollectionSource
} from './run-collection-source-types.ts';
import type { RunCollectionRoot } from './run-types.ts';

export type CollectionSource = RunCollectionSource;
export type DirectEntrypointCollectionSource = Extract<RunCollectionSource, { readonly kind: 'direct-entrypoint'; }>;

export const configuredFilesRunCollectionSource: ConfiguredFilesRunCollectionSource = Object.freeze({
    kind: 'configured-files'
});

export function runCollectionRoot(source: RunCollectionSource, cwd: string): RunCollectionRoot {
    return source.kind === 'direct-entrypoint'
        ? source.root
        : { annotations: {}, controls: {}, title: cwd };
}
