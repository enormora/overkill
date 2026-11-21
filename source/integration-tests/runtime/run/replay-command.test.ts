import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { suite, test } from '@overkill-dev/test';

import type { NormalizedConfig } from '../../../config/types.ts';
import { normalizeConfig } from '../../../config/config.ts';
import { completedHistoryRecord } from '../../../test-support/history-record-fixture.ts';
import { createHistory } from '../../../run/history.ts';
import { createReplayCommand } from '../../../run/replay-command.ts';

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
const assertEmptyHistory = defineCompositeAssertion({
    name: 'empty history',
    async assert(check, root: string, config: ReplayConfig) {
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
        return check.group([ check.equal(empty.exitCode, 3) ]);
    }
});

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
    test('nonterminal invocation rejects before config or selection', async function (scope) {
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
    test('explicit ids bypass terminal and history and preserve context', async function (scope) {
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
    test('filters unavailable runs, preserves order, and hands off or cancels', async function (scope) {
        await inRecordedProject(async function (root, config) {
            let replaySelectionHandoffs = 0;
            let replaySelectionCancel = false;
            const replaySelectionCommand = createReplayCommand({
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
                    return replaySelectionCancel ? null : 'interrupted';
                },
                async replayRecordedRun(context) {
                    replaySelectionHandoffs += 1;
                    scope.assert.deepEqual(context, { cwd: root, configPath: null, arguments: [ 'interrupted' ] });
                    return success;
                }
            });
            const replaySelectionRequest = { cwd: root, configPath: null, arguments: [] };
            scope.assert.deepEqual(await replaySelectionCommand(replaySelectionRequest), success);
            replaySelectionCancel = true;
            scope.assert.deepEqual(await replaySelectionCommand(replaySelectionRequest), success);
            scope.assert.equal(replaySelectionHandoffs, 1);
            await scope.assert(assertEmptyHistory, root, config);
        });
        return scope.assert.collect();
    })
]);
