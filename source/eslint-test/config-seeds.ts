import type { ConfigFixture, ConfigInput, ConfigProject } from './config-definition.ts';
import { inConfigProject, projectText } from './config-project.ts';

export type ConfigTrial = {
    readonly kind: 'fixture';
    readonly fixture: string;
} | { readonly kind: 'generated'; readonly candidates: readonly ConfigInput[]; };
export type ConfigSeeds = {
    readonly project: ConfigProject;
    readonly sources: readonly Pick<ConfigFixture<string>, 'source' | 'title'>[];
};
export async function trialCandidates(
    trial: ConfigTrial,
    seeds: ConfigSeeds,
    signal: AbortSignal
): Promise<readonly ConfigInput[]> {
    if (trial.kind === 'generated') {
        return trial.candidates;
    }
    const seed = seeds.sources.find(function matches(entry) {
        return entry.title === trial.fixture;
    });
    if (seed === undefined) {
        throw new TypeError('The replayed fixture no longer exists.');
    }
    const { source } = seed;
    const code = source.kind === 'inline'
        ? source.code
        : await inConfigProject(seeds.project, signal, async function read(context) {
            return await projectText(context, source.filename);
        });
    return [ { filename: source.filename, code, files: {} } ];
}
