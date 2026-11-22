import { suite, test } from '@overkill-dev/test';

import { observationPlan } from '../test-support/observation-lifetime.ts';
import { supervisedChildCommand } from '../test-support/supervised-child-fixture.ts';
import {
    assignedPropertyCorpus,
    frozenSupervisedPolicy,
    supervisedAssignedPlan,
    type SupervisedAssignmentCommand
} from './supervised-protocol.ts';

function assignment(): SupervisedAssignmentCommand {
    return {
        kind: 'assign',
        implementations: null,
        attachmentEndpoint: null,
        assignedWork: [],
        workloadInputs: [],
        propertyPolicies: [],
        corpus: { checkedIn: [], localCache: [], diagnostics: [] }
    };
}
export const testNode = suite('supervised assignment admission', [
    test('preserves the assigned property corpus', function (scope) {
        const input = assignment();
        scope.assert.deepEqual(assignedPropertyCorpus(input), { checkedIn: [], localCache: [], diagnostics: [] });
        return scope.assert.collect();
    }),
    test('admits a complete work assignment', function (scope) {
        const plan = observationPlan();
        const selected = supervisedAssignedPlan(plan, { ...assignment(), assignedWork: [ plan.cases[0].workId ] });
        scope.assert.deepEqual(selected.cases, plan.cases);
        return scope.assert.collect();
    }),
    test('rejects an empty assignment', function (scope) {
        scope.assert.throws(function () {
            supervisedAssignedPlan(observationPlan(), assignment());
        }, { message: 'Supervised child test plan did not match assigned work identities.' });
        return scope.assert.collect();
    }),
    test('rejects work absent from the collected plan', function (scope) {
        const plan = observationPlan();
        const work = plan.cases[0].workId;
        scope.assert.throws(function () {
            supervisedAssignedPlan(plan, {
                ...assignment(),
                assignedWork: [ { ...work, case: { ...work.case, title: 'absent' } } ]
            });
        }, { message: 'Supervised child test plan did not match assigned work identities.' });
        return scope.assert.collect();
    }),
    test('returns the policy carried by frozen commands', function (scope) {
        const command = supervisedChildCommand('run', 'subject.test.ts');
        const policy = { files: [] };
        scope.assert.equal(
            Reflect.apply(frozenSupervisedPolicy, undefined, [ { ...command, kind: 'run-frozen', policy } ]),
            policy
        );
        return scope.assert.collect();
    })
]);
