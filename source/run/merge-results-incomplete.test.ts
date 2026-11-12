import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { mergeResults } from '../packages/run/run.entry-point.ts';
import { defaultRunConfig } from '../test-support/run-command-factory.ts';
import { mergeRecordFixture } from '../test-support/merge-record-fixture.ts';
import { mergeResultsCommand } from './merge-results-command.ts';

export const testNode = createSuite({
    title: 'incomplete merge results',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        createTestCase({
            title: 'retains readable outcomes alongside every input failure',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(scope) {
                await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-merge-partial-'));
                await writeFile(join(directory.path, 'good.json'), JSON.stringify(mergeRecordFixture('good', 2, 3)));
                await writeFile(join(directory.path, 'broken.json'), '{');
                const merged = await mergeResults({
                    config: defaultRunConfig({}),
                    cwd: directory.path,
                    inputs: [ { kind: 'path', path: '.' }, { kind: 'path', path: 'absent.json' } ]
                });
                scope.assert.deepEqual({ status: merged.result.status, passed: merged.result.summary.passed }, {
                    status: 'failed',
                    passed: 3
                });
                scope.assert.deepEqual(
                    merged.lineage.map(function id(source) {
                        return source.id;
                    }),
                    [ 'good' ]
                );
                for (const fragment of [ 'broken.json', 'absent.json', 'Missing shard 1/2' ]) {
                    scope.assert.equal(
                        merged.result.runnerErrors.some(function matches(error) {
                            return error.subtype === 'merge' && error.message.includes(fragment);
                        }),
                        true
                    );
                }
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'rejects repeated empty shards while accepting complete empty coverage',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(scope) {
                await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-merge-empty-'));
                for (const [ name, index ] of [ [ 'first', 1 ], [ 'second', 2 ] ] as const) {
                    await writeFile(
                        join(directory.path, `${name}.json`),
                        JSON.stringify({
                            ...mergeRecordFixture(name, index, 0),
                            result: { ...mergeRecordFixture(name, index, 0).result, planStatus: 'empty-shard' }
                        })
                    );
                }
                const command = {
                    config: defaultRunConfig({}),
                    cwd: directory.path,
                    inputs: [ { kind: 'path', path: '.' } ]
                } as const;
                const complete = await mergeResults(command);
                scope.assert.equal(complete.result.status, 'passed');
                await writeFile(
                    join(directory.path, 'duplicate.json'),
                    JSON.stringify(mergeRecordFixture('duplicate', 1, 0))
                );
                const merged = await mergeResults(command);
                scope.assert.deepEqual({
                    status: merged.result.status,
                    duplicate: merged.result.runnerErrors.some(function duplicate(error) {
                        return error.message.includes('Duplicate shard 1');
                    })
                }, { status: 'failed', duplicate: true });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'gives merge errors priority over process exhaustion',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(scope) {
                await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-merge-exhausted-'));
                const record = mergeRecordFixture('exhausted', 1, 0);
                const exhausted = {
                    ...record,
                    result: { ...record.result, summary: { ...record.result.summary, processExhausted: 1 } }
                };
                await writeFile(join(directory.path, 'record.json'), JSON.stringify(exhausted));
                const result = await mergeResultsCommand(async function config() {
                    return { ...defaultRunConfig({}), configPath: null };
                }, { cwd: directory.path, configPath: null, paths: [ 'record.json' ] });
                scope.assert.equal(result.exitCode, 2);
                scope.assert.equal(result.runResult?.summary.processExhausted, 1);
                return scope.assert.collect();
            }
        })
    ]
});
await runIfMain(import.meta, testNode);
