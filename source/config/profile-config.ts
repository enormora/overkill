import type { Except } from 'type-fest';
import type { DefinedTestFamily, TestFamily } from '../engine/test-family.ts';
import type { ProjectDefinedFamilyProfile } from './schema.ts';
import type { Config, ProjectProfileConfig, ProjectProfilesConfig } from './config.ts';

export type FamilySettingsOf<Family> = Family extends TestFamily<infer Settings> ? Settings : never;
export type CommonFamilyProfileConfig = Except<ProjectDefinedFamilyProfile, 'settings' | 'testFamily'>;
export type ProjectFamilyProfileConfig<Family extends DefinedTestFamily> = CommonFamilyProfileConfig & {
    readonly testFamily: Family;
    readonly settings: NoInfer<FamilySettingsOf<Family>>;
};
export type CheckedProfiles<Profiles extends ProjectProfilesConfig> = {
    readonly [Name in keyof Profiles]: Profiles[Name]['testFamily'] extends DefinedTestFamily
        ? ProjectFamilyProfileConfig<Profiles[Name]['testFamily']>
        : Profiles[Name];
};

export type ConfigGlobals = Except<Config, 'profiles'>;
type BuiltinProfiles = Readonly<Record<string, Exclude<ProjectProfileConfig, ProjectDefinedFamilyProfile>>>;
export type BuiltinConfig = ConfigGlobals & { readonly profiles?: BuiltinProfiles; };

type DefineConfig = {
    <const Profiles extends ProjectProfilesConfig>(
        config: ConfigGlobals & { readonly profiles: CheckedProfiles<Profiles> & Profiles; }
    ): ConfigGlobals & { readonly profiles: Profiles; };
    (config: BuiltinConfig): Config;
};

export const defineConfig: DefineConfig = function <const Input extends Config>(config: Input): Input {
    return config;
};
