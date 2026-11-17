import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as configInventoriesTestNode } from '../../../eslint-test/config-inventories.test.ts';
import { testNode as configFilesTestNode } from '../../../eslint-test/config-files.test.ts';
import { testNode as configFixturesTestNode } from '../../../eslint-test/config-fixtures.test.ts';
import { testNode as configPropertiesTestNode } from '../../../eslint-test/config-properties.test.ts';
import { testNode as configProjectsTestNode } from '../../../eslint-test/config-projects.test.ts';
import { testNode as configProcessorsTestNode } from '../../../eslint-test/config-processors.test.ts';
import { testNode as configCapabilitiesTestNode } from '../../../eslint-test/config-capabilities.test.ts';

export const testNode = createSuite({
    title: 'eslint configuration integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        configInventoriesTestNode,
        configFilesTestNode,
        configFixturesTestNode,
        configPropertiesTestNode,
        configProjectsTestNode,
        configProcessorsTestNode,
        configCapabilitiesTestNode
    ]
});
