import type {
    SandboxPaths,
    MutationSandboxInput,
    MutationSandbox
} from '../packages/stryker-runner/mutation-sandbox.ts';
import { parseRunnerOptions } from '../packages/stryker-runner/runner-settings-schema.ts';

export const sandboxSettings = parseRunnerOptions({ seed: '42' });
export const sandboxInput: MutationSandboxInput = {
    originalRoot: '/original',
    cwd: '/sandbox',
    fileDescriptions: { '/original/subject.ts': { mutate: true }, '/original/test.ts': { mutate: false } }
};
export const sandboxFixture: MutationSandbox = {
    originalRoot: '/original',
    root: '/sandbox',
    sharedRoots: [ '/dependencies' ],
    files: [ { file: 'subject.ts', mutationTarget: true }, { file: 'test.ts', mutationTarget: false } ]
};
export function sandboxPaths(
    roots: readonly string[],
    aliases: ReadonlyMap<string, string>,
    failure: Error | null
): SandboxPaths {
    return {
        async canonical(path) {
            if (failure !== null) {
                throw failure;
            }
            return aliases.get(path) ?? path;
        },
        moduleRoots() {
            return roots;
        }
    };
}
