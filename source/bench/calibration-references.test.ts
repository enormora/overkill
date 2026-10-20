import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import { calibrationSnapshot } from '../test-support/calibration-fixture.ts';
import { selectCalibrationReference } from './calibration-references.ts';

const actual = { ...calibrationSnapshot([ 100, 100 ]), machineClass: 'fast-mac' };
const foreign = { ...actual, machineClass: 'slow-arm-runner', samples: [ 400, 400 ] };
const incompatibleArguments = { ...actual, execution: { ...actual.execution, nodeArguments: [ '--jitless' ] } };
const incompatibleWorkload = { ...actual, identity: { ...actual.identity, version: 'other-workload' } };
const work = createDefaultWorkId(createCaseId('portable.bench.ts', [], 'portable', null));
const scenarios = [
    {
        title: 'prefers compatible local captures over other machines',
        references: [ foreign, incompatibleArguments, actual ],
        machineClass: 'fast-mac',
        sample: 100,
        source: 'fixed'
    },
    {
        title: 'uses compatible captures from different hardware',
        references: [ incompatibleWorkload, foreign ],
        machineClass: 'slow-arm-runner',
        sample: 400,
        source: 'fixed'
    },
    {
        title: 'ignores incompatible optional captures without blocking normalization',
        references: [ incompatibleArguments, incompatibleWorkload ],
        machineClass: 'reference-workload',
        sample: 1,
        source: 'canonical'
    }
] as const;
export const testNode = suite(
    'calibration reference selection',
    scenarios.map(function scenario(input) {
        return test(input.title, function (scope: TestScope) {
            const selected = selectCalibrationReference({
                actual,
                metric: 'value',
                work,
                context: {
                    mode: 'compare',
                    executionId: null,
                    profile: 'bench',
                    machine: { machineClass: actual.machineClass, metadata: {} },
                    references: input.references,
                    saved: []
                }
            }, 'proportional');
            scope.assert.equal(selected.source, input.source);
            scope.assert.equal(selected.reference.machineClass, input.machineClass);
            scope.assert.equal(selected.reference.samples[0], input.sample);
            scope.assert.equal(selected.budgetReference.machineClass, 'reference-workload');
            scope.assert.equal(selected.budgetFactor, 0.01);
            return scope.assert.collect();
        });
    })
);
