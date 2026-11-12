import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as commandLine } from '../packages/test/command-line-merge-results.test.ts';
import { testNode as compatibility } from './merge-results-compatibility.test.ts';
import { testNode as assessment } from './merge-results-assessment.test.ts';
import { testNode as incomplete } from './merge-results-incomplete.test.ts';
import { testNode as inputs } from './merge-results.test.ts';
import { testNode as results } from './merged-run-result.test.ts';
import { testNode as timings } from './merged-run-timings.test.ts';

export const testNode = createSuite({
    title: 'merge results',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ assessment, incomplete, compatibility, commandLine, inputs, results, timings ]
});
await runIfMain(import.meta, testNode);
