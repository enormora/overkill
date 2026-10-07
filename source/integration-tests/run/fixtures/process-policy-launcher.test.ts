import { orchestrator } from '../../../run/run-orchestrator.entry-point.ts';
import { defaultMicrotestProfile, defaultRunConfig, defaultRunRequest } from '../../../test-support/run-command-factory.ts';

const [ , , operation, processModel ] = process.argv;
if (processModel !== 'in-process' && processModel !== 'supervised-process') {
    throw new Error('Expected process model.');
}
const result = await orchestrator.run({
    config: defaultRunConfig({
        profiles: { microtest: defaultMicrotestProfile({
            execution: { processModel, scheduling: 'serial', maxConcurrency: 1 },
            timeouts: { collectionMilliseconds: 5000, hardMilliseconds: 5000, softMilliseconds: 4000 }
        }) },
        reporters: []
    }),
    cwd: process.cwd(),
    engine: { kind: 'default' },
    request: defaultRunRequest({ order: 'lexical', paths: [ `source/integration-tests/run/fixtures/process-${operation}-policy.test.ts` ] })
});
process.stdout.write(JSON.stringify(result));
