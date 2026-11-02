import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import type { NormalizedConfig } from '../config/types.ts';
import { normalizeConfig } from '../config/config.ts';
import { completedHistoryRecord } from '../test-support/history-record-fixture.ts';
import { createHistory } from './history.ts';
import { createReplayCommand } from './replay-command.ts';

const success = { exitCode: 0, runResult: null, stdoutLines: [], fallbackDiagnostics: [] } as const;
function unexpected(): never {
    throw new Error('Unexpected operation.');
}
type ReplayConfig = NormalizedConfig & { readonly configPath: null; };
async function prepareRecords(root: string, config: ReplayConfig): Promise<void> {
    const runs = path.join(root, '.overkill/runs');
    await mkdir(runs, { recursive: true });
    const now = new Date();
    for (const id of [ 'complete', 'interrupted', 'unresolved' ]) {
        await writeFile(
            path.join(runs, `${id}.json`),
            JSON.stringify({
                ...completedHistoryRecord(id),
                startedAt: now.toISOString(),
                status: id === 'complete' ? 'completed' : 'interrupted',
                facts: id === 'unresolved' ? null : completedHistoryRecord(id).facts
            })
        );
    }
    await createHistory({ projectRoot: root, config }).compact();
}
async function assertEmptyHistory(scope: TestScope, root: string, config: ReplayConfig): Promise<void> {
    await createHistory({ projectRoot: root, config }).clear({ confirmed: true });
    await createHistory({ projectRoot: root, config }).compact();
    const command = createReplayCommand({
        async loadConfig() {
            return config;
        },
        isTerminal() {
            return true;
        },
        pickRun: unexpected,
        replayRecordedRun: unexpected
    });
    const empty = await command({ cwd: root, configPath: null, arguments: [] });
    scope.assert.equal(empty.exitCode, 3);
}

async function assertReplaySelection(scope: TestScope, root: string, config: ReplayConfig): Promise<void> {
    let handoffs = 0;
    let cancel = false;
    const command = createReplayCommand({
        async loadConfig() {
            return config;
        },
        isTerminal() {
            return true;
        },
        async pickRun(choices) {
            scope.assert.deepEqual(
                choices.map(function id(run) {
                    return run.id;
                }),
                [ 'complete', 'interrupted' ]
            );
            scope.assert.equal(choices[1]?.replay, 'available-interrupted');
            return cancel ? null : 'interrupted';
        },
        async replayRecordedRun(context) {
            handoffs += 1;
            scope.assert.deepEqual(context, { cwd: root, configPath: null, arguments: [ 'interrupted' ] });
            return success;
        }
    });
    const request = { cwd: root, configPath: null, arguments: [] };
    scope.assert.deepEqual(await command(request), success);
    cancel = true;
    scope.assert.deepEqual(await command(request), success);
    scope.assert.equal(handoffs, 1);
    await assertEmptyHistory(scope, root, config);
}

async function inRecordedProject(operation: (root: string, config: ReplayConfig) => Promise<void>): Promise<void> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'overkill-replay-'));
    const config: ReplayConfig = { ...normalizeConfig({}), configPath: null };
    try {
        await prepareRecords(root, config);
        await operation(root, config);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

export const testNode = suite('replay selection', [
    test('nonterminal invocation rejects before config or selection', async function (scope: TestScope) {
        const command = createReplayCommand({
            loadConfig: unexpected,
            isTerminal() {
                return false;
            },
            pickRun: unexpected,
            replayRecordedRun: unexpected
        });
        const result = await command({ cwd: process.cwd(), configPath: null, arguments: [] });
        scope.assert.equal(result.exitCode, 3);
        scope.assert.includes(result.fallbackDiagnostics.join(''), 'overkill history list');
        return scope.assert.collect();
    }),
    test('explicit ids bypass terminal and history and preserve context', async function (scope: TestScope) {
        const request = { cwd: process.cwd(), configPath: 'custom.ts', arguments: [ 'chosen' ] };
        let calls = 0;
        const command = createReplayCommand({
            loadConfig: unexpected,
            isTerminal: unexpected,
            pickRun: unexpected,
            async replayRecordedRun(context) {
                calls += 1;
                scope.assert.deepEqual(context, request);
                return success;
            }
        });
        scope.assert.deepEqual(await command(request), success);
        scope.assert.equal(calls, 1);
        const invalid = await command({ ...request, arguments: [ 'a', 'b' ] });
        scope.assert.equal(invalid.exitCode, 3);
        return scope.assert.collect();
    }),
    test('filters unavailable runs, preserves order, and hands off or cancels', async function (scope: TestScope) {
        await inRecordedProject(async function (root, config) {
            await assertReplaySelection(scope, root, config);
        });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
