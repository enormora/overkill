import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testSuite as lineReporterOrphanTestSuite } from './line-reporter-orphan.test.ts';
import { testSuite as lineReporterTerminalTestSuite } from './line-reporter-terminal.test.ts';
import { testSuite as lineReporterTestSuite } from './line-reporter.test.ts';

export const testSuite = createSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/reporters/line-reporter-suite.test.ts',
    metadata: {},
    children: [
        lineReporterTestSuite,
        lineReporterTerminalTestSuite,
        lineReporterOrphanTestSuite
    ]
});
