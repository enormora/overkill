import { fileURLToPath } from 'node:url';
import { runIfMain } from '#test-runner';
import { suite, test } from '../test/test.entry-point.ts';
import {
    runNativeProject,
    runPrefixedTypeProject,
    runCompiledTypeProject,
    runChangedTypeProject
} from '../../test-support/native-type-project.ts';

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

const bindingCases = `type Limited<T extends string>={value:T};
const nodes=[test('bindings',scope=>{
    bodyCalls++;
    const value='literal' as const;
    scope.assert(same.withActual<'literal'>(),value);
    scope.assert(same.withExpected<'literal'>(),value);
    scope.assert(same.expressions,value,value);
    scope.assert(same.not<string,number>());
    scope.assert(assignableFrom<string,'literal'>());
    scope.assert(callableWith<(value:string)=>number>(),'value');
    scope.assert(callableWith.not.withActual,(value:string)=>value,42);
    scope.assert(constructableWith<new(value:string)=>object>(),'value');
    scope.assert(instantiableWith<Limited<_>,[string]>());
    scope.assert(hasProperty<{value:string}>(),'value');
    scope.assert(raisesTypeError<Limited<42>>());
    return scope.assert.collect();
})];`;

const declarationCases = `function decorate<T extends abstract new(...args:never[])=>object>(
    value:T, context:ClassDecoratorContext<T>
):T { return value; }
function Component(props:{name:string}) { return null; }
const nodes=[test('declarations',scope=>{
    bodyCalls++;
    scope.assert(acceptsProps<typeof Component>(),{name:'ok'});
    scope.assert(applicableTo<typeof decorate>(),apply=>{
        @apply class Subject { value=1; }
    });
    scope.assert(applicableTo.withActual(decorate),apply=>{
        @apply class Other { other=2; }
    });
    return scope.assert.collect();
})];`;

export const testNode = suite('native type-test adapter', [
    test('preserves hashbangs and leading compiler directives', async function (scope) {
        const result = await runPrefixedTypeProject(
            scope,
            basicCases,
            '#!/usr/bin/env node\n/// <reference types="node" />\n'
        );
        scope.assert.equal(result.summary.passed, 1, { message: result.errors.join('\n') });
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('preserves type-only JSX subjects and explicit generic instantiations', async function (scope) {
        const definitions = `export function Component<T extends string>(props:{value:T}){return null;}
        import type {Component as TypeOnlyComponent} from './cases.js';
        function generic<T extends string>(value:T){
            return test('generic props',scope=>{
                bodyCalls++;scope.assert(acceptsProps<typeof TypeOnlyComponent<T>>(),{value:value});
                return scope.assert.collect();
            });
        }
        const nodes=[generic('text'),test('type only',scope=>{
            bodyCalls++;scope.assert(acceptsProps<typeof TypeOnlyComponent>(),{value:'text'});
            return scope.assert.collect();
        }),test('wrong props',scope=>{
            bodyCalls++;scope.assert(acceptsProps<typeof TypeOnlyComponent<'fixed'>>(),{value:'other'});
            return scope.assert.collect();
        })];`;
        const result = await runCompiledTypeProject(scope, definitions, null);
        scope.assert.equal(result.summary.passed, 2, {
            message: [ ...result.errors, ...result.diagnostics ].join('\n')
        });
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(result.diagnostics.join('\n'), 'fixed');
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('preserves imports used only by translated assertions with unused checks enabled', async function (scope) {
        const referencePath = fileURLToPath(new URL('./type-test.entry-point.ts', import.meta.url));
        const definitions = `import {sameType as onlyInline} from ${JSON.stringify(referencePath)};
        export type Placeholder = _;
        void [same,assignableTo,assignableFrom,acceptsProps,applicableTo,callableWith,constructableWith,
            instantiableWith,hasProperty,raisesTypeError,suite,table,defineMacro,defineParameterizedTestBody,
            defineResource,withResource,typeTestAdapter,metadata];
        const nodes=[test('unused imports',scope=>{
            scope.assert(onlyInline<string,string>());return scope.assert.collect();
        })];
        const {readFile,writeFile}=await import('node:fs/promises');
        const projectPath=import.meta.dirname+'/tsconfig.json';
        const configuration=JSON.parse(await readFile(projectPath,'utf8'));
        configuration.compilerOptions.noUnusedLocals=true;
        await writeFile(projectPath,JSON.stringify(configuration));`;
        const result = await runNativeProject(scope, definitions, null);
        scope.assert.equal(result.status, 'passed', {
            message: [ ...result.errors, ...result.diagnostics ].join('\n')
        });
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('rejects scope forwarding through shorthand properties', async function (scope) {
        const definitions = `const nodes=[test('forwarded scope',scope=>{
            const box={scope};box.scope.assert.true(false);
            scope.assert(same<string,string>());return scope.assert.collect();
        })];`;
        const result = await runNativeProject(scope, definitions, null);
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
        const result = await runNativeProject(scope, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
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
        const result = await runNativeProject(scope, definitions, null);
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
        const result = await runNativeProject(scope, definitions, null);
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
        const result = await runNativeProject(scope, definitions, null);
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
        const result = await runNativeProject(scope, definitions, null);
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
        const result = await runNativeProject(scope, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.includes(result.errors.join('\n'), 'potentially overriding');
        return scope.assert.collect();
    }),
    test('checks engine roots with original diagnostics and never invokes bodies', async function (scope) {
        const result = await runNativeProject(scope, basicCases, null);
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
        const result = await runNativeProject(scope, basicCases, [ 'pass' ]);
        scope.assert.equal(result.status, 'passed');
        scope.assert.deepEqual(result.titles, [ 'pass' ]);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('keeps shared table and generic macro evidence under original constraints', async function (scope) {
        const result = await runNativeProject(scope, sharedCases, null);
        scope.assert.equal(result.status, 'passed', { message: result.errors.join('\n') });
        scope.assert.equal(result.summary.passed, 5);
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('supports type, expression, negated, and ability references', async function (scope) {
        const result = await runNativeProject(scope, bindingCases, null);
        scope.assert.equal(result.status, 'passed', {
            message: [ ...result.errors, ...result.diagnostics ].join('\n')
        });
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('checks JSX and decorator declarations through ordinary precompiled source maps', async function (scope) {
        const result = await runCompiledTypeProject(scope, declarationCases, null);
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
        const result = await runNativeProject(scope, definitions, null);
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
        const result = await runNativeProject(scope, definitions, null);
        scope.assert.equal(result.summary.passed, 1, { message: result.errors.join('\n') });
        return scope.assert.collect();
    }),
    test('rejects nested assertion boundaries instead of omitting their evidence', async function (scope) {
        const definitions = `const nodes=[test('nested',scope=>{
    scope.assert(same<string,string>());
    function nested(){scope.assert(same<string,number>());}
    nested();return scope.assert.collect();
})];`;
        const result = await runNativeProject(scope, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.includes(result.errors.join('\n'), 'Nested native assertion');
        return scope.assert.collect();
    }),
    test('rejects runtime case controls for static execution', async function (scope) {
        const definitions = `const nodes=[test({title:'controlled',controls:{timeoutMilliseconds:1},body:scope=>{
    scope.assert(same<string,string>());return scope.assert.collect();
}})];`;
        const result = await runNativeProject(scope, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.includes(result.errors.join('\n'), 'runtime execution controls');
        return scope.assert.collect();
    }),
    ...([ 'source', 'config' ] as const).map(function changedInput(change) {
        return test(`rejects ${change} changes after collection`, async function (scope) {
            const result = await runChangedTypeProject(scope, basicCases, change);
            scope.assert.equal(result.status, 'failed');
            scope.assert.equal(result.summary.passed, 0);
            scope.assert.includes(result.errors.join('\n'), 'changed after collection');
            return scope.assert.collect();
        });
    }),
    test('rejects checker assertions outside native boundaries', async function (scope) {
        const definitions = `import {expect as foreign} from 'tstyche';
const nodes=[test('foreign',scope=>{
    scope.assert(same<string,string>());foreign<string>().type.toBe<number>();return scope.assert.collect();
})];`;
        const result = await runNativeProject(scope, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.includes(result.errors.join('\n'), 'without native source ownership');
        return scope.assert.collect();
    }),
    test('rejects detached runtime assertion methods', async function (scope) {
        const definitions = `const nodes=[test('detached',scope=>{
    const runtime=scope.assert;runtime.true(false);
    scope.assert(same<string,string>());return scope.assert.collect();
})];`;
        const result = await runNativeProject(scope, definitions, null);
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
        const result = await runNativeProject(scope, definitions, null);
        scope.assert.equal(result.status, 'passed', { message: result.errors.join('\n') });
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('keeps resource scope types without acquiring resources', async function (scope) {
        const definitions = `const resource=defineResource({name:'never',scope:'per-case',requirements:[],
    acquire():{value:number}{throw new Error('Do not acquire');},dispose:null});
const nodes=[test('wrapped',withResource(resource,scope=>{
    bodyCalls++;scope.assert(same<typeof scope.resources.never.value,number>());return scope.assert.collect();
}))];`;
        const result = await runNativeProject(scope, definitions, null);
        scope.assert.equal(result.status, 'passed', { message: result.errors.join('\n') });
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('rejects compiler identities inconsistent with frozen inputs', async function (scope) {
        const result = await runChangedTypeProject(scope, basicCases, 'identity');
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.includes(result.errors.join('\n'), 'Compiler work identity does not match');
        return scope.assert.collect();
    }),
    test('revalidates frozen inputs immediately before prepared execution', async function (scope) {
        const definitions = `const nodes=[test('late',scope=>{
    scope.assert(same<string,string>());return scope.assert.collect();
})];
const settings={projectConfigPath:import.meta.dirname+'/tsconfig.json',compiler:{kind:'local'}};
const existing=engine.createRoot({title:'existing',annotations:{},controls:{},children:nodes});
const backend=await typeTestAdapter.load();
const plan=await backend.prepare(engine.createTestPlan(existing),settings);
const collected=await backend.collect(plan,settings);
const lowered=await collected.lower();
const {appendFile}=await import('node:fs/promises');
await appendFile(settings.projectConfigPath,'\\n');
await lowered.execute();`;
        await scope.assert.rejects(async function changedAfterLowering() {
            await runNativeProject(scope, definitions, null);
        }, { message: /configuration changed after collection/u });
        return scope.assert.collect();
    }),
    test('rejects decorator aliases instead of omitting their checks', async function (scope) {
        const definitions = declarationCases.replace(
            '@apply class Subject { value=1; }',
            'const box={apply}; @apply class Subject { value=1; } @box.apply class Extra {}'
        );
        const result = await runCompiledTypeProject(scope, definitions, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.includes(result.errors.join('\n'), 'Decorator parameter forwarding is unsupported');
        return scope.assert.collect();
    }),
    test('rejects mixed runtime assertions', async function (scope) {
        const definitions = `const nodes=[test('mixed',scope=>{
    scope.assert(same<string,string>());scope.assert.true(true);return scope.assert.collect();
})];`;
        const result = await runNativeProject(scope, definitions, null);
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
        const result = await runNativeProject(scope, definitions, null);
        scope.assert.equal(result.summary.skipped, 1);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.summary.passed, 0);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
