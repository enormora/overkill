import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { table, type TestScope, suite, test } from '@overkill-dev/test';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { retainedWitnessFile, retainedWitnessEvidence } from '../../../test-support/property-witness-fixture.ts';
import { type RunReporterDeliveryResult, orchestrator } from '../../../packages/run/run.entry-point.ts';

import {
    defineReporter,
    parseWitnessFile,
    type RunArtifact,
    type RunResult,
    type DefinedReporter
} from '../../../packages/engine/engine.entry-point.ts';

import { packageVersion } from '../../../package-version.ts';
import {
    replayProject,
    writeReplayCase,
    replayPropertyUrl,
    replayRecords,
    type ReplayProject
} from '../../../test-support/replay-project-fixture.ts';

import { parseSerializedRunDiagnostics, serializeRunDiagnostics } from '../../../run/run-record-result.ts';

function propertyWitnesses(result: RunResult): readonly RunArtifact[] {
    return result.artifacts.filter(function witness(artifact) {
        return artifact.id.subtype === 'witness';
    });
}

async function witnessProject(
    cleanup: TestScope['cleanup'],
    processModel: 'in-process' | 'supervised-process',
    passes: boolean
): Promise<ReplayProject> {
    const project = await replayProject(cleanup, {
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

const assertWitnessInput = defineCompositeAssertion({
    name: 'witness input',
    async assert(check, result: RunResult, file: string) {
        const witness = parseWitnessFile(JSON.parse(await readFile(file, 'utf8')));
        const producer = await packageVersion(import.meta.url);
        const confirmed = result.perTest[0]?.property?.invocations[0]?.confirmedWitness;
        if (producer === null) {
            return check.notNull(producer);
        }
        return check.group([
            check.deepEqual(witness.producedBy, { library: producer.name, libraryVersion: producer.version }),
            check.deepEqual({ witness }, { witness: confirmed }),
            check.deepEqual(
                propertyWitnesses(result).map(function source(artifact) {
                    return [ artifact.source, artifact.id.attempt?.index ];
                }),
                [ [ 'native', 0 ] ]
            )
        ]);
    }
});

const assertWitnessRecord = defineCompositeAssertion({
    name: 'witness record',
    async assert(check, project: ReplayProject, result: RunResult) {
        const records = await replayRecords(project);
        const initialChecks = check.equal(records.length, 1);
        const record = records[0];
        if (record === undefined) {
            return check.group([ initialChecks, check.defined(record) ]);
        }
        const intermediateChecks = check.group([ check.defined(record), check.equal(record.status, 'completed') ]);
        const saved: unknown = JSON.parse(
            await readFile(
                path.join(project.cwd, '.overkill', 'runs', `${record.id}.json`),
                'utf8'
            )
        );
        if (typeof saved !== 'object' || saved === null) {
            throw new Error('Expected a persisted run record.');
        }
        return check.group([
            initialChecks,
            intermediateChecks,
            check.deepEqual(
                parseSerializedRunDiagnostics(Reflect.get(saved, 'result')).artifacts,
                serializeRunDiagnostics(result).artifacts
            )
        ]);
    }
});

const assertWitnessReplay = defineCompositeAssertion({
    name: 'witness replay',
    async assert(check, project: ReplayProject, file: string) {
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
        return check.group([
            check.deepEqual(replay.runnerErrors, []),
            check.equal(replay.summary.failed, 1),
            check.equal(propertyWitnesses(replay).length, 0)
        ]);
    }
});

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
            onResult({ result }) {
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

type RetainedWitnessReportEvidence = { readonly delivery: RunReporterDeliveryResult; readonly report: WitnessReport; };

const retainedWitnessReport = defineCompositeAssertion({
    name: 'retained witness report',
    assert(
        check,
        { delivery, report }: RetainedWitnessReportEvidence
    ) {
        return check.group([
            check.deepEqual(delivery.result.runnerErrors, []),
            check.deepEqual(report.artifacts(), propertyWitnesses(delivery.result))
        ]);
    }
});

export const testNode = suite('property witness storage', [
    table({
        title: 'retains replayable witnesses and records without an explicit request',
        cases: [ 'in-process', 'supervised-process' ] as const,
        caseTitle(processModel) {
            return processModel;
        },
        async test(
            { cleanup, assert, parameters: processModel }
        ) {
            const project = await witnessProject(cleanup, processModel, false);
            const report = witnessReport();
            const delivery = await orchestrator.runWithReporterDelivery({
                ...project.command,
                config: { ...project.command.config, reporters: [ report.reporter ] }
            });
            assert(retainedWitnessReport, { delivery, report });
            assert(retainedWitnessEvidence, delivery.result);
            const file = retainedWitnessFile(delivery.result, project.cwd);
            await assert(assertWitnessInput, delivery.result, file);

            await assert(assertWitnessRecord, project, delivery.result);
            await assert(assertWitnessReplay, project, file);
            return assert.collect();
        }
    }),
    test('passing properties retain compact records without witness files', async function (scope) {
        const project = await witnessProject(scope.cleanup, 'in-process', true);
        const result = await orchestrator.run(project.command);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.deepEqual(result.runnerErrors, []);
        scope.assert.deepEqual(propertyWitnesses(result), []);
        const files = await readdir(path.join(project.cwd, '.overkill'), { recursive: true });
        scope.assert.false(files.includes('witnesses'));
        return scope.assert.collect();
    }),
    test(
        'witness write failures preserve confirmed evidence and fail the run',
        async function (scope) {
            const project = await witnessProject(scope.cleanup, 'in-process', false);
            await mkdir(path.join(project.cwd, '.overkill'), { recursive: true });
            await writeFile(path.join(project.cwd, '.overkill', 'witnesses'), 'blocked');
            const result = await orchestrator.run(project.command);
            scope.assert.equal(result.summary.failed, 1);
            scope.assert.true(result.runnerErrors.some(function artifactFailure(error) {
                return error.subtype === 'artifact';
            }));
            scope.assert.notNull(result.perTest[0]?.property?.invocations[0]?.confirmedWitness);
            return scope.assert.collect();
        }
    )
]);
