import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as projects } from './config-project-policy.test.ts';
import { testNode as assembly } from './config-test-assembly.test.ts';
import { testNode as validation } from './config-validation.test.ts';
import { testNode as controls } from './config-controls.test.ts';
import { testNode as expectations } from './config-expectations.test.ts';
import { testNode as contractPolicy } from './config-contract-policy.test.ts';
import { testNode as failures } from './config-failure-policy.test.ts';

export const testNode = suite('ESLint config tests', [
    projects,
    assembly,
    validation,
    controls,
    expectations,
    contractPolicy,
    failures
]);
