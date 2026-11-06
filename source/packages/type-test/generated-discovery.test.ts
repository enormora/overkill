import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { createVirtualRunDiscovery } from '../../test-support/virtual-run-discovery.ts';

const generated = '.overkill-type-test-run-example.test.ts';
export const testNode = suite('generated input discovery', [
    test('excludes reserved siblings from broad and explicit dot patterns', async function (scope: TestScope) {
        const discovery = createVirtualRunDiscovery({
            cwd: '/project',
            directories: [],
            files: [ '/project/example.test.ts', `/project/${generated}` ],
            realpaths: {}
        });
        const files = await discovery.discoverRunFiles({
            cwd: '/project',
            paths: [],
            profileFiles: {
                include: [ '**/*.test.ts', generated ],
                exclude: []
            }
        });
        scope.assert.deepEqual(
            files.map(function name(file) {
                return file.file;
            }),
            [ 'example.test.ts' ]
        );
        return scope.assert.collect();
    }),
    test('rejects explicit reserved siblings', async function (scope: TestScope) {
        const discovery = createVirtualRunDiscovery({
            cwd: '/project',
            directories: [],
            files: [ `/project/${generated}` ],
            realpaths: {}
        });
        await scope.assert.rejects(async function explicit() {
            await discovery.discoverRunFiles({ cwd: '/project', paths: [ generated ], profileFiles: null });
        }, { message: 'Generated type-test input cannot be selected as a run file.' });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
