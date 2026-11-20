import { type TestNode, table, suite, test } from '@overkill-dev/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { frozenMicrotestPolicy } from '../test-support/frozen-microtest-policy.ts';

import { validateFrozenPolicyOrigins } from './frozen-policy-origins.ts';

export const testNode: TestNode = suite('frozen policy origin boundaries', [
    table({
        title: 'rejects inconsistent policy descriptors',
        cases: [ { field: 'file', value: '../escape.ts' }, { field: 'file', value: './unnormalized.ts' }, {
            field: 'path',
            value: '/outside/case.ts'
        }, { field: 'href', value: 'file:///outside/case.ts' } ] as const,
        caseTitle(scenario) {
            return `${scenario.field}, ${scenario.value}`;
        },
        async test(scope) {
            const scenario = scope.parameters;

            const policy = await frozenMicrotestPolicy();
            const file = { ...policy.files[0], [scenario.field]: scenario.value };
            scope.assert.throws(function () {
                validateFrozenPolicyOrigins({ ...policy, files: [ file ] });
            }, { message: `Invalid frozen discovery descriptor: ${file.file}` });
            return scope.assert.collect();
        }
    }),
    test('rejects duplicate discovery descriptors', async function (scope) {
        const policy = await frozenMicrotestPolicy();
        scope.assert.throws(function () {
            validateFrozenPolicyOrigins({ ...policy, files: [ policy.files[0], policy.files[0] ] });
        }, { message: `Duplicate frozen discovery descriptor: ${policy.files[0].file}` });
        return scope.assert.collect();
    }),
    table({
        title: 'rejects inconsistent configuration roots',
        cases: [ { cwd: 'relative', resolvedPath: null, configPath: null }, {
            cwd: '/elsewhere',
            resolvedPath: '/project/config.ts',
            configPath: null
        }, { cwd: '/project', resolvedPath: 'relative.ts', configPath: null } ] as const,
        caseTitle(source) {
            return `${source.cwd}, ${source.resolvedPath}`;
        },
        async test(scope) {
            const source = scope.parameters;

            const policy = await frozenMicrotestPolicy();
            scope.assert.throws(function () {
                validateFrozenPolicyOrigins({
                    ...policy,
                    source: {
                        kind: 'config-file',
                        request: { cwd: source.cwd, configPath: source.configPath },
                        resolvedPath: source.resolvedPath
                    }
                });
            }, { message: 'Frozen policy requires consistent absolute config roots.' });
            return scope.assert.collect();
        }
    }),
    test(
        'accepts resolved configuration identity and rejects a conflicting request',
        async function (scope) {
            const policy = await frozenMicrotestPolicy();
            const source = {
                kind: 'config-file',
                request: { cwd: '/project', configPath: 'config.ts' },
                resolvedPath: '/project/config.ts'
            } as const;
            validateFrozenPolicyOrigins({ ...policy, source });
            scope.assert.throws(function () {
                validateFrozenPolicyOrigins({
                    ...policy,
                    source: { ...source, resolvedPath: '/project/different.ts' }
                });
            }, { message: 'Frozen config identity conflicts with its load request.' });
            return scope.assert.collect();
        }
    ),
    test('requires an absolute working directory', async function (scope) {
        const policy = await frozenMicrotestPolicy();
        scope.assert.throws(function () {
            validateFrozenPolicyOrigins({ ...policy, cwd: 'relative' });
        }, { message: 'Frozen policy requires absolute project roots.' });
        return scope.assert.collect();
    }),
    test(
        'requires an absolute project root even when descriptors resolve consistently',
        async function (scope) {
            const policy = await frozenMicrotestPolicy();
            const original = policy.files[0];
            const path = resolve('relative', original.file);
            scope.assert.throws(function () {
                validateFrozenPolicyOrigins({
                    ...policy,
                    projectRoot: 'relative',
                    files: [ { ...original, path, href: pathToFileURL(path).href } ]
                });
            }, { message: 'Frozen policy requires absolute project roots.' });
            return scope.assert.collect();
        }
    ),
    test('rejects module boundaries for a different project', async function (scope) {
        const policy = await frozenMicrotestPolicy();
        validateFrozenPolicyOrigins({
            ...policy,
            moduleBoundary: { projectRoot: policy.projectRoot, sharedRoots: [] }
        });
        scope.assert.throws(function () {
            validateFrozenPolicyOrigins({ ...policy, moduleBoundary: { projectRoot: '/different', sharedRoots: [] } });
        }, { message: 'Module boundary conflicts with frozen project root.' });
        return scope.assert.collect();
    }),
    table({
        title: 'rejects invalid frozen file-set ownership',
        cases: [ null, 'missing' ] as const,
        caseTitle(fileSet) {
            return `rejects invalid frozen file-set ownership ${fileSet}`;
        },
        async test(scope) {
            const fileSet = scope.parameters;

            const policy = await frozenMicrotestPolicy();
            const profile = {
                ...policy.profile,
                files: { sets: { known: { include: [ 'source/**/*.ts' ] as const, exclude: [] } } }
            };
            validateFrozenPolicyOrigins({ ...policy, profile, files: [ { ...policy.files[0], fileSet: 'known' } ] });
            scope.assert.throws(function () {
                validateFrozenPolicyOrigins({ ...policy, profile, files: [ { ...policy.files[0], fileSet } ] });
            }, { message: `Invalid frozen file-set ownership: ${policy.files[0].file}` });
            return scope.assert.collect();
        }
    }),
    test('rejects file-set claims when the profile has no named sets', async function (scope) {
        const policy = await frozenMicrotestPolicy();
        scope.assert.throws(function () {
            validateFrozenPolicyOrigins({ ...policy, files: [ { ...policy.files[0], fileSet: 'unknown' } ] });
        }, { message: `Invalid frozen file-set ownership: ${policy.files[0].file}` });
        return scope.assert.collect();
    })
]);
