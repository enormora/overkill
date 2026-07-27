import type { AssertionNode } from './assertions.ts';

const defaultSummaryByCheck: Readonly<Record<AssertionNode['check'], string>> = {
    array: 'Expected value to be an array.',
    'array-contains-partial': 'Expected array to contain a partial member.',
    between: 'Expected number to be between the bounds.',
    boolean: 'Expected value to be a boolean.',
    'deep-equal': 'Expected values to be deeply equal.',
    defined: 'Expected value to be defined.',
    empty: 'Expected collection to be empty.',
    'ends-with': 'Expected string to end with the value.',
    equal: 'Expected values to be equal.',
    fail: 'Assertion failed.',
    false: 'Expected value to be false.',
    function: 'Expected value to be a function.',
    'greater-than': 'Expected number to be greater than the threshold.',
    'greater-than-or-equal': 'Expected number to be greater than or equal to the threshold.',
    'has-property': 'Expected object to have the own property.',
    includes: 'Expected string to include the value.',
    'instance-of': 'Expected value to be an instance of the constructor.',
    length: 'Expected collection length to match.',
    'less-than': 'Expected number to be less than the threshold.',
    'less-than-or-equal': 'Expected number to be less than or equal to the threshold.',
    match: 'Expected string to match the pattern.',
    'members-partial-deep-equal': 'Expected array to contain the partial members.',
    'not-deep-equal': 'Expected values not to be deeply equal.',
    'not-empty': 'Expected collection not to be empty.',
    'not-equal': 'Expected values not to be equal.',
    'not-match': 'Expected string not to match the pattern.',
    'not-null': 'Expected value not to be null.',
    null: 'Expected value to be null.',
    number: 'Expected value to be a number.',
    object: 'Expected value to be an object.',
    'partial-deep-equal': 'Expected value to partially match.',
    'starts-with': 'Expected string to start with the value.',
    string: 'Expected value to be a string.',
    true: 'Expected value to be true.',
    undefined: 'Expected value to be undefined.'
};

export function assertionSummary(assertion: AssertionNode): string {
    return assertion.message ?? defaultSummaryByCheck[assertion.check];
}
