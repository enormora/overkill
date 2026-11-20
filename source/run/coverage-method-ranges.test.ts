import { table, type TestNode, suite, test } from '@overkill-dev/test';

import { normalizeCoverageMethodRanges } from './coverage-method-ranges.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

export const testNode: TestNode = suite('Coverage method ranges', [
    table({
        ...metadata,
        title: 'preserves unmatched source ranges',
        cases: [
            { source: 'const box = { [name', start: 14, end: 18 },
            { source: 'const box = { replace(value', start: 14, end: 26 },
            { source: 'const box = { async', start: 14, end: 18 },
            { source: 'const box = { replace(value) { return value; } };', start: 13, end: 44 },
            { source: 'const box = { replace(value) { return value; } };', start: 14, end: 20 }
        ],
        caseTitle(scenario) {
            return `${scenario.start}, ${scenario.end}, ${scenario.source}`;
        },
        test(scope) {
            const scenario = scope.parameters;

            const functions = [ {
                functionName: 'replace',
                isBlockCoverage: true,
                ranges: [ { count: 2, startOffset: scenario.start, endOffset: scenario.end } ]
            } ];

            scope.assert.deepEqual(normalizeCoverageMethodRanges(functions, scenario.source), functions);
            return scope.assert.collect();
        }
    }),
    table({
        ...metadata,
        title: 'preserves method coverage counts',
        cases: [
            { header: 'replace', prefix: 'const box = { ', changed: true },
            { header: 'async replace', prefix: 'const box = { ', changed: true },
            { header: '*replace', prefix: 'const box = { ', changed: true },
            { header: 'async *replace', prefix: 'const box = { ', changed: true },
            { header: 'get value', prefix: 'const box = { ', changed: true },
            { header: 'set value', prefix: 'const box = { ', changed: true },
            { header: 'get', prefix: 'const box = { ', changed: true },
            { header: 'function', prefix: 'const box = { ', changed: true },
            { header: 'async function', prefix: 'const box = { ', changed: true },
            { header: '"replace"', prefix: 'const box = { ', changed: true },
            { header: '42', prefix: 'const box = { ', changed: true },
            { header: '#replace', prefix: 'class Box { ', changed: true },
            { header: '[(() => "replace")()]', prefix: 'const box = { ', changed: true },
            { header: '[names[0]] /* 🦊 */', prefix: 'const box = { ', changed: true },
            { header: 'function', prefix: 'const box = { replace: ', changed: false },
            { header: 'function', prefix: 'const box = ', changed: false },
            { header: 'function', prefix: 'export default ', changed: false },
            { header: 'async function', prefix: 'const box = ', changed: false },
            { header: 'function replace', prefix: '', changed: false },
            { header: 'function', prefix: 'const box = [0, ', changed: false },
            { header: '', prefix: 'const replace = ', changed: false }
        ],
        caseTitle(scenario) {
            return `${scenario.prefix}, ${scenario.header}`;
        },
        test(scope) {
            const scenario = scope.parameters;

            const parameters = '(value = call("(", /[()]/, () => [1, 2]))';
            const suffix = scenario.header === '' ? ' => { return value; }' : ' { return value; }';
            const source = scenario.prefix + scenario.header + parameters + suffix;
            const root = { count: 3, startOffset: scenario.prefix.length, endOffset: source.length };
            const branch = {
                count: 1,
                startOffset: source.indexOf('return'),
                endOffset: source.length - 1
            };
            const functions = [ {
                functionName: 'unreliable',
                isBlockCoverage: true,
                ranges: [ root, branch ]
            } ];
            const result = normalizeCoverageMethodRanges(functions, source);

            scope.assert.deepEqual(result, [ {
                ...functions[0],
                ranges: [ {
                    ...root,
                    startOffset: scenario.changed ? source.indexOf(parameters) : root.startOffset
                }, branch ]
            } ]);
            scope.assert.equal(root.startOffset, scenario.prefix.length);
            return scope.assert.collect();
        }
    }),
    test('rejects function coverage without its root range', function (scope) {
        scope.assert.throws(function readIncompleteCoverage() {
            normalizeCoverageMethodRanges([
                { functionName: 'replace', isBlockCoverage: true, ranges: [] }
            ], 'const box = { replace(value) { return value; } };');
        }, { name: 'ZodError' });
        return scope.assert.collect();
    })
]);
