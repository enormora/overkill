import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { RunProfileFiles } from './run-types.ts';

export type RunDiscoveryRequest = {
    readonly cwd: string;
    readonly paths: readonly string[];
    readonly profileFiles: RunProfileFiles | null;
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

export type DiscoveredRunFile = {
    readonly file: string;
    readonly fileSet: string | null;
    readonly href: string;
    readonly path: string;
};

export type DiscoveredRunFiles = {
    readonly files: NonEmptyReadonlyArray<DiscoveredRunFile>;
    readonly projectRoot: string;
};

export type RunDiscovery = {
    readonly discoverRunFiles: (request: RunDiscoveryRequest) => Promise<NonEmptyReadonlyArray<DiscoveredRunFile>>;
    readonly discoverRunFilesWithProjectRoot: (request: RunDiscoveryRequest) => Promise<DiscoveredRunFiles>;
};
