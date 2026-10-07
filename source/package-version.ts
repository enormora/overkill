import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const packageVersionSchema = z.object({ name: z.string(), version: z.string() });
export type PackageVersion = Readonly<z.infer<typeof packageVersionSchema>>;

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

export async function packageVersion(moduleUrl: string): Promise<PackageVersion | null> {
    try {
        return await readPackageVersion(path.dirname(fileURLToPath(moduleUrl)));
    } catch {
        return null;
    }
}
