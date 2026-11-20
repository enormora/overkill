import { table, type TestNode, suite } from '@overkill-dev/test';

import { passingIsolatedWorkerRun } from '../test-support/isolated-worker-run.ts';
import { attachmentRecording } from '../test-support/attachment-recording.ts';
import { defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import { createRunTimingMeasurement } from './run-timing-collection.ts';
import { runLocalCommand } from './run-local-command.ts';
import { RunCollectionError } from './run-errors.ts';
import type { RunCommand } from './run-types.ts';

export const testNode: TestNode = suite(
    'local collection failure finalization',
    [ table({
        title: 'reports loader failures with recording and restrictions',
        cases: [ false, true ].flatMap(function (record) {
            return [ false, true ].map(function (restricted) {
                return { record, restricted };
            });
        }),
        caseTitle({ record, restricted }) {
            return [ record, restricted ].map(String).join(', ');
        },
        async test(scope) {
            const fixture = passingIsolatedWorkerRun(false, false);
            const recording = await attachmentRecording(null);
            const environment = {};
            const profile = defaultMicrotestProfile({
                execution: { processModel: 'in-process', scheduling: 'serial' }
            });
            const request = {
                ...recording.resolved.request,
                capabilityRestrictions: {
                    mode: scope.parameters.restricted ? 'enabled' as const : 'disabled' as const
                }
            };
            const command: RunCommand = {
                cwd: '/project',
                engine: { kind: 'default' },
                config: { ...recording.resolved.config, profiles: { microtest: profile } },
                request
            };
            const options = {
                record: scope.parameters.record ? recording.session : null,
                baseline: null,
                input: { ...fixture.input, config: command.config, request, profile },
                source: { kind: 'configured-files' as const },
                timing: createRunTimingMeasurement(
                    recording.clock
                )
            };
            const result = await runLocalCommand(command, {
                ...fixture.dependencies,
                runtimeCapabilityPolicy: {
                    ...fixture.dependencies.runtimeCapabilityPolicy,
                    readEnvironment() {
                        return environment;
                    }
                },
                async loadRunTestModules() {
                    throw new RunCollectionError('Loader failed.', {}, 'loader');
                }
            }, options);
            scope.assert.deepEqual({
                status: result.status,
                errors: result.runnerErrors.map(function (error) {
                    return error.subtype;
                }),
                checkpoints: recording.checkpoints.length
            }, { status: 'failed', errors: [ 'loader' ], checkpoints: scope.parameters.record ? 1 : 0 });
            return scope.assert.collect();
        }
    }) ]
);
