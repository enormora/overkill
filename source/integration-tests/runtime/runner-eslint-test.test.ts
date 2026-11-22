import { extname } from 'node:path';
import { execFile } from 'node:child_process';
import { test } from '@overkill-dev/test';

const extension = extname(import.meta.url);
const adapterModule = new URL(
    `../../packages/eslint-test/eslint-test.entry-point${extension}`,
    import.meta.url
);
const engineModule = new URL(`../../packages/engine/engine.entry-point${extension}`, import.meta.url);
const adapterUrl = adapterModule.href;
const engineUrl = engineModule.href;

const script = `
const {defineRuleTests, defineConfigTests} = await import(process.argv[1]);
const {createRoot, createTestPlan, execute} = await import(process.argv[2]);
const parser = await import(process.argv[3]);
const rule = {meta: {schema: []}, create() {return {};}};
const cases = defineRuleTests({name: 'no filesystem', rule, configs: {}, valid: ['value'],
 invalid: [{code: 'value', errors: 1}]}).examples();
const typed = defineRuleTests({name: 'typed', rule, configs: {ts: {languageOptions: {parser}}},
 valid: [{code: 'const value: number = 1;', filename: 'rule-test.ts'}], invalid: []}).examples();
const configs = defineConfigTests({name: 'no filesystem inventory', configs: {base: [{rules: {'no-debugger': 'off'}}]},
 project: {kind: 'existing', root: '/unavailable'}, files: [], fixtures: [], generation: [],
 inventories: [{title: 'core', configs: 'all', target: {kind: 'declared'}, completeness: 'all', deprecated: 'allow',
 exclusions: [], catalog: {kind: 'rules', rules: [{ruleId: 'no-debugger', deprecated: false}]}}]}).checks();
const denied = defineConfigTests({name: 'denied project', configs: {base: []},
 project: {kind: 'virtual', files: {}, dependencies: {kind: 'none'}}, inventories: [], files: [], generation: [],
 fixtures: [{title: 'file', configs: 'all', source: {kind: 'inline', filename: 'file.js', code: ''},
 expect: {kind: 'lint', diagnostics: {kind: 'clean'}}}]}).fixtures();
const plan = createTestPlan(createRoot({title: 'restricted', annotations: {}, controls: {},
 children: [cases, typed, configs]}));
process.permission.drop('fs.read');
const result = await execute(plan);
if (result.summary.passed !== 3 || result.summary.failed !== 1 || result.runnerErrors.length !== 0) {
 throw new Error(JSON.stringify(result));
}
const deniedResult = await execute(createTestPlan(createRoot({title: 'denied', annotations: {}, controls: {},
 children: [denied]})));
if (deniedResult.summary.runtimePolicy !== 1 || deniedResult.summary.failed !== 0) {
 throw new Error(JSON.stringify(deniedResult));
}
console.log('restricted ESLint examples passed');
`;

export const testNode = test(
    'ESLint passing and failing examples need no filesystem capability',
    async function (scope) {
        const output = await new Promise<string>(function restrictedChild(resolve, reject) {
            execFile(process.execPath, [
                '--disable-warning=PERM0004',
                '--permission',
                '--no-permission-audit',
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
);
