import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const packageVersionSchema = z.object({ name: z.string(), version: z.string() });
export type PackageVersion = Readonly<z.infer<typeof packageVersionSchema>>;
type PackageMetadata = PackageVersion & { readonly directory: string; };

async function parsePackageMetadata(directory: string): Promise<PackageMetadata | null> {
    const contents = await readFile(path.join(directory, 'package.json'), 'utf8');
    const parsed = packageVersionSchema.safeParse(JSON.parse(contents));
    return parsed.success ? { ...parsed.data, directory } : null;
}

async function readPackageMetadata(directory: string): Promise<PackageMetadata | null> {
    try {
        return await parsePackageMetadata(directory);
    } catch (error: unknown) {
        if (
            error instanceof Error && Reflect.get(error, 'code') === 'ENOENT' && path.dirname(directory) !== directory
        ) {
            return await readPackageMetadata(path.dirname(directory));
        }
        return null;
    }
}

export async function packageMetadata(moduleUrl: string): Promise<PackageMetadata | null> {
    try {
        return await readPackageMetadata(path.dirname(fileURLToPath(moduleUrl)));
    } catch {
        return null;
    }
}

export async function packageVersion(moduleUrl: string): Promise<PackageVersion | null> {
    const metadata = await packageMetadata(moduleUrl);
    return metadata === null ? null : { name: metadata.name, version: metadata.version };
}
