import { fileURLToPath } from 'node:url';
import { table, suite, test } from '@overkill-dev/test';

import {
    runNativeProject,
    runMatrixTypeProject,
    runPrefixedTypeProject,
    runChangedTypeProject,
    runCompiledTypeProject
} from '../../../../test-support/native-type-project.ts';

const basicCases = `const nodes=[
engine.createTestCase({...metadata,title:'pass',body(scope){
    bodyCalls++;scope.assert(same<string,string>());return scope.assert.collect();
}}),
engine.createTestCase({...metadata,title:'fail',body(scope){
    bodyCalls++;scope.assert.annotated('Wrong inferred type')(same<string,number>());return scope.assert.collect();
}})
];`;

const sharedCases = `function generic<T extends string>() {
    return test('generic',scope=>{
        bodyCalls++;scope.assert(assignableTo<T,string>());return scope.assert.collect();
    });
}

const parameterized=defineParameterizedTestBody((scope,data:number)=>{
    bodyCalls++;scope.assert(same<typeof data,number>());return scope.assert.collect();
});
const macro=defineMacro(()=>test('macro',scope=>{
    bodyCalls++;scope.assert(same<string,string>());return scope.assert.collect();
}));
const nodes=[generic<'literal'>(),macro(),test('parameterized',parameterized(1)),table({
    title:'rows',cases:[1,2],test:scope=>{
        bodyCalls++;scope.assert(same<typeof scope.parameters,number>());return scope.assert.collect();
    }
})];`;

const bindingCases = `const nodes=[test('bindings',scope=>{
    bodyCalls++;
    const value='literal' as const;
    scope.assert(same.withActual<'literal'>(),value);
    scope.assert(same.withExpected<'literal'>(),value);
    scope.assert(same.expressions,value,value);
    scope.assert(same.not<string,number>());
    scope.assert(assignableFrom<string,'literal'>());
    return scope.assert.collect();
})];`;

export const testNode = suite('native type-test adapter', [
    test('checks original assertion sources behind compiled callbacks', async function (scope) {
        const result = await runCompiledTypeProject(scope.cleanup, basicCases, null);
        scope.assert.equal(result.summary.passed, 1, { message: result.errors.join('\n') });
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('deduplicates installed selections without duplicating logical cases', async function (scope) {
        const result = await runMatrixTypeProject(scope.cleanup, basicCases);
        scope.assert.equal(result.summary.passed, 1, { message: result.errors.join('\n') });
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.logicalCaseCount, 2);
        scope.assert.deepEqual(
            Array.from(new Set(result.compilerVersions)).toSorted(function (left, right) {
                return left.localeCompare(right);
            }),
            [ '7.1.0-beta' ]
        );
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('preserves hashbangs and leading compiler directives', async function (scope) {
        const result = await runPrefixedTypeProject(
            scope.cleanup,
            basicCases,
            '#!/usr/bin/env node\n/// <reference types="node" />\n'
        );
        scope.assert.equal(result.summary.passed, 1, { message: result.errors.join('\n') });
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test(
        'preserves imports used only by type assertions with unused checks enabled',
        async function (scope) {
            const referencePath = fileURLToPath(
                new URL('../../../../packages/type-test/type-test.entry-point.ts', import.meta.url)
            );
            const definitions = `import {sameType as onlyInline} from ${JSON.stringify(referencePath)};
        void [same,assignableTo,assignableFrom,suite,table,defineMacro,defineParameterizedTestBody,
            defineResource,withResource,family,prepareCompilerPlan,metadata];
        const nodes=[test('unused imports',scope=>{
            scope.assert(onlyInline<string,string>());return scope.assert.collect();
        })];
        const {readFile,writeFile}=await import('node:fs/promises');
        const projectPath=import.meta.dirname+'/tsconfig.json';
        const configuration=JSON.parse(await readFile(projectPath,'utf8'));
        configuration.compilerOptions.noUnusedLocals=true;
        await writeFile(projectPath,JSON.stringify(configuration));`;
            const result = await runNativeProject(scope.cleanup, definitions, null);
            scope.assert.equal(result.status, 'passed', {
                message: [ ...result.errors, ...result.diagnostics ].join('\n')
            });
            scope.assert.equal(result.summary.passed, 1);
            return scope.assert.collect();
        }
    ),
    test('rejects scope forwarding through shorthand properties', async function (scope) {
        const definitions = `const nodes=[test('forwarded scope',scope=>{
            const box={scope};box.scope.assert.true(false);
            scope.assert(same<string,string>());return scope.assert.collect();
        })];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.includes(result.errors.join('\n'), 'Scope forwarding');
        return scope.assert.collect();
    }),
    test('rejects reassigned function declarations', async function (scope) {
        const definitions = `function body(scope:engine.TestScope){
            scope.assert(same<string,string>());return scope.assert.collect();
        }
        ({body}={body:scope=>{scope.assert(same<string,number>());return scope.assert.collect();}});
        const nodes=[test('reassigned',body)];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.equal(result.summary.inconclusive, 1);
        scope.assert.includes(result.errors.join('\n'), 'cannot be reassigned');
        return scope.assert.collect();
    }),
    test('rejects destructured aliases that can mutate table bodies', async function (scope) {
        const definitions = `const body:engine.TestBody=scope=>{
            scope.assert(same<string,string>());return scope.assert.collect();
        };
        const options={...metadata,title:'rows',cases:[{...metadata,title:'row',parameters:1,body},
            {...metadata,title:'other',parameters:2,body}]};
        const {cases}=options;
        cases[0]!.body=scope=>{scope.assert(same<string,number>());return scope.assert.collect();};
        const nodes=[engine.createTable(options)];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.includes(result.errors.join('\n'), 'escape static source ownership');
        return scope.assert.collect();
    }),
    test('rejects named options mutated before construction', async function (scope) {
        const definitions = `const original:engine.TestBody=scope=>{
            scope.assert(same<string,string>());return scope.assert.collect();
        };
        const options={...metadata,title:'mutated',body:original};
        options.body=scope=>{scope.assert(same<string,number>());return scope.assert.collect();};
        const nodes=[engine.createTestCase(options)];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.includes(result.errors.join('\n'), 'may be mutated');
        return scope.assert.collect();
    }),
    test('preserves native errors in expression operands', async function (scope) {
        const definitions = `const nodes=[test('expression error',scope=>{
            const value={present:1};
            scope.assert(same.withActual<number>(),value.missing);
            return scope.assert.collect();
        })];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.includes([ ...result.errors, ...result.diagnostics ].join('\n'), 'missing');
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('resolves transparent syntax throughout callback aliases', async function (scope) {
        const definitions = `const original:engine.TestBody=scope=>{
            scope.assert(same<string,string>());return scope.assert.collect();
        };
        const alias=(original satisfies engine.TestBody);
        const wrapped=alias as engine.TestBody;
        const define=test;
        const nodes=[define('transparent',wrapped)];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.status, 'passed', { message: result.errors.join('\n') });
        return scope.assert.collect();
    }),
    test('rejects options whose callback is overwritten by a spread', async function (scope) {
        const definitions = `const first:engine.TestBody=scope=>{
            scope.assert(same<string,string>());return scope.assert.collect();
        };
        const overrides={body:((scope:engine.TestScope)=>{
            scope.assert(same<string,number>());return scope.assert.collect();
        })};
        const nodes=[engine.createTestCase({...metadata,title:'overridden',body:first,...overrides})];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.includes(result.errors.join('\n'), 'potentially overriding');
        return scope.assert.collect();
    }),
    test('checks engine roots with original diagnostics and never invokes bodies', async function (scope) {
        const result = await runNativeProject(scope.cleanup, basicCases, null);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.bodyCalls, 0);
        scope.assert.equal(result.artifactCount, 1);
        scope.assert.includes(result.diagnostics.join('\n'), 'Wrong inferred type');
        scope.assert.equal(
            result.compilerVersions.every(function concrete(version) {
                return /^\d+\.\d+\.\d+/u.test(version);
            }),
            true
        );
        return scope.assert.collect();
    }),
    test('excludes unselected failing bodies', async function (scope) {
        const result = await runNativeProject(scope.cleanup, basicCases, [ 'pass' ]);
        scope.assert.equal(result.status, 'passed');
        scope.assert.deepEqual(result.titles, [ 'pass' ]);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('keeps shared table and generic macro evidence under original constraints', async function (scope) {
        const result = await runNativeProject(scope.cleanup, sharedCases, null);
        scope.assert.equal(result.status, 'passed', { message: result.errors.join('\n') });
        scope.assert.equal(result.summary.passed, 5);
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('supports type, expression, and negated relations', async function (scope) {
        const result = await runNativeProject(scope.cleanup, bindingCases, null);
        scope.assert.equal(result.status, 'passed', {
            message: [ ...result.errors, ...result.diagnostics ].join('\n')
        });
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('retains low-level table case ownership with unknown supplied locations', async function (scope) {
        const definitions = `const nodes=[engine.createTable({...metadata,title:'low rows',cases:[
    {...metadata,title:'first',parameters:1,body(scope){
        scope.assert(same<string,string>());return scope.assert.collect();
    }},
    {...metadata,title:'second',parameters:2,body(scope){
        scope.assert(same<string,number>());return scope.assert.collect();
    }}
]})];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.summary.passed, 1, { message: result.errors.join('\n') });
        scope.assert.equal(result.summary.failed, 1);
        return scope.assert.collect();
    }),
    test('resolves immutable options and shorthand callback declarations', async function (scope) {
        const definitions = `const body=(scope:engine.TestScope)=>{
    scope.assert(same<string,string>());return scope.assert.collect();
};
const options={...metadata,title:'named',body};
const nodes=[engine.createTestCase(options)];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.summary.passed, 1, { message: result.errors.join('\n') });
        return scope.assert.collect();
    }),
    test('rejects nested assertion boundaries instead of omitting their evidence', async function (scope) {
        const definitions = `const nodes=[test('nested',scope=>{
    scope.assert(same<string,string>());
    function nested(){scope.assert(same<string,number>());}
    nested();return scope.assert.collect();
})];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.includes(result.errors.join('\n'), 'Nested native assertion');
        return scope.assert.collect();
    }),
    test('rejects runtime case controls for static execution', async function (scope) {
        const definitions = `const nodes=[test({title:'controlled',controls:{timeoutMilliseconds:1},body:scope=>{
    scope.assert(same<string,string>());return scope.assert.collect();
}})];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.includes(result.errors.join('\n'), 'runtime execution controls');
        return scope.assert.collect();
    }),
    table({
        title: 'rejects changes after collection',
        cases: [ 'source', 'config' ] as const,
        caseTitle(change) {
            return change;
        },
        async test(scope) {
            const change = scope.parameters;

            const result = await runChangedTypeProject(scope.cleanup, basicCases, change);
            scope.assert.equal(result.status, 'failed');
            scope.assert.equal(result.summary.passed, 0);
            scope.assert.includes(result.errors.join('\n'), 'changed after collection');
            return scope.assert.collect();
        }
    }),
    test('rejects detached runtime assertion methods', async function (scope) {
        const definitions = `const nodes=[test('detached',scope=>{
    const runtime=scope.assert;runtime.true(false);
    scope.assert(same<string,string>());return scope.assert.collect();
})];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.includes(result.errors.join('\n'), 'Detached assertion methods');
        return scope.assert.collect();
    }),
    test('distinguishes unrelated shadowed scope parameters', async function (scope) {
        const definitions = `const nodes=[test('shadowed',scope=>{
    function unrelated(scope:{assert(value:boolean):void}){scope.assert(true);}
    scope.assert(same<string,string>());return scope.assert.collect();
})];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.status, 'passed', { message: result.errors.join('\n') });
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('rejects runtime resources before static checking', async function (scope) {
        const definitions = `const resource=defineResource({name:'never',scope:'per-case',requirements:[],
    acquire():{value:number}{throw new Error('Do not acquire');},dispose:null});
const nodes=[test('wrapped',withResource(resource,scope=>{
    bodyCalls++;scope.assert(same<typeof scope.resources.never.value,number>());return scope.assert.collect();
}))];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.includes(result.errors.join('\n'), 'does not support resources');
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('rejects compiler identities inconsistent with frozen inputs', async function (scope) {
        const result = await runChangedTypeProject(scope.cleanup, basicCases, 'identity');
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.includes(result.errors.join('\n'), 'Family selection contains an unknown or duplicate work ID.');
        return scope.assert.collect();
    }),
    test('revalidates frozen inputs immediately before prepared execution', async function (scope) {
        const definitions = `const nodes=[test('late',scope=>{
    scope.assert(same<string,string>());return scope.assert.collect();
})];
const settings={projectConfigPath:import.meta.dirname+'/tsconfig.json',
    compiler:{kind:'package',specifier:'typescript-beta',version:'7.1.0-beta'}};
const existing=engine.createRoot({title:'existing',annotations:{},controls:{},children:nodes});
const preparation=await prepareCompilerPlan(engine.createTestPlan(existing),settings,import.meta.dirname);
await using lifetime=new AsyncDisposableStack();
lifetime.defer(()=>preparation.dispose());
const collected=await preparation.collect(preparation.testPlan);
const lowered=await collected.lower();
const {appendFile}=await import('node:fs/promises');
await appendFile(settings.projectConfigPath,'\\n');
await lowered.execute();`;
        await scope.assert.rejects(async function changedAfterLowering() {
            await runNativeProject(scope.cleanup, definitions, null);
        }, { message: /configuration changed after collection/u });
        return scope.assert.collect();
    }),
    test('rejects mixed runtime assertions', async function (scope) {
        const definitions = `const nodes=[test('mixed',scope=>{
    scope.assert(same<string,string>());scope.assert.true(true);return scope.assert.collect();
})];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.includes(result.errors.join('\n'), 'Unsupported runtime operation');
        return scope.assert.collect();
    }),
    test('retains intentional skips and fails selected empty bodies', async function (scope) {
        const definitions = `const nodes=[
    engine.createSkippedTestCase({...metadata,title:'skip',reason:'deliberate'}),
    test('empty',scope=>scope.assert.collect())
];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.summary.skipped, 1);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.summary.passed, 0);
        return scope.assert.collect();
    })
]);
