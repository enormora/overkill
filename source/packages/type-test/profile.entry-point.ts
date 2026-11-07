import type {
    ProjectProfileFiles,
    ProjectAdapterProfileConfig,
    RunAdapterRegistration
} from '../run/config.entry-point.ts';
import { typeTestSettingsSchema, type TypeTestOptions } from './profile-settings.ts';

export type { TypeTestOptions } from './profile-settings.ts';
export type TypeTestProfileOptions = TypeTestOptions & { readonly files: ProjectProfileFiles; };

export const typeTestAdapter: RunAdapterRegistration = Object.freeze({
    id: '@overkill-dev/type-test',
    validate(settings: unknown): void {
        typeTestSettingsSchema.parse(settings);
    },
    async load() {
        return await import('./adapter.entry-point.ts');
    }
});

export function typeTestProfile(options: TypeTestProfileOptions): ProjectAdapterProfileConfig {
    const { files, ...settings } = options;
    const parsed = typeTestSettingsSchema.parse(settings);
    return { testFamily: 'type-test', files, adapter: typeTestAdapter, settings: parsed };
}
