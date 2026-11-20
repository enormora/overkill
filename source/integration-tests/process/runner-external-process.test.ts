import { table, type TestNode, type TestScope, suite } from '@overkill-dev/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizeConfig, orchestrator, type RunCommand } from '../../packages/run/run.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { assertCompletedBenchmarks } from './support/process-evidence-assertions.ts';

const fixture = 'source/integration-tests/integration/fixtures/external-process.bench.test.ts';
const boundaries = [ 'reuse', 'fresh-worker-per-unit', 'supervised-process' ] as const;
type Boundary = typeof boundaries[number];

async function commandFor(scope: TestScope, boundary: Boundary): Promise<RunCommand> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-external-'));
    scope.cleanup(async function removeState() {
        await rm(directory, { recursive: true, force: true });
    });
    return {
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'commands' }),
        config: normalizeConfig({
            runtimeStateDir: directory,
            profiles: {
                commands: {
                    testFamily: 'benchmark',
                    files: { include: [ fixture ] },
                    timeouts: { collectionMilliseconds: 30_000 },
                    execution: boundary === 'supervised-process'
                        ? { processModel: 'supervised-process' }
                        : { processModel: 'worker-pool', workerLifecycle: boundary }
                }
            }
        })
    };
}

export const testNode: TestNode = suite(
    'runner external-process benchmarks',
    [ table({
        title: 'runs pipe and PTY samples',
        cases: boundaries,
        caseTitle(boundary) {
            return `runs pipe and PTY samples with ${boundary}`;
        },
        async test(scope) {
            const boundary = scope.parameters;

            const command = await commandFor(scope, boundary);
            const listed = await orchestrator.bench.list(command, { timing: null });
            scope.assert.equal(listed.facts.cases.length, 2);
            const result = await orchestrator.bench.run(command, { timing: null });
            assertCompletedBenchmarks(scope, result);
            return scope.assert.collect();
        }
    }) ]
);
