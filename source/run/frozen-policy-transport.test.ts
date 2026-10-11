import { resolve } from 'node:path';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { normalizeConfig } from '../packages/run/config.entry-point.ts';
import {
    orchestrator,
    parseFrozenMicrotestPolicy,
    type FrozenMicrotestPolicy
} from '../packages/run/run.entry-point.ts';
import { createMutationRunCommand } from '../packages/stryker-runner/mutation-execution-policy.ts';
import { policyBaselineCommand } from './frozen-run-policy.ts';
import { createSupervisedCollectCommand } from './run-isolated-command.ts';
import { frozenSupervisedCommandSchema } from './frozen-supervised-command-schema.ts';

const file = 'source/integration-tests/run/fixtures/throws-on-import.test.ts';

async function freezePolicy(): Promise<FrozenMicrotestPolicy> {
    return await orchestrator.freezePolicy({
        command: createMutationRunCommand({
            cwd: process.cwd(),
            profile: 'unit',
            config: normalizeConfig({ profiles: { unit: { testFamily: 'microtest', files: { include: [ file ] } } } })
        }),
        source: { kind: 'memory' }
    });
}

export const testNode = suite('frozen policy transport', [
    test('validates config identity and absolute roots', async function (scope) {
        const policy = await freezePolicy();
        const configPath = resolve(policy.cwd, 'overkill.config.js');
        const source = {
            kind: 'config-file',
            request: { cwd: policy.cwd, configPath: 'overkill.config.js' },
            resolvedPath: configPath
        } as const;
        scope.assert.deepEqual(parseFrozenMicrotestPolicy({ ...policy, source }).source, source);
        scope.assert.deepEqual(
            parseFrozenMicrotestPolicy({
                ...policy,
                source: { ...source, request: { ...source.request, configPath: null }, resolvedPath: null }
            })
                .source,
            { kind: 'config-file', request: { cwd: policy.cwd, configPath: null }, resolvedPath: null }
        );
        for (
            const invalidSource of [
                { ...source, request: { ...source.request, cwd: 'relative' } },
                { ...source, request: { ...source.request, cwd: resolve(policy.cwd, 'other') } },
                { ...source, resolvedPath: 'relative' },
                { ...source, resolvedPath: resolve(policy.cwd, 'other.config.js') }
            ]
        ) {
            scope.assert.throws(function rejectConfigIdentity() {
                parseFrozenMicrotestPolicy({ ...policy, source: invalidSource });
            }, { type: Error });
        }
        scope.assert.throws(function rejectRelativeWorkingDirectory() {
            parseFrozenMicrotestPolicy({ ...policy, cwd: 'relative' });
        }, { message: /absolute project roots/ });
        scope.assert.throws(function rejectRelativeProjectRoot() {
            parseFrozenMicrotestPolicy({ ...policy, projectRoot: '.' });
        }, { message: /absolute project roots/ });
        return scope.assert.collect();
    }),
    test('requires named file ownership when discovery uses sets', async function (scope) {
        const policy = await freezePolicy();
        const [ descriptor ] = policy.files;
        const profile = { ...policy.profile, files: { sets: { unit: { include: [ file ], exclude: [] } } } };
        const named = parseFrozenMicrotestPolicy({
            ...policy,
            profile,
            files: [ { ...descriptor, fileSet: 'unit' } ]
        });
        scope.assert.equal(named.files[0].fileSet, 'unit');
        scope.assert.throws(function rejectUnownedFile() {
            parseFrozenMicrotestPolicy({ ...policy, profile });
        }, { message: /file-set ownership/ });
        scope.assert.throws(function rejectUnknownSet() {
            parseFrozenMicrotestPolicy({ ...policy, profile, files: [ { ...descriptor, fileSet: 'other' } ] });
        }, { message: /file-set ownership/ });
        scope.assert.equal(
            parseFrozenMicrotestPolicy({ ...policy, profile: { ...policy.profile, files: null } })
                .files[0]
                .fileSet,
            null
        );
        return scope.assert.collect();
    }),
    test('validates collection transport against frozen discovery', async function (scope) {
        const policy = await freezePolicy();
        const command = createSupervisedCollectCommand(
            policyBaselineCommand(policy),
            { ...policy.profile, reporters: null },
            policy.files,
            { kind: 'frozen-policy', policy }
        );
        const wire = JSON.stringify(command);
        const transported: unknown = JSON.parse(wire);
        scope.assert.deepEqual(frozenSupervisedCommandSchema.parse(transported), transported);
        scope.assert.throws(function rejectConflictingFiles() {
            frozenSupervisedCommandSchema.parse({ ...command, files: [] });
        }, { type: Error });
        return scope.assert.collect();
    })
]);

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
