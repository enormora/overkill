import { defineTestFamily } from '../engine/engine.entry-point.ts';
import type { ProjectProfileFiles, ProjectFamilyProfileConfig } from '../run/config.entry-point.ts';
import { typeTestSettingsSchema, type TypeTestOptions } from './profile-settings.ts';

export type { CompilerPolicy, TypeTestOptions } from './profile-settings.ts';
export type TypeTestProfileOptions = TypeTestOptions & { readonly files: ProjectProfileFiles; };
export const family = defineTestFamily({
    id: '@overkill-dev/type-test',
    version: '1',
    module: { moduleUrl: import.meta.url, exportName: 'family' },
    features: { execution: 'analysis', processModels: [ 'in-process' ], profileOptions: [] },
    parseSettings(input) {
        return typeTestSettingsSchema.parse(input);
    },
    async load() {
        return await import('./family-backend.entry-point.ts');
    }
});
export function typeTestProfile(options: TypeTestProfileOptions): ProjectFamilyProfileConfig<typeof family> {
    const { files, ...settings } = options;
    return { testFamily: family, files, settings: typeTestSettingsSchema.parse(settings) };
}
