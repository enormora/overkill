import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { ProfileFiles } from '../config/types.ts';
import type { DiscoveredRunFile, DiscoveredRunFiles } from './run-types.ts';

export type RunDiscoveryRequest = {
    readonly cwd: string;
    readonly paths: readonly string[];
    readonly profileFiles: ProfileFiles | null;
};

type RunDiscoveryGlobOptions = {
    readonly cwd: string;
    readonly exclude: readonly string[];
    readonly followSymlinks: boolean;
};

type RunDiscoveryPathStats = {
    readonly isDirectory: () => boolean;
    readonly isFile: () => boolean;
};

export type RunDiscoveryDependencies = {
    readonly glob: (
        pattern: string | readonly string[],
        options: RunDiscoveryGlobOptions
    ) => AsyncIterable<string>;
    readonly realpath: (filePath: string) => Promise<string>;
    readonly stat: (filePath: string) => Promise<RunDiscoveryPathStats>;
};

export type RunDiscovery = {
    readonly discoverRunFiles: (request: RunDiscoveryRequest) => Promise<NonEmptyReadonlyArray<DiscoveredRunFile>>;
    readonly discoverRunFilesWithProjectRoot: (request: RunDiscoveryRequest) => Promise<DiscoveredRunFiles>;
};
