import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as inventories } from './config-inventories.test.ts';
import { testNode as files } from './config-files.test.ts';
import { testNode as fixtures } from './config-fixtures.test.ts';
import { testNode as properties } from './config-properties.test.ts';
import { testNode as projects } from './config-projects.test.ts';
import { testNode as processors } from './config-processors.test.ts';
import { testNode as validation } from './config-validation.test.ts';
import { testNode as capabilities } from './config-capabilities.test.ts';
import { testNode as controls } from './config-controls.test.ts';

export const testNode = suite('ESLint config tests', [
    inventories,
    files,
    fixtures,
    properties,
    projects,
    processors,
    validation,
    capabilities,
    controls
]);
