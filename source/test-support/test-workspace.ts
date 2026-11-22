import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type ResourceDefinition, defineResource } from '@overkill-dev/test/resources';

export const testWorkspace: ResourceDefinition<
    'isolated test workspace',
    string,
    Readonly<Record<PropertyKey, never>>
> = defineResource({
    name: 'isolated test workspace',
    scope: 'per-case',
    requirements: [],
    async acquire() {
        const parent = resolve('target/test-workspaces');
        await mkdir(parent, { recursive: true });
        return await mkdtemp(join(parent, 'case-'));
    },
    async dispose(directory) {
        await rm(directory, { recursive: true, force: true });
    }
});
