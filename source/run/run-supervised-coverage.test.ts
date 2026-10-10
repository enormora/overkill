import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { withCoverageRecordFixture, type CoverageRecordFixture } from '../test-support/coverage-record-fixture.ts';
import { defaultRunConfig } from '../test-support/run-command-factory.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    createFakeSupervisedChildProcess,
    type FakeSupervisedChildRunContext
} from '../test-support/fake-supervised-child-process.ts';
import { deterministicRunCollection } from '../test-support/deterministic-run-fixtures.ts';
import { supervisedAssignedWork } from './supervised-protocol.ts';
import { configuredFilesRunCollectionSource } from './run-collection-source.ts';
import { createSupervisedRunResult } from './run-supervised-process.ts';

const passingFile = 'source/integration-tests/run/fixtures/passing.test.ts';

function completeAssignedRun(context: FakeSupervisedChildRunContext): void {
    const work = supervisedAssignedWork(context.assignment);
    for (const workId of work) {
        context.emitMessage({
            kind: 'event',
            event: {
                attempt: 1,
                case: workId.case,
                definitionLocations: [ { kind: 'unknown' } ],
                kind: 'test-start',
                suitePath: [],
                workId
            }
        });
        context.emitMessage({
            kind: 'event',
            event: {
                attempt: 1,
                artifacts: [],
                completion: 'final',
                case: workId.case,
                definitionLocations: [ { kind: 'unknown' } ],
                durationMicroseconds: 0,
                kind: 'test-end',
                outcome: { kind: 'pass' },
                suitePath: [],
                verdict: 'pass',
                workId
            }
        });
    }
    context.emitMessage({
        kind: 'result',
        result: runResultFactory.build({
            perTest: work.map(function passingOutcome(workId) {
                return { id: workId.case, outcome: { kind: 'pass' }, workId };
            }),
            summary: { defined: 2, discovered: work.length, planned: work.length, passed: work.length }
        })
    });
    context.emitExit();
}

async function assertSupervisedAttempt(
    scope: TestScope,
    failFacts: boolean,
    fixture: CoverageRecordFixture
): Promise<void> {
    let executed = false;
    const command = {
        ...fixture.request.command,
        request: { ...fixture.request.command.request, paths: [ passingFile ] }
    };
    const result = await createSupervisedRunResult({
        baseline: null,
        command,
        dependencies: {
            ...fixture
                .request
                .dependencies,
            async discoverRunFilesWithProjectRoot() {
                return {
                    files: [ {
                        file: passingFile,
                        fileSet: null,
                        href: `virtual:${passingFile}`,
                        path: passingFile
                    } ],
                    projectRoot: process.cwd()
                };
            },
            async startSupervisedChild() {
                return createFakeSupervisedChildProcess({
                    collect: deterministicRunCollection,
                    run(context) {
                        executed = true;
                        completeAssignedRun(context);
                    }
                });
            }
        },
        timing: null,
        source: configuredFilesRunCollectionSource,
        input: {
            ...fixture.request.input,
            files: [ { file: passingFile, fileSet: null, href: `virtual:${passingFile}`, path: passingFile } ],
            request: command.request
        }
    });
    scope.assert.equal(executed, !failFacts);
    scope.assert.equal(result.status, 'failed');
    scope.assert.equal(result.runnerErrors[0]?.subtype, failFacts ? 'runtime-state' : 'coverage');
    scope.assert.equal(fixture.records.at(-1)?.status, 'completed');
    scope.assert.equal(fixture.records.at(-1)?.result?.status, 'failed');
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/run-supervised-coverage.test.ts',
    annotations: {},
    controls: {},
    children: [ false, true ].map(function supervisedCoverageTest(failFacts) {
        return createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: failFacts
                ? 'facts persistence gates supervised assignment'
                : 'supervised report failures retain completed outcomes',
            annotations: {},
            controls: {},
            async body(scope) {
                return await withCoverageRecordFixture(
                    defaultRunConfig(),
                    failFacts ? [ 2 ] : [],
                    async function verifySupervisedAttempt(fixture) {
                        await assertSupervisedAttempt(scope, failFacts, fixture);
                        return scope.assert.collect();
                    }
                );
            }
        });
    })
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
