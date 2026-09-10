import {
    runSupervisedChildProcessEntryPoint
} from './supervised-child-process.ts';

export const supervisedChildProcessEntryPointUrl = import.meta.url;

await runSupervisedChildProcessEntryPoint(process.argv, async function loadSupervisedChild(): Promise<unknown> {
    return await import('./supervised-child.entry-point.ts');
});
