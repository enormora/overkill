import { createCoveragePathStorage, type CoveragePaths } from '../run/coverage-paths.ts';

export const coveragePaths: CoveragePaths = {
    projectRoot: '/project',
    coverageDirectory: '/project/coverage',
    rawDataDirectory: '/project/coverage/raw'
};
type CoveragePathOwnership = 'ancestor' | 'escape' | 'linked-ancestor' | 'linked-created' | 'pass';
export type CoveragePathScenario = CoveragePathOwnership | 'creation-error' | 'root-error';
const missing = Object.assign(new Error('Missing path.'), { code: 'ENOENT' });
type CoveragePathStorageFixture = {
    readonly create: () => Promise<CoveragePaths>;
    readonly calls: readonly string[];
    readonly failure: Error;
};
function coverageDirectoryTarget(scenario: CoveragePathScenario, created: boolean): string {
    if (scenario === 'ancestor' && !created) {
        throw missing;
    }
    if (scenario === 'linked-ancestor' || created && scenario === 'linked-created') {
        return '/outside';
    }
    return '/project/coverage';
}
export function coveragePathStorage(scenario: CoveragePathScenario): CoveragePathStorageFixture {
    const calls: string[] = [];
    const failure = new Error('Storage unavailable.');
    let created = false;
    const runtime = createCoveragePathStorage({
        async canonical(target) {
            calls.push(`canonical:${target}`);
            if (scenario === 'root-error') {
                throw failure;
            }
            return target === '/project/coverage' ? coverageDirectoryTarget(scenario, created) : target;
        },
        async createDirectory(target) {
            calls.push(`create:${target}`);
            if (scenario === 'creation-error') {
                throw failure;
            }
            created = true;
        }
    });
    return {
        calls,
        failure,
        async create() {
            return await runtime(
                scenario === 'escape' ? { ...coveragePaths, coverageDirectory: '/outside' } : coveragePaths
            );
        }
    };
}
