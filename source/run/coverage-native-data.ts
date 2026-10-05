import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { V8CoverageEntry } from 'monocart-coverage-reports';
import { z } from 'zod/v4';

const nativeDataSchema = z.object({
    result: z.array(z.looseObject({ url: z.string() })),
    'source-map-cache': z.record(z.string(), z.unknown()).default({})
});

export type CoverageNativeBatch = {
    readonly entries: readonly V8CoverageEntry[];
    readonly sourceMaps: Readonly<Record<string, unknown>>;
};

export async function readNativeCoverageBatches(directory: string): Promise<readonly CoverageNativeBatch[]> {
    const entries = await readdir(directory);
    const files = entries.filter(function isNativeCoverage(file) {
        return file.endsWith('.json') && !file.startsWith('source-');
    });

    return await Promise.all(files.map(async function readNativeCoverage(file) {
        const data = nativeDataSchema.parse(JSON.parse(await readFile(path.join(directory, file), 'utf8')));

        return { entries: data.result, sourceMaps: data['source-map-cache'] };
    }));
}
