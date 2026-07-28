import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import type { AssertAssertionNode, RequireAssertionNode } from '../assertion-protocol/assertion-node.ts';
import type { AssertionSource } from '../assertion-protocol/assertion-node-shape.ts';
import {
    createRecordingAssertFacade,
    createRecordingRequireFacade,
    type AssertAssertionFacade,
    type RequireAssertionFacade
} from './assertion-facade.ts';

type AssertRecording = {
    readonly facade: AssertAssertionFacade;
    readonly records: readonly AssertAssertionNode[];
};

type RequireRecording = {
    readonly facade: RequireAssertionFacade;
    readonly records: readonly RequireAssertionNode[];
};

function assertionChecks(records: readonly (AssertAssertionNode | RequireAssertionNode)[]): readonly string[] {
    return records.map(function checkOf(record) {
        return record.check;
    });
}

function assertRecordSources(
    records: readonly (AssertAssertionNode | RequireAssertionNode)[],
    source: AssertionSource
): void {
    assert.deepStrictEqual(
        records.map(function sourceOf(record) {
            return record.source;
        }),
        records.map(function expectedSource() {
            return source;
        })
    );
}

function createAssertRecording(): AssertRecording {
    const records: AssertAssertionNode[] = [];
    const facade = createRecordingAssertFacade({
        failContract(failure) {
            throw new Error(failure.summary);
        },
        recordAssert(assertion) {
            records.push(assertion);
        },
        recordPendingAssert() {
            return {
                resolve(assertion) {
                    records.push(assertion);
                }
            };
        }
    }, null);

    return { facade, records };
}

function createRequireRecording(): RequireRecording {
    const records: RequireAssertionNode[] = [];
    const facade = createRecordingRequireFacade({
        failContract(failure) {
            throw new Error(failure.summary);
        },
        recordRequire(assertion) {
            records.push(assertion);
        }
    }, null);

    return { facade, records };
}

function assertAssertPayloads(records: readonly AssertAssertionNode[]): void {
    const instanceOfRecord = records.at(16);

    assert.deepStrictEqual(records.at(0), { actual: [ 1 ], check: 'array', message: 'array', source: 'assert' });
    assert.deepStrictEqual(records.at(2), {
        actual: 2,
        check: 'between',
        maximum: 3,
        message: null,
        minimum: 1,
        source: 'assert'
    });
    assert.deepStrictEqual(records.at(14), {
        actual: { name: 'Ada' },
        check: 'has-property',
        key: 'name',
        message: null,
        source: 'assert'
    });

    if (instanceOfRecord?.check !== 'instance-of') {
        throw new TypeError('Expected an instance-of assertion node.');
    }

    assert.deepStrictEqual(instanceOfRecord, {
        actual: instanceOfRecord.actual,
        check: 'instance-of',
        expected: Error,
        message: null,
        source: 'assert'
    });
}

function assertRequirePayloads(records: readonly RequireAssertionNode[]): void {
    const instanceOfRecord = records.at(5);

    assert.deepStrictEqual(records.at(0), { actual: [ 1 ], check: 'array', message: 'array', source: 'require' });
    assert.deepStrictEqual(records.at(4), {
        actual: { name: 'Ada' },
        check: 'has-property',
        key: 'name',
        message: null,
        source: 'require'
    });

    if (instanceOfRecord?.check !== 'instance-of') {
        throw new TypeError('Expected an instance-of requirement node.');
    }

    assert.deepStrictEqual(instanceOfRecord, {
        actual: instanceOfRecord.actual,
        check: 'instance-of',
        expected: Error,
        message: null,
        source: 'require'
    });
}

function recordAssertNodes(facade: AssertAssertionFacade): void {
    const actualFunction = function value(): void {
        return undefined;
    };
    const calls: readonly (() => void)[] = [
        function () {
            facade.array([ 1 ], { message: 'array' });
        },
        function () {
            facade.arrayContainsPartial([ { id: 1 } ], { id: 1 });
        },
        function () {
            facade.between(2, 1, 3);
        },
        function () {
            facade.boolean(true);
        },
        function () {
            facade.deepEqual({ id: 1 }, { id: 1 });
        },
        function () {
            facade.defined('value');
        },
        function () {
            facade.empty([]);
        },
        function () {
            facade.endsWith('value', 'ue');
        },
        function () {
            facade.equal(1, 1);
        },
        function () {
            facade.fail();
        },
        function () {
            facade.false(false);
        },
        function () {
            facade.function(actualFunction);
        },
        function () {
            facade.greaterThan(2, 1);
        },
        function () {
            facade.greaterThanOrEqual(2, 2);
        },
        function () {
            facade.hasProperty({ name: 'Ada' }, 'name');
        },
        function () {
            facade.includes('value', 'al');
        },
        function () {
            facade.instanceOf(new Error('boom'), Error);
        },
        function () {
            facade.length([ 1, 2 ], 2);
        },
        function () {
            facade.lessThan(1, 2);
        },
        function () {
            facade.lessThanOrEqual(2, 2);
        },
        function () {
            facade.match('value', /^value/u);
        },
        function () {
            facade.membersPartialDeepEqual([ { id: 1 } ], [ { id: 1 } ]);
        },
        function () {
            facade.notDeepEqual({ id: 1 }, { id: 2 });
        },
        function () {
            facade.notEmpty([ 1 ]);
        },
        function () {
            facade.notEqual(1, 2);
        },
        function () {
            facade.notMatch('value', /^other/u);
        },
        function () {
            facade.notNull('value');
        },
        function () {
            facade.null(null);
        },
        function () {
            facade.number(1);
        },
        function () {
            facade.object({ id: 1 });
        },
        function () {
            facade.partialDeepEqual({ id: 1, name: 'Ada' }, { id: 1 });
        },
        function () {
            facade.startsWith('value', 'val');
        },
        function () {
            facade.string('value');
        },
        function () {
            facade.true(true);
        },
        function () {
            facade.undefined(undefined);
        }
    ];

    calls.forEach(function recordAssertion(callAssertion) {
        callAssertion();
    });
}

function recordRequireNodes(facade: RequireAssertionFacade): void {
    const actualFunction = function value(): void {
        return undefined;
    };
    const calls: readonly (() => void)[] = [
        function () {
            facade.array([ 1 ], { message: 'array' });
        },
        function () {
            facade.boolean(true);
        },
        function () {
            facade.defined('value');
        },
        function () {
            facade.function(actualFunction);
        },
        function () {
            facade.hasProperty({ name: 'Ada' }, 'name');
        },
        function () {
            facade.instanceOf(new Error('boom'), Error);
        },
        function () {
            facade.notNull('value');
        },
        function () {
            facade.null(null);
        },
        function () {
            facade.number(1);
        },
        function () {
            facade.object({ id: 1 });
        },
        function () {
            facade.string('value');
        }
    ];

    calls.forEach(function recordRequirement(callRequirement) {
        callRequirement();
    });
}

registerTest('createRecordingAssertFacade() records every built-in assertion node', function () {
    const recording = createAssertRecording();

    recordAssertNodes(recording.facade);

    assert.deepStrictEqual(assertionChecks(recording.records), [
        'array',
        'array-contains-partial',
        'between',
        'boolean',
        'deep-equal',
        'defined',
        'empty',
        'ends-with',
        'equal',
        'fail',
        'false',
        'function',
        'greater-than',
        'greater-than-or-equal',
        'has-property',
        'includes',
        'instance-of',
        'length',
        'less-than',
        'less-than-or-equal',
        'match',
        'members-partial-deep-equal',
        'not-deep-equal',
        'not-empty',
        'not-equal',
        'not-match',
        'not-null',
        'null',
        'number',
        'object',
        'partial-deep-equal',
        'starts-with',
        'string',
        'true',
        'undefined'
    ]);
    assertRecordSources(recording.records, 'assert');
    assertAssertPayloads(recording.records);
});

registerTest('createRecordingAssertFacade() applies annotated messages without requiring the builder API', function () {
    const recording = createAssertRecording();

    recording.facade.annotated('annotated value').empty([]);
    recording.facade.annotated('base message').empty([], { message: 'option value' });

    assert.deepStrictEqual(
        recording.records.map(function messageOf(record) {
            return record.message;
        }),
        [ 'annotated value', 'option value' ]
    );
    assert.equal(Object.hasOwn(recording.facade, 'done'), false);
});

registerTest('createRecordingRequireFacade() records every built-in requirement node', function () {
    const recording = createRequireRecording();

    recordRequireNodes(recording.facade);

    assert.deepStrictEqual(assertionChecks(recording.records), [
        'array',
        'boolean',
        'defined',
        'function',
        'has-property',
        'instance-of',
        'not-null',
        'null',
        'number',
        'object',
        'string'
    ]);
    assertRecordSources(recording.records, 'require');
    assertRequirePayloads(recording.records);
});

registerTest('createRecordingRequireFacade() applies annotated messages', function () {
    const recording = createRequireRecording();
    const requiredValue: RequireAssertionFacade = recording.facade.annotated('required value');
    const optionValue: RequireAssertionFacade = recording.facade.annotated('base message');

    requiredValue.string('value');
    optionValue.string('value', { message: 'option value' });

    assert.deepStrictEqual(
        recording.records.map(function messageOf(record) {
            return record.message;
        }),
        [ 'required value', 'option value' ]
    );
});
