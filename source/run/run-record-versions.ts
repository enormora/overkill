import { packageVersion, type PackageVersion } from '../package-version.ts';
import type { RunEngineSelection } from './run-request-types.ts';
import type { RunRecordVersions } from './run-record-types.ts';

async function coverageBackendVersion(): Promise<PackageVersion | null> {
    try {
        return await packageVersion(import.meta.resolve('monocart-coverage-reports'));
    } catch {
        return null;
    }
}

function packageEntries(metadata: PackageVersion | null): readonly [string, string][] {
    return metadata === null || metadata.name === 'overkill' ? [] : [ [ metadata.name, metadata.version ] ];
}

export async function runRecordVersions(engine: RunEngineSelection, node: string): Promise<RunRecordVersions> {
    const [ runner, backend, selectedEngine ] = await Promise.all([
        packageVersion(import.meta.url),
        coverageBackendVersion(),
        engine.kind === 'module' ? packageVersion(engine.moduleUrl) : Promise.resolve(null)
    ]);
    const packages = Object.fromEntries([ runner, backend, selectedEngine ].flatMap(packageEntries));

    return { engine: selectedEngine?.version ?? null, node, packages };
}
