import { suite } from '@overkill-dev/test';

import { testNode as configInventoriesTestNode } from '../../../eslint-test/config-inventories.test.ts';
import { testNode as configFilesTestNode } from '../../../eslint-test/config-files.test.ts';
import { testNode as configFixturesTestNode } from '../../../eslint-test/config-fixtures.test.ts';
import { testNode as configPropertiesTestNode } from '../../../eslint-test/config-properties.test.ts';
import { testNode as configProjectsTestNode } from '../../../eslint-test/config-projects.test.ts';
import { testNode as configProcessorsTestNode } from '../../../eslint-test/config-processors.test.ts';
import { testNode as configCapabilitiesTestNode } from '../../../eslint-test/config-capabilities.test.ts';

export const testNode = suite('eslint configuration integration', [
    configInventoriesTestNode,
    configFilesTestNode,
    configFixturesTestNode,
    configPropertiesTestNode,
    configProjectsTestNode,
    configProcessorsTestNode,
    configCapabilitiesTestNode
]);
