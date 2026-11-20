import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { emptyConfigProject } from '../test-support/eslint-config.ts';
import { inConfigProject, configLayers, generatedProject, projectPath, validateProject } from './config-project.ts';

export const testNode = authoredSuite('configuration project and layer policy', [
    test('runs an existing project callback without creating a temporary project', async function (scope: TestScope) {
        const context = await inConfigProject(
            { kind: 'existing', root: '/project' },
            scope.signal,
            async function (value) {
                return value;
            }
        );
        scope.assert.equal(context.root, '/project');
        scope.assert.equal(context.signal, scope.signal);
        return scope.assert.collect();
    }),
    test('preserves existing project callback failures', async function (scope: TestScope) {
        const error = new Error('callback failed');
        await scope.assert.rejects(async function () {
            await inConfigProject({ kind: 'existing', root: '/project' }, scope.signal, async function () {
                throw error;
            });
        }, { exact: error });
        return scope.assert.collect();
    }),
    test('preserves array layers and awaits factories with their exact context', async function (scope: TestScope) {
        const context = { root: '/project', signal: scope.signal };
        const configs = [ { rules: { 'no-debugger': 'error' } } ] as const;
        scope.assert.equal(await configLayers(configs, context), configs);
        const layers = await configLayers(async function (value) {
            scope.assert.equal(value, context);
            return configs;
        }, context);
        scope.assert.equal(layers, configs);
        return scope.assert.collect();
    }),
    test('rejects cancelled projects and layer factories before invoking callbacks', async function (scope: TestScope) {
        const controller = new AbortController();
        const error = new Error('cancelled');
        controller.abort(error);
        await scope.assert.rejects(async function () {
            await inConfigProject({ kind: 'existing', root: '/project' }, controller.signal, async function () {
                throw new Error('must not run');
            });
        }, { exact: error });
        await scope.assert.rejects(async function () {
            await configLayers(function () {
                throw new Error('must not run');
            }, { root: '/project', signal: controller.signal });
        }, { exact: error });
        return scope.assert.collect();
    }),
    test(
        'merges generated support files and replaces the selected source without changing the template',
        function (scope: TestScope) {
            const project = { ...emptyConfigProject, files: { 'input.js': 'old', 'support.js': 'preserved' } };
            const generated = generatedProject(project, {
                filename: 'input.js',
                code: 'new',
                files: { 'other.js': 'support' }
            });
            scope.assert.deepEqual(generated.files, {
                'input.js': 'new',
                'support.js': 'preserved',
                'other.js': 'support'
            });
            scope.assert.deepEqual(project.files, { 'input.js': 'old', 'support.js': 'preserved' });
            return scope.assert.collect();
        }
    ),
    test('rejects generated file and directory conflicts', function (scope: TestScope) {
        scope.assert.throws(function () {
            generatedProject({ ...emptyConfigProject, files: { nested: 'file' } }, {
                filename: 'nested/input.js',
                code: 'source',
                files: {}
            });
        }, { message: 'Project files must not conflict with directories.' });
        scope.assert.throws(function () {
            generatedProject(emptyConfigProject, { filename: 'node_modules/input.js', code: 'source', files: {} });
        }, { message: 'Project file paths must be unique and must not declare node_modules.' });
        return scope.assert.collect();
    }),
    test('requires absolute dependency roots for virtual projects', function (scope: TestScope) {
        scope.assert.throws(function () {
            validateProject({ ...emptyConfigProject, dependencies: { kind: 'from-project', root: 'relative' } });
        }, { message: 'Dependency project roots must be absolute.' });
        scope.assert.equal(projectPath('/project', 'nested/../input.js'), '/project/input.js');
        return scope.assert.collect();
    })
]);
