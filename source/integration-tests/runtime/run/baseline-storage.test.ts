import { mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type TestScope, table, suite, test } from '@overkill-dev/test';

import type { IntegrationProfileConfig } from '../../../config/types.ts';
import {
    createOrdinaryBaselineFixture,
    type OrdinaryBaselineFixture
} from '../../../test-support/ordinary-baseline-fixture.ts';
import { storedBaseline } from '../../../test-support/baseline-case-fixture.ts';
import { createOrdinaryBaselineStore, type OrdinaryBaselineStore } from '../../../run/baseline-store.ts';
import { createBaselineCommands } from '../../../run/baseline-commands.ts';
import { orchestrator } from '../../../run/run-orchestrator.entry-point.ts';

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
async function storedFixture(cleanup: TestScope['cleanup']): Promise<StoredFixture> {
    const data = await createOrdinaryBaselineFixture(cleanup, 'in-process', 'text');
    const store = await createOrdinaryBaselineStore({
        directory: data.directory,
        projectRoot: process.cwd(),
        maxBytes: 1024
    });
    await store.apply({ kind: 'create', baseline: storedBaseline });
    const [ entry ] = await store.list();
    if (entry === undefined) {
        throw new Error('Expected fixture entry.');
    }
    return { data, store, file: entry.path };
}
export const testNode = suite('ordinary baseline file validation', [
    test('includes fileless records only in unfiltered inventories', async function (scope) {
        const fixture = await storedFixture(scope.cleanup);
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
    test('uses integration attachment limits for listing and preparation', async function (scope) {
        const data = await createOrdinaryBaselineFixture(scope.cleanup, 'worker-pool', 'text');
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
        }, { message: /^Invalid baseline file: [a-f0-9]{64}\.baseline\.json$/u });
        return scope.assert.collect();
    }),
    test('rejects baseline directories outside the project root', async function (scope) {
        await scope.assert.rejects(async function () {
            return await createOrdinaryBaselineStore({
                directory: path.resolve('..'),
                projectRoot: process.cwd(),
                maxBytes: 1024
            });
        }, { message: 'Baseline directory must remain inside the project root.' });
        return scope.assert.collect();
    }),
    test('rejects records whose contents do not match their filename', async function (scope) {
        const fixture = await storedFixture(scope.cleanup);
        await writeFile(fixture.file, JSON.stringify({ ...storedBaseline, adapter: 'other' }));
        await scope.assert.rejects(async function () {
            return await fixture.store.list();
        }, { message: 'Baseline path does not match its identity.' });
        return scope.assert.collect();
    }),
    table({
        title: 'rejects invalid stored records',
        cases: [
            { kind: 'malformed JSON', content: '{' },
            { kind: 'oversized', content: 'x'.repeat(2048) },
            { kind: 'unsupported version', content: JSON.stringify({ ...storedBaseline, version: 2 }) }
        ] as const,
        caseTitle({ kind }) {
            return kind;
        },
        async test(scope) {
            const fixture = await storedFixture(scope.cleanup);
            const matchers = {
                'malformed JSON': { type: SyntaxError },
                oversized: { message: `Invalid baseline file: ${path.basename(fixture.file)}` },
                'unsupported version': { message: /"path":\s*\[\s*"version"\s*\]/u }
            } as const;
            await writeFile(fixture.file, scope.parameters.content);
            await scope.assert.rejects(async function readInvalidBaseline() {
                return await fixture.store.list();
            }, matchers[scope.parameters.kind]);
            return scope.assert.collect();
        }
    }),
    test('rejects symbolic links in place of baseline records', async function (scope) {
        const fixture = await storedFixture(scope.cleanup);
        const target = path.resolve(fixture.data.directory, 'payload.json');
        await writeFile(target, JSON.stringify(storedBaseline));
        await unlink(fixture.file);
        await symlink(target, fixture.file);
        await scope.assert.rejects(async function () {
            return await fixture.store.list();
        }, { message: `Invalid baseline file: ${path.basename(fixture.file)}` });
        return scope.assert.collect();
    }),
    test(
        'rejects linked directories even when their target remains inside the project',
        async function (scope) {
            const fixture = await storedFixture(scope.cleanup);
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
    test('blocks all writes when a later proposal exceeds the byte limit', async function (scope) {
        const fixture = await storedFixture(scope.cleanup);
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
    test('reports corrupt storage through list and executing commands', async function (scope) {
        const fixture = await storedFixture(scope.cleanup);
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
