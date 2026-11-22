import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, suite } from '@overkill-dev/test';

import {
    withMemoryCoverageRecordFixture,
    type CoverageRecordFixture
} from '../../../test-support/coverage-record-fixture.ts';
import { isolatedRunStateDirectory, defaultRunConfig } from '../../../test-support/run-command-factory.ts';
import { runResultFactory } from '../../../test-support/run-result-factory.ts';
import {
    createFakeSupervisedChildProcess,
    type FakeSupervisedChildRunContext
} from '../../../test-support/fake-supervised-child-process.ts';
import { deterministicRunCollection } from '../../../test-support/deterministic-run-fixtures.ts';
import { supervisedAssignedWork } from '../../../run/supervised-protocol.ts';
import { configuredFilesRunCollectionSource } from '../../../run/run-collection-source.ts';
import { createSupervisedRunResult } from '../../../run/run-supervised-process.ts';

const passingFile = 'source/integration-tests/runtime/fixtures/passing.test.ts';

function completeAssignedRun(context: FakeSupervisedChildRunContext): void {
    const work = supervisedAssignedWork(context.assignment);
    for (const workId of work) {
        context.emitMessage({
            kind: 'event',
            event: {
                attempt: 0,
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
                property: null,
                benchmark: null,
                attempt: 0,
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

const assertSupervisedAttempt = defineCompositeAssertion({
    name: 'supervised attempt',
    async assert(check, failFacts: boolean, fixture: CoverageRecordFixture) {
        let executed = false;
        const command = {
            ...fixture.request.command,
            request: { ...fixture.request.command.request, paths: [ passingFile ] }
        };
        const result = await createSupervisedRunResult({
            record: null,
            baseline: null,
            signal: null,
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
        return check.group([
            check.equal(executed, !failFacts),
            check.equal(result.status, 'failed'),
            check.equal(result.runnerErrors[0]?.subtype, failFacts ? 'runtime-state' : 'coverage'),
            check.equal(fixture.records.at(-1)?.status, 'completed'),
            check.equal(fixture.records.at(-1)?.result?.status, 'failed')
        ]);
    }
});

export const testNode = suite(
    'Run supervised coverage',
    [ table({
        title: 'records supervised coverage across selection and restriction policies',
        cases: [ false, true ],
        caseTitle(failFacts) {
            return failFacts
                ? 'facts persistence gates supervised assignment'
                : 'supervised report failures retain completed outcomes';
        },
        async test(scope) {
            const failFacts = scope.parameters;

            return await withMemoryCoverageRecordFixture(
                defaultRunConfig({ runtimeStateDir: isolatedRunStateDirectory() }),
                failFacts ? [ 2 ] : [],
                async function verifySupervisedAttempt(fixture) {
                    await scope.assert(assertSupervisedAttempt, failFacts, fixture);
                    return scope.assert.collect();
                }
            );
        }
    }) ]
);
