import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFacade, type AuthoringControls, type TestFacade, type TestScope } from '@overkill-dev/test';
import { defineResource } from '@overkill-dev/test/resources';
import { packageSmokeDirectory, packageSmokeNodeModules } from './packaged-module.ts';

type BoundConsumerScope<Fixture> = TestScope & {
    readonly resources: { readonly consumer: Fixture; };
};
export type ConsumerScope<Facade> = Facade extends TestFacade<AuthoringControls, infer Scope> ? Scope : never;

export function packageConsumer<Fixture extends Readonly<Record<string, unknown>>>(
    name: string,
    createFixture: (directory: string) => Fixture
): TestFacade<AuthoringControls, BoundConsumerScope<Fixture>> {
    const directory = defineResource({
        name: `${name} workspace`,
        scope: 'per-case',
        requirements: [],
        async acquire() {
            const parent = join(packageSmokeDirectory, 'consumers');
            await mkdir(parent, { recursive: true });
            const workspace = await mkdtemp(join(parent, 'consumer-'));
            try {
                await symlink(packageSmokeNodeModules, join(workspace, 'node_modules'), 'dir');
                return workspace;
            } catch (error) {
                await rm(workspace, { recursive: true, force: true });
                throw error;
            }
        },
        async dispose(workspace) {
            await rm(workspace, { recursive: true, force: true });
        }
    });
    const consumer = defineResource({
        name: `${name} consumer`,
        scope: 'per-case',
        requirements: [],
        dependencies: { directory },
        acquire(context) {
            return createFixture(context.dependencies.directory);
        },
        dispose: null
    });
    return createTestFacade({ resources: { consumer } });
}
