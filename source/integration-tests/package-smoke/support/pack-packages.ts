import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { packAllPackages } from 'packtory';
import { z } from 'zod/v4';
import { sealConsumerDependencies } from './consumer-resolution-boundary.ts';
import { installConsumerTypes } from './consumer-types.ts';

const { configuration } = z.object({ configuration: z.unknown() }).parse(
    await import(pathToFileURL(resolve('packtory.config.js')).href)
);

const directory = resolve('target/package-smoke');
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const outcome = await packAllPackages(configuration, {
    outputPath: resolve(directory, 'node_modules'),
    version: '0.0.0',
    vendorDependencies: true
});
if (outcome.result.isErr) {
    throw new Error('Package smoke installation failed.', { cause: outcome.result.error });
}

await installConsumerTypes();
await sealConsumerDependencies(directory);

await writeFile(
    join(directory, 'resolver.mjs'),
    'export const resolvePackage = (specifier) => import.meta.resolve(specifier);\n'
);
