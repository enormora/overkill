import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { RunEngineSelection } from './run-request-types.ts';
import type { RunRecordVersions } from './run-record-types.ts';

const packageVersionSchema = z.object({ name: z.string(), version: z.string() });
type PackageVersion = Readonly<z.infer<typeof packageVersionSchema>>;

async function parsePackageVersion(manifestPath: string): Promise<PackageVersion | null> {
    const contents = await readFile(manifestPath, 'utf8');
    const parsed = packageVersionSchema.safeParse(JSON.parse(contents));
    return parsed.success ? parsed.data : null;
}

async function readPackageVersion(directory: string): Promise<PackageVersion | null> {
    const manifestPath = path.join(directory, 'package.json');
    try {
        return await parsePackageVersion(manifestPath);
    } catch (error: unknown) {
        if (
            error instanceof Error && Reflect.get(error, 'code') === 'ENOENT' && path.dirname(directory) !== directory
        ) {
            return await readPackageVersion(path.dirname(directory));
        }
        return null;
    }
}

async function packageVersion(moduleUrl: string): Promise<PackageVersion | null> {
    try {
        return await readPackageVersion(path.dirname(fileURLToPath(moduleUrl)));
    } catch {
        return null;
    }
}

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
