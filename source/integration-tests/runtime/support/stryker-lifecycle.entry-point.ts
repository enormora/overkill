import { performMutationLifecycle } from './stryker-lifecycle-fixture.ts';

const [ processModel, fresh ] = process.argv.slice(2);
if (processModel !== 'in-process' && processModel !== 'supervised-process') {
    throw new Error('Expected a mutation process model.');
}
if (fresh !== 'true' && fresh !== 'false') {
    throw new Error('Expected a fresh-state boolean.');
}
await using cleanup = new AsyncDisposableStack();
const clean = await performMutationLifecycle(
    function registerDisposal(dispose) {
        cleanup.defer(dispose);
    },
    processModel,
    fresh === 'true'
);
process.stdout.write(JSON.stringify(clean));
