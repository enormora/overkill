import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestScope } from '@overkill-dev/test';
import {
    orchestrator,
    normalizeConfig,
    type ProjectProfileConfig,
    type RunCommand
} from '../packages/run/run.entry-point.ts';
import type { RunResult } from '../packages/engine/engine.entry-point.ts';
import type { ReplayRunRecord } from '../run/replay-record-types.ts';

import { replayRecordSchema } from '../run/replay-record-schema.ts';
import { defaultRunRequest } from './run-command-factory.ts';

const replayAuthoringEntryPoint = new URL('../packages/test/test.entry-point.ts', import.meta.url);
const replayPropertyEntryPoint = new URL('../packages/test/property.entry-point.ts', import.meta.url);
const replayResourcesEntryPoint = new URL('../packages/resources/resources.entry-point.ts', import.meta.url);
export const replayAuthoringUrl = replayAuthoringEntryPoint.href;
export const replayPropertyUrl = replayPropertyEntryPoint.href;
export const replayResourcesUrl = replayResourcesEntryPoint.href;
const binary = fileURLToPath(new URL('../packages/test/overkill.entry-point.ts', import.meta.url));
export type ReplayProject = { readonly cwd: string; readonly command: RunCommand; };
export async function replayProject(
    cleanup: TestScope['cleanup'],
    profile: ProjectProfileConfig
): Promise<ReplayProject> {
    await mkdir('target', { recursive: true });
    const cwd = await mkdtemp(path.join(process.cwd(), 'target/replay-'));
    cleanup(async function removeProject() {
        await rm(cwd, { recursive: true, force: true });
    });
    const source = { profiles: { cases: profile } };
    await writeFile(path.join(cwd, 'overkill.config.ts'), `export const config = ${JSON.stringify(source)};`);
    return {
        cwd,
        command: {
            cwd,
            config: { ...normalizeConfig(source), reporters: [] },
            engine: { kind: 'default' },
            request: defaultRunRequest({ profile: 'cases', paths: [ 'case.test.ts' ], record: true, order: 'plan' })
        }
    };
}
export async function writeReplayCase(project: ReplayProject, source: string): Promise<void> {
    await writeFile(path.join(project.cwd, 'case.test.ts'), source);
}
export async function replayRecords(project: ReplayProject): Promise<readonly ReplayRunRecord[]> {
    const directory = path.join(project.cwd, '.overkill', 'runs');
    const names = await readdir(directory);
    return await Promise.all(
        names
            .filter(function json(name) {
                return name.endsWith('.json');
            })
            .map(async function read(name) {
                return replayRecordSchema.parse(JSON.parse(await readFile(path.join(directory, name), 'utf8')));
            })
    );
}
export async function executeReplayCli(
    project: ReplayProject,
    args: readonly string[]
): Promise<{ readonly code: number; readonly output: string; }> {
    return await new Promise(function execute(resolve, reject) {
        execFile(
            process.execPath,
            [ binary, ...args ],
            { cwd: project.cwd, timeout: 60_000 },
            function completed(error, stdout, stderr) {
                if (error === null) {
                    resolve({ code: 0, output: stdout + stderr });
                } else if (typeof error.code === 'number') {
                    resolve({ code: error.code, output: stdout + stderr });
                } else {
                    reject(new Error('Replay command failed to start.', { cause: error }));
                }
            }
        );
    });
}
export function replayProfile(processModel: 'in-process' | 'supervised-process' | 'worker-pool'): ProjectProfileConfig {
    const common = {
        files: { include: [ 'case.test.ts' ] as const },
        timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
    };
    return processModel === 'worker-pool'
        ? { ...common, testFamily: 'integration', execution: { processModel, scheduling: 'serial', maxWorkers: 2 } }
        : { ...common, testFamily: 'microtest', execution: { processModel, scheduling: 'serial' } };
}
export function replayPassingCase(title: string, passed: boolean): string {
    return `import {test} from ${JSON.stringify(replayAuthoringUrl)};
export const testNode = test(${JSON.stringify(title)}, scope => {
    scope.assert.equal(${String(passed)}, true); return scope.assert.collect();
});`;
}

export async function captureReplayWitness(
    project: ReplayProject,
    source: string,
    name: string
): Promise<{ readonly result: RunResult; readonly file: string; }> {
    await writeReplayCase(project, source);
    const result = await orchestrator.run(project.command);
    const witness = result.perTest[0]?.property?.invocations[0]?.confirmedWitness;
    if (witness === undefined || witness === null) {
        throw new Error('Expected a confirmed replay witness.');
    }
    const file = path.join(project.cwd, name);
    await writeFile(file, JSON.stringify(witness));
    return { result, file };
}
