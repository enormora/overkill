import { execFile } from 'node:child_process';
import { consumerEnvironment } from './support/consumer-environment.ts';
import { packageConsumer } from './support/package-consumer.ts';

const script = `
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Linter } from 'eslint';
import plugin from '@overkill-dev/eslint-plugin';
import ts from 'typescript';

const parser = await import(process.argv[1]);

const code = [
    "import { test, wrap } from './barrel.js';",
    "test('forward', scope => { consume(scope.assert); return scope.assert.collect(); });",
    "test('clean', scope => { consume('data'); return scope.assert.collect(); });",
    "declare function consume(value: unknown): void;",
    "wrap(scope => { consume(scope); return scope.assert.collect(); });"
].join('\\n');
writeFileSync('package.json', JSON.stringify({ type: 'module' }));
writeFileSync('facade.ts', [
    "import { createTestFacade, type TestBody } from '@overkill-dev/test';",
    "export const { test } = createTestFacade();",
    "export function wrap(body: TestBody) { return test('wrapped', body); }"
].join('\\n'));
writeFileSync('barrel.ts', "export { test, wrap } from './facade.js';");
writeFileSync('consumer.ts', code);
writeFileSync('config.ts', "import plugin from '@overkill-dev/eslint-plugin'; export const rule = plugin.rules['no-scope-escape'];");
const compiler = {
    module: ts.ModuleKind.NodeNext,
    target: ts.ScriptTarget.ESNext,
    strict: true,
    skipLibCheck: true,
    types: []
};
const filename = resolve('consumer.ts');
const program = ts.createProgram([filename, resolve('config.ts')], compiler);
const errors = ts.getPreEmitDiagnostics(program);
if (errors.length !== 0) throw new Error(JSON.stringify(errors.map(error => error.messageText)));
const linter = new Linter();
const rule = 'overkill/no-scope-escape';
const settings = { plugins: { overkill: plugin }, rules: { [rule]: 'error' } };
const syntaxDiagnostics = linter.verify(
    "import { test } from '@overkill-dev/test'; test('escape', scope => scope.assert);",
    [settings]
);
if (syntaxDiagnostics.length !== 1 || syntaxDiagnostics[0].ruleId !== rule) {
    throw new Error(JSON.stringify(syntaxDiagnostics));
}
const diagnostics = linter.verify(code, [{
    ...settings,
    files: ['**/*.ts'],
    languageOptions: { parser, parserOptions: { programs: [program] } }
}], { filename });
if (diagnostics.length !== 1 || diagnostics[0].ruleId !== rule || diagnostics[0].line !== 2) {
    throw new Error(JSON.stringify(diagnostics));
}
console.log('Packed ESLint plugin passed');
`;

const { test } = packageConsumer('loads and types the packed ESLint plugin', function (consumerDirectory) {
    return { consumerDirectory };
});

export const testNode = test('loads and types the packed ESLint plugin', async function (scope) {
    const { consumerDirectory } = scope.resources.consumer;
    const output = await new Promise<string>(function runConsumer(resolve, reject) {
        execFile(
            process.execPath,
            [ '--disable-warning=PERM0004', '--input-type=module', '--eval', script, import.meta.resolve('@typescript-eslint/parser') ],
            { env: consumerEnvironment(consumerDirectory), cwd: consumerDirectory },
            function completed(error, stdout, stderr) {
                if (error === null) {
                    resolve(stdout);
                } else {
                    reject(new Error(stderr, { cause: error }));
                }
            }
        );
    });
    scope.assert.equal(output.trim(), 'Packed ESLint plugin passed');
    return scope.assert.collect();
});
