import { runIfMain } from '#test-runner';
import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as routes } from './command-namespace-policy.test.ts';
import { testNode as ordinary } from './ordinary-command-routing.test.ts';
import { testNode as history } from './history-command-routing.test.ts';
import { testNode as replay } from './replay-command-routing.test.ts';
import { testNode as commandLineCommandTestNode } from './command-line-command.test.ts';
import { testNode as commandLineCommandNamespaceTestNode } from './command-line-command-namespace.test.ts';

export const testNode = suite('command-line commands', [
    routes,
    ordinary,
    history,
    replay,
    commandLineCommandTestNode,
    commandLineCommandNamespaceTestNode
]);

await runIfMain(import.meta, testNode);
