import { execFile } from 'node:child_process';
import { consumerEnvironment } from './support/consumer-environment.ts';
import { packageConsumer } from './support/package-consumer.ts';

const script = `
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { overkillPlugin as plugin } from '@overkill-dev/eslint-plugin';

const { Linter } = await import(${JSON.stringify(import.meta.resolve('eslint'))});
const { default: ts } = await import(${JSON.stringify(import.meta.resolve('typescript'))});
const parser = await import(${JSON.stringify(import.meta.resolve('@typescript-eslint/parser'))});

const code = [
    "import { test, wrap, composite, wrapComposite } from './barrel.js';",
    "test('forward', scope => { consume(scope.assert); return scope.assert.collect(); });",
    "test('clean', scope => { consume('data'); return scope.assert.collect(); });",
    "declare function consume(value: unknown): void;",
    "wrap(scope => { consume(scope); return scope.assert.collect(); });",
    "const isOk = composite({ name: 'ok', assert: (check, status: number) => check.equal(status, 200) });",
    "test('composite', scope => { scope.assert(isOk, 200); return scope.assert.collect(); });",
    "const wrapped = wrapComposite({ name: 'wrapped', assert: (check, status: number) => check.equal(status, 200) });",
    "test('wrapped composite', scope => { scope.assert(wrapped, 200); return scope.assert.collect(); });"
].join('\\n');
writeFileSync('package.json', JSON.stringify({ type: 'module' }));
writeFileSync('facade.ts', [
    "import { createTestFacade, type TestBody } from '@overkill-dev/test';",
    "export const { test } = createTestFacade();",
    "export function wrap(body: TestBody) { return test('wrapped', body); }"
].join('\\n'));
writeFileSync('barrel.ts', [
    "export { test, wrap } from './facade.js';",
    "export { defineCompositeAssertion as composite } from '@overkill-dev/assert';",
    "import { defineCompositeAssertion } from '@overkill-dev/assert';",
    "export const wrapComposite: typeof defineCompositeAssertion = definition => defineCompositeAssertion(definition);"
].join('\\n'));
writeFileSync('consumer.ts', code);
writeFileSync('config.ts', [
    "import { overkillPlugin } from '@overkill-dev/eslint-plugin';",
    "export const rule = overkillPlugin.rules['no-scope-escape'];",
    "export const compositeRule = overkillPlugin.rules['no-single-use-trivial-assertion'];"
].join('\\n'));
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
const compositeRule = 'overkill/no-single-use-trivial-assertion';
const settings = { plugins: { overkill: plugin }, rules: { [rule]: 'error', [compositeRule]: 'error' } };
const syntaxDiagnostics = linter.verify(
    "import { test } from '@overkill-dev/test'; test('escape', scope => scope.assert);",
    [settings]
);
if (syntaxDiagnostics.length !== 1 || syntaxDiagnostics[0].ruleId !== rule) {
    throw new Error(JSON.stringify(syntaxDiagnostics));
}
const syntaxComposite = linter.verify([
    "import * as assert from '@overkill-dev/assert';",
    "import { test } from '@overkill-dev/test';",
    "const isOk = assert.defineCompositeAssertion({ name: 'ok',",
    "    assert: (check, status) => check.equal(status, 200) });",
    "test('composite', scope => scope.assert(isOk, 200));"
].join('\\n'), [settings]);
if (syntaxComposite.length !== 1 || syntaxComposite[0].ruleId !== compositeRule || syntaxComposite[0].line !== 3) {
    throw new Error(JSON.stringify(syntaxComposite));
}
const diagnostics = linter.verify(code, [{
    ...settings,
    files: ['**/*.ts'],
    languageOptions: { parser, parserOptions: { programs: [program] } }
}], { filename });
if (diagnostics.length !== 2 || diagnostics[0].ruleId !== rule || diagnostics[0].line !== 2 ||
    diagnostics[1].ruleId !== compositeRule || diagnostics[1].line !== 6) {
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
            [ '--disable-warning=PERM0004', '--input-type=module', '--eval', script ],
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
