import { defineTestFamily } from '../engine/engine.entry-point.ts';
import { typeTestSettingsSchema } from './profile-settings.ts';

export type { CompilerPolicy, TypeTestSettings } from './profile-settings.ts';
export const family = defineTestFamily({
    id: '@overkill-dev/type-test',
    version: '1',
    module: { moduleUrl: import.meta.url, exportName: 'family' },
    features: { execution: 'analysis', processModels: [ 'in-process', 'supervised-process' ], profileOptions: [] },
    parseSettings(input) {
        return typeTestSettingsSchema.parse(input);
    },
    async load() {
        return await import('./family-backend.entry-point.ts');
    }
});
