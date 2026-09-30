import type { TestNode } from '../engine/test-node.ts';
import type { RunCollectionRoot } from './run-types.ts';

export type ConfiguredFilesRunCollectionSource = {
    readonly kind: 'configured-files';
};

export type DirectEntrypointRunCollectionSource = {
    readonly kind: 'direct-entrypoint';
    readonly root: RunCollectionRoot;
    readonly testNode: TestNode;
};

export type RunCollectionSource = ConfiguredFilesRunCollectionSource | DirectEntrypointRunCollectionSource;
