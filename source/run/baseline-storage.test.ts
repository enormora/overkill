import { mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IntegrationProfileConfig } from '../config/types.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import {
    createOrdinaryBaselineFixture,
    type OrdinaryBaselineFixture
} from '../test-support/ordinary-baseline-fixture.ts';
import { storedBaseline } from '../test-support/baseline-case-fixture.ts';
import { createOrdinaryBaselineStore, type OrdinaryBaselineStore } from './baseline-store.ts';
import { createBaselineCommands } from './baseline-commands.ts';
import { orchestrator } from './run-orchestrator.entry-point.ts';

type StoredFixture = {
    readonly data: OrdinaryBaselineFixture;
    readonly store: OrdinaryBaselineStore;
    readonly file: string;
};
function integrationProfile(data: OrdinaryBaselineFixture): IntegrationProfileConfig {
    const profile = data.command.config.profiles.unit;
    if (profile?.testFamily !== 'integration') {
        throw new Error('Expected integration fixture.');
    }
    return profile;
}
async function storedFixture(scope: TestScope): Promise<StoredFixture> {
    const data = await createOrdinaryBaselineFixture(scope, 'in-process', 'text');
    const store = await createOrdinaryBaselineStore({
        directory: data.directory,
        projectRoot: process.cwd(),
        maxBytes: 1024
    });
    await store.apply({ kind: 'create', baseline: storedBaseline });
    const [ entry ] = await store.list();
    scope.require.defined(entry);
    return { data, store, file: entry.path };
}
export const testNode = suite('ordinary baseline file validation', [
    test('includes fileless records only in unfiltered inventories', async function (scope: TestScope) {
        const fixture = await storedFixture(scope);
        await fixture.store.apply({
            kind: 'create',
            baseline: {
                ...storedBaseline,
                work: { ...storedBaseline.work, case: { ...storedBaseline.work.case, file: null } }
            }
        });
        const all = await fixture.store.list();
        const selected = await orchestrator.baseline.list({
            ...fixture.data.command,
            request: { profile: 'unit', paths: [ 'output.test.ts' ] }
        });
        scope.assert.equal(all.length, 2);
        scope.assert.deepEqual(
            selected.map(function (entry) {
                return entry.baseline;
            }),
            [ storedBaseline ]
        );
        return scope.assert.collect();
    }),
    test('uses integration attachment limits for listing and preparation', async function (scope: TestScope) {
        const data = await createOrdinaryBaselineFixture(scope, 'worker-pool', 'text');
        const store = await data.store();
        await store.apply({ kind: 'create', baseline: storedBaseline });
        const profile = integrationProfile(data);
        const command = {
            ...data.command,
            config: {
                ...data.command.config,
                profiles: {
                    unit: {
                        ...profile,
                        attachments: { ...profile.attachments, maxArtifactBytes: 1 }
                    }
                }
            }
        };
        const executed = await orchestrator.baseline.update(command, { timing: null });
        scope.assert.deepEqual<unknown, unknown>([
            executed.result.status,
            executed.writeOutcome.kind,
            executed.result.runnerErrors[0]?.subtype
        ], [ 'failed', 'blocked', 'artifact' ]);
        await scope.assert.rejects(async function () {
            return await orchestrator.baseline.list({ ...command, request: { profile: 'unit', paths: [] } });
        }, { type: Error });
        return scope.assert.collect();
    }),
    test('rejects baseline directories outside the project root', async function (scope: TestScope) {
        await scope.assert.rejects(async function () {
            return await createOrdinaryBaselineStore({
                directory: path.resolve('..'),
                projectRoot: process.cwd(),
                maxBytes: 1024
            });
        }, { message: 'Baseline directory must remain inside the project root.' });
        return scope.assert.collect();
    }),
    test('rejects records whose contents do not match their filename', async function (scope: TestScope) {
        const fixture = await storedFixture(scope);
        await writeFile(fixture.file, JSON.stringify({ ...storedBaseline, adapter: 'other' }));
        await scope.assert.rejects(async function () {
            return await fixture.store.list();
        }, { message: 'Baseline path does not match its identity.' });
        return scope.assert.collect();
    }),
    test('rejects malformed JSON and oversized stored records', async function (scope: TestScope) {
        const fixture = await storedFixture(scope);
        for (const content of [ '{', 'x'.repeat(2048), JSON.stringify({ ...storedBaseline, version: 2 }) ]) {
            await writeFile(fixture.file, content);
            await scope.assert.rejects(async function () {
                return await fixture.store.list();
            }, { type: Error });
        }
        return scope.assert.collect();
    }),
    test('rejects symbolic links in place of baseline records', async function (scope: TestScope) {
        const fixture = await storedFixture(scope);
        const target = path.resolve(fixture.data.directory, 'payload.json');
        await writeFile(target, JSON.stringify(storedBaseline));
        await unlink(fixture.file);
        await symlink(target, fixture.file);
        await scope.assert.rejects(async function () {
            return await fixture.store.list();
        }, { type: Error });
        return scope.assert.collect();
    }),
    test(
        'rejects linked directories even when their target remains inside the project',
        async function (scope: TestScope) {
            const fixture = await storedFixture(scope);
            const target = path.resolve(fixture.data.directory, 'real');
            const directory = path.resolve(fixture.data.directory, 'linked');
            await mkdir(target);
            await symlink(target, directory);
            await scope.assert.rejects(async function () {
                return await createOrdinaryBaselineStore({ directory, projectRoot: process.cwd(), maxBytes: 1024 });
            }, { message: 'Baseline directories cannot be symbolic links.' });
            return scope.assert.collect();
        }
    ),
    test('blocks all writes when a later proposal exceeds the byte limit', async function (scope: TestScope) {
        const fixture = await storedFixture(scope);
        const result = await fixture.store.publish([ {
            kind: 'update',
            previous: storedBaseline,
            baseline: { ...storedBaseline, payload: { kind: 'text', text: '43' } }
        }, {
            kind: 'create',
            baseline: { ...storedBaseline, adapter: 'large', payload: { kind: 'text', text: 'x'.repeat(2048) } }
        } ]);
        scope.assert.equal(result.outcome.kind, 'blocked');
        scope.assert.equal(result.errors.length, 1);
        const entries = await fixture.store.list();
        scope.assert.deepEqual(
            entries.map(function (entry) {
                return entry.baseline;
            }),
            [ storedBaseline ]
        );
        return scope.assert.collect();
    }),
    test('reports corrupt storage through list and executing commands', async function (scope: TestScope) {
        const fixture = await storedFixture(scope);
        const commands = createBaselineCommands({
            async loadConfig() {
                return { ...fixture.data.command.config, configPath: null };
            },
            async createDefaultReporter() {
                throw new Error('Unexpected default reporter loading.');
            },
            orchestrator
        });
        await writeFile(fixture.file, '{');
        const listed = await commands.list({
            cwd: process.cwd(),
            configPath: null,
            listRequest: { profile: 'unit', paths: [] }
        });
        scope.assert.equal(listed.exitCode, 2);
        const executed = await commands.update({
            cwd: process.cwd(),
            configPath: null,
            runRequest: fixture.data.command.request
        });
        scope.assert.equal(executed.runResult?.runnerErrors[0]?.subtype, 'artifact');
        scope.assert.equal(executed.exitCode, 2);
        scope.assert.equal(await readFile(fixture.file, 'utf8'), '{');
        return scope.assert.collect();
    })
]);
