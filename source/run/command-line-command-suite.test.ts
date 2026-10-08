import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as benchmarkCommandsTestNode } from './benchmark-commands.test.ts';
import { testNode as commandLineCommandTestNode } from './command-line-command.test.ts';
import { testNode as commandLineCommandNamespaceTestNode } from './command-line-command-namespace.test.ts';
import { testNode as commandLineUnimplementedCommandsTestNode } from './command-line-unimplemented-commands.test.ts';

export const testNode = suite('command-line commands', [
    commandLineCommandTestNode,
    commandLineCommandNamespaceTestNode,
    commandLineUnimplementedCommandsTestNode,
    benchmarkCommandsTestNode
]);

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
