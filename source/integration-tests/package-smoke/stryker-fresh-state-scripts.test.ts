export const strykerFreshStateScript = `
{
const { default: assert } = await import('node:assert/strict');
const { fork } = await import('node:child_process');
const { mkdir, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const { orchestrator, normalizeConfig, parseRunResult } = await import(process.argv[1]);
const { strykerValidationSchema } = await import(process.argv[3]);
const adapter = process.argv[3];
const host = new URL('./mutation-invocation-process.entry-point.js', adapter);
const cwd = join(process.cwd(), 'fresh-host');
await mkdir(cwd, {recursive:true});
const engine = process.argv[2];
const seed = strykerValidationSchema.properties.overkill.default.seed;
assert.match(seed, /^(?:0|[1-9][0-9]*)$/);
await writeFile(join(cwd, 'state.cjs'),
    'const counts = new Map(); exports.enter = (id) => {' +
    'const value = (counts.get(id) ?? 0) + 1; counts.set(id,value); return value; };');
await writeFile(join(cwd, 'nested.mjs'), 'export {default as state} from "./state.cjs";');
await writeFile(join(cwd, 'case.test.mjs'),
    'import {createSuite,createTestCase} from ' + JSON.stringify(engine) + ';' +
    'import {state} from "./nested.mjs";' +
    'const data = {annotations:{},controls:{},definitionLocations:[{kind:"unknown"}]};' +
    'export const testNode = createSuite({...data,title:"fresh",children:Array.from({length:32},(_,id)=>' +
    'createTestCase({...data,title:"case"+id+"x".repeat(8192),body(scope){' +
    'scope.assert.equal(state.enter(id),1);return scope.assert.collect();}}))});');
const config = normalizeConfig({profiles:{microtest:{
    testFamily:'microtest',files:{include:['case.test.mjs']},
    execution:{processModel:'in-process',scheduling:'serial'},
    timeouts:{collectionMilliseconds:30000}
}}});
const request = {
    baselineUpdateMode:'none',capabilityRestrictions:{mode:'enabled'},capture:'buffered',coverage:false,
    debug:{mode:'off',selectors:[]},execution:{mode:'serial'},measureProcessUsage:null,order:'seeded',
    paths:[],profile:'microtest',processBudgetOverrides:null,processUsageSamplingIntervalMilliseconds:null,
    seed:{value:BigInt(seed)},selection:{kind:'all'},shard:{index:1,total:1},timingCollection:'profile-default',
    verbose:false,workers:null
};
const policy = await orchestrator.freezePolicy({
    moduleBoundary:null,source:{kind:'memory'},command:{config,cwd,request,engine:{kind:'default'}}
});
async function invocation(value, selection) {
    const child = fork(fileURLToPath(host), ['--overkill-mutation-invocation'], {
        cwd, serialization:'advanced',execArgv:[],stdio:['ignore','ignore','inherit','ipc']
    });
    const closed = new Promise(resolve=>child.once('close',resolve));
    try {
        return await new Promise((resolve,reject)=>{
            child.once('error',reject);
            child.once('exit',()=>reject(new Error('Host exited without result')));
            child.once('message',message=>{
                if(message.kind==='failure')reject(new Error(message.failure.message));
                else {try {resolve(parseRunResult(message.result));}catch(error){reject(error);}}
            });
            child.send({kind:'run',policy,seed:{value:BigInt(value)},selection},error=>{if(error)reject(error);});
        });
    } finally {
        child.kill('SIGKILL');
        await closed;
        assert.throws(()=>process.kill(child.pid,0));
    }
}
for (const value of [seed, '900719925474099312345']) {
    const first = await invocation(value,{kind:'all'});
    const second = await invocation(value,{kind:'all'});
    assert.equal(first.status,'passed');
    assert.equal(second.status,'passed');
    assert.equal(first.summary.passed,32);
    assert.ok(JSON.stringify(first).length>100000);
    assert.deepEqual(first.perTest.map(test=>test.id),second.perTest.map(test=>test.id));
    const selected = await invocation(value,{kind:'filter',filter:{kind:'case-id',id:first.perTest[0].id}});
    assert.equal(selected.status,'passed');
    assert.equal(selected.perTest.length,1);
    assert.deepEqual(selected.perTest[0].id,first.perTest[0].id);
}
}
`;
