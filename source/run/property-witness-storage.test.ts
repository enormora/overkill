import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import {
    defineReporter,
    parseWitnessFile,
    type RunArtifact,
    type RunResult,
    type DefinedReporter
} from '../packages/engine/engine.entry-point.ts';
import { orchestrator } from '../packages/run/run.entry-point.ts';
import { packageVersion } from '../package-version.ts';
import {
    replayProject,
    writeReplayCase,
    replayPropertyUrl,
    replayRecords,
    type ReplayProject
} from '../test-support/replay-project-fixture.ts';
import { witnessReplayLines } from '../reporters/witness-replay-lines.ts';
import { parseSerializedRunDiagnostics, serializeRunDiagnostics } from './run-record-result.ts';

function propertyWitnesses(result: RunResult): readonly RunArtifact[] {
    return result.artifacts.filter(function witness(artifact) {
        return artifact.id.subtype === 'witness';
    });
}

async function witnessProject(
    scope: TestScope,
    processModel: 'in-process' | 'supervised-process',
    passes: boolean
): Promise<ReplayProject> {
    const project = await replayProject(scope, {
        testFamily: 'property',
        files: { include: [ 'case.test.ts' ] },
        execution: { processModel, scheduling: 'serial' },
        timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
    });
    await writeReplayCase(
        project,
        `import { property, gen } from ${JSON.stringify(replayPropertyUrl)};
export const testNode = property({ title: 'law', generator: gen.constant(42), test(value, sample) {
    sample.assert.equal(value, ${passes ? 42 : 0}); return sample.assert.collect();
} });`
    );
    return { ...project, command: { ...project.command, request: { ...project.command.request, record: false } } };
}

async function assertWitnessInput(scope: TestScope, result: RunResult, file: string): Promise<void> {
    const witness = parseWitnessFile(JSON.parse(await readFile(file, 'utf8')));
    const producer = await packageVersion(import.meta.url);
    const confirmed = result.perTest[0]?.property?.invocations[0]?.confirmedWitness;
    scope.require.defined(confirmed);
    scope.require.notNull(producer);
    scope.assert.deepEqual(witness.producedBy, { library: producer.name, libraryVersion: producer.version });
    scope.assert.deepEqual(witness, confirmed);
    scope.assert.deepEqual(
        propertyWitnesses(result).map(function source(artifact) {
            return [ artifact.source, artifact.id.attempt?.index ];
        }),
        [ [ 'native', 0 ] ]
    );
}

async function assertWitnessFile(scope: TestScope, result: RunResult, cwd: string): Promise<string> {
    const artifacts = propertyWitnesses(result);
    scope.assert.equal(artifacts.length, 1);
    const artifact = artifacts[0];
    scope.require.defined(artifact);
    if (artifact.payload.kind !== 'runtime-attachment' || artifact.payload.content.kind !== 'file') {
        throw new Error('Expected a retained witness file.');
    }
    scope.assert.includes(witnessReplayLines(artifacts)[0] ?? '', artifact.payload.content.path);
    const file = path.resolve(cwd, artifact.payload.content.path);
    await assertWitnessInput(scope, result, file);
    return file;
}

async function assertWitnessRecord(scope: TestScope, project: ReplayProject, result: RunResult): Promise<void> {
    const records = await replayRecords(project);
    scope.assert.equal(records.length, 1);
    const record = records[0];
    scope.require.defined(record);
    scope.assert.equal(record.status, 'completed');
    const saved: unknown = JSON.parse(
        await readFile(
            path.join(project.cwd, '.overkill', 'runs', `${record.id}.json`),
            'utf8'
        )
    );
    if (typeof saved !== 'object' || saved === null) {
        throw new Error('Expected a persisted run record.');
    }
    scope.assert.deepEqual(
        parseSerializedRunDiagnostics(Reflect.get(saved, 'result')).artifacts,
        serializeRunDiagnostics(result).artifacts
    );
}

async function assertWitnessReplay(scope: TestScope, project: ReplayProject, file: string): Promise<void> {
    const replay = await orchestrator.replayWitness({
        ...project.command,
        request: {
            debug: { mode: 'off', selectors: [] },
            path: file,
            profile: 'cases',
            seed: { value: 42n },
            capture: 'buffered',
            record: false,
            timingCollection: 'profile-default'
        }
    }, { signal: null, timing: null });
    scope.assert.deepEqual(replay.runnerErrors, []);
    scope.assert.equal(replay.summary.failed, 1);
    scope.assert.equal(propertyWitnesses(replay).length, 0);
}

type WitnessReport = {
    readonly reporter: DefinedReporter;
    readonly artifacts: () => readonly RunArtifact[];
};
function witnessReport(): WitnessReport {
    let delivered: readonly RunArtifact[] = [];
    const reporter = defineReporter(function evidenceReporter() {
        return {
            kind: 'final-result',
            name: 'witness observer',
            sinks: [],
            dispose: null,
            onResult(result) {
                delivered = propertyWitnesses(result);
            }
        };
    });
    return {
        reporter,
        artifacts() {
            return delivered;
        }
    };
}

export const testNode = suite('property witness storage', [
    ...([ 'in-process', 'supervised-process' ] as const).map(function executionModel(processModel) {
        return test(
            `${processModel} retains replayable witnesses and records without an explicit request`,
            async function (scope: TestScope) {
                const project = await witnessProject(scope, processModel, false);
                const report = witnessReport();
                const delivery = await orchestrator.runWithReporterDelivery({
                    ...project.command,
                    config: { ...project.command.config, reporters: [ report.reporter ] }
                });
                scope.assert.deepEqual(delivery.result.runnerErrors, []);
                scope.assert.deepEqual(report.artifacts(), propertyWitnesses(delivery.result));
                const file = await assertWitnessFile(scope, delivery.result, project.cwd);
                await assertWitnessRecord(scope, project, delivery.result);
                await assertWitnessReplay(scope, project, file);
                return scope.assert.collect();
            }
        );
    }),
    test('passing properties do not create witness files or run records', async function (scope: TestScope) {
        const project = await witnessProject(scope, 'in-process', true);
        const result = await orchestrator.run(project.command);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.deepEqual(result.runnerErrors, []);
        scope.assert.deepEqual(propertyWitnesses(result), []);
        const files = await readdir(path.join(project.cwd, '.overkill'), { recursive: true });
        scope.assert.false(files.some(function witnessOrRecord(file) {
            return file === 'witnesses' || file === 'runs';
        }));
        return scope.assert.collect();
    }),
    test('witness write failures preserve confirmed evidence and fail the run', async function (scope: TestScope) {
        const project = await witnessProject(scope, 'in-process', false);
        await writeFile(path.join(project.cwd, '.overkill'), 'blocked');
        const result = await orchestrator.run(project.command);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.true(result.runnerErrors.some(function artifactFailure(error) {
            return error.subtype === 'artifact';
        }));
        scope.assert.notNull(result.perTest[0]?.property?.invocations[0]?.confirmedWitness);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
