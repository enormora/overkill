export const strykerSandboxScript = `
{
const { default: assert } = await import('node:assert/strict');
const { mkdir, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');
const originalRoot = process.cwd();
const { strykerPlugins } = await import(process.argv[1]);
const [plugin] = strykerPlugins;
const configPath = join(originalRoot, 'policy.mjs');
const testPath = join(originalRoot, 'case.test.mjs');
const subjectPath = join(originalRoot, 'subject.mjs');
await writeFile(configPath, 'throw new Error("original config evaluated");');
await writeFile(testPath, 'throw new Error("original test evaluated");');
await writeFile(subjectPath, 'throw new Error("original subject evaluated");');
const root = join(originalRoot, '.stryker-tmp', 'sandbox');
await mkdir(root, { recursive: true });
await writeFile(join(root, 'policy.mjs'), 'export const config = {profiles:{microtest:{' +
    'testFamily:"microtest", files:{include:["case.test.mjs"]}}}};');
await writeFile(join(root, 'case.test.mjs'), 'throw new Error("test imported during initialization");');
process.chdir(root);
const runner = (targets) => plugin.factory({overkill:{configPath}}, {
    [configPath]: {mutate:targets.includes('config')},
    [testPath]: {mutate:targets.includes('test')},
    [subjectPath]: {mutate:true}
});
for (const [target, role] of [['config','configuration'], ['test','test definitions']]) {
    const rejected = runner([target]);
    await assert.rejects(rejected.init(), {name:'ConfigError', message:new RegExp('Exclude ' + role)});
    await rejected.dispose();
}
const accepted = runner([]);
await accepted.init();
await accepted.init();
await accepted.dispose();
await writeFile(join(root, 'policy.mjs'), 'import ' + JSON.stringify(subjectPath) + '; export const config = {};');
const escaping = runner([]);
await assert.rejects(escaping.init(), (error) => error.name === 'ConfigError' &&
    error.cause instanceof Error && /Module import escapes/.test(error.cause.message));
await escaping.dispose();
process.chdir(originalRoot);
}
`;
