import { loadConfig } from '../packages/run/config.entry-point.ts';
import type { BoundFamilySettings } from '../engine/test-family.ts';
import { resolveFrozenFamily } from './family-resolution.ts';
import type { FrozenFamilyDefinition } from './family-catalog.ts';

export async function loadFrozenFamily(input: FrozenFamilyDefinition, cwd: string): Promise<BoundFamilySettings> {
    return await resolveFrozenFamily(input, input.processModel, {
        async loadConfig(configPath) {
            return await loadConfig({ cwd, configPath });
        },
        async importModule(moduleUrl) {
            const namespace: unknown = await import(moduleUrl);
            return namespace;
        }
    });
}
