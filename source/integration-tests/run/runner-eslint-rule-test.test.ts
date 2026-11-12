import { extname } from 'node:path';
import { execFile } from 'node:child_process';
import { runIfMain } from '#test-runner';
import { createTestCase } from '../../packages/engine/engine.entry-point.ts';

const extension = extname(import.meta.url);
const adapterModule = new URL(
    `../../packages/eslint-rule-test/eslint-rule-test.entry-point${extension}`,
    import.meta.url
);
const engineModule = new URL(`../../packages/engine/engine.entry-point${extension}`, import.meta.url);
const adapterUrl = adapterModule.href;
const engineUrl = engineModule.href;

const script = `
const {defineRuleTests} = await import(process.argv[1]);
const {createRoot, createTestPlan, execute} = await import(process.argv[2]);
const parser = await import(process.argv[3]);
const rule = {meta: {schema: []}, create() {return {};}};
const cases = defineRuleTests({name: 'no filesystem', rule, configs: {}, valid: ['value'],
 invalid: [{code: 'value', errors: 1}]}).examples();
const typed = defineRuleTests({name: 'typed', rule, configs: {ts: {languageOptions: {parser}}},
 valid: [{code: 'const value: number = 1;', filename: 'rule-test.ts'}], invalid: []}).examples();
const plan = createTestPlan(createRoot({title: 'restricted', annotations: {}, controls: {}, children: [cases, typed]}));
process.permission.drop('fs.read');
const result = await execute(plan);
if (result.summary.passed !== 2 || result.summary.failed !== 1 || result.runnerErrors.length !== 0) {
 throw new Error(JSON.stringify(result));
}
console.log('restricted ESLint examples passed');
`;

export const testNode = createTestCase({
    title: 'ESLint passing and failing examples need no filesystem capability',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    async body(scope) {
        const output = await new Promise<string>(function restrictedChild(resolve, reject) {
            execFile(process.execPath, [
                '--permission',
                '--allow-fs-read=*',
                '--input-type=module',
                '--eval',
                script,
                adapterUrl,
                engineUrl,
                import.meta.resolve('@typescript-eslint/parser')
            ], function completed(error, stdout, stderr) {
                if (error === null) {
                    resolve(stdout);
                } else {
                    reject(new Error(stderr, { cause: error }));
                }
            });
        });
        scope.assert.equal(output.trim(), 'restricted ESLint examples passed');
        return scope.assert.collect();
    }
});

await runIfMain(import.meta, testNode);
