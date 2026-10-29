export const strykerFreshStateScript = `
{
const { default: assert } = await import('node:assert/strict');
const { mkdir, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');
const { pathToFileURL } = await import('node:url');
const { orchestrator, normalizeConfig, restoreRunExecutionFailure } = await import(process.argv[1]);
const { strykerValidationSchema } = await import(process.argv[3]);
const cwd = join(process.cwd(), 'fresh-host');
await mkdir(cwd, {recursive:true});
const engine = process.argv[2];
const lifecycle = join(cwd, 'lifecycle.mjs');
await writeFile(lifecycle,
    'class Lifecycle { #selection; #completed = 0; #entered = 0;' +
    'constructor(selection) {this.#selection = selection;} async select() {return this.#selection;}' +
    'async beforeCases() {this.#completed = 0; this.#entered = 0;} async enterCase() {this.#entered++;}' +
    'async completeCase() {this.#completed++; return "continue";}' +
    'snapshot() {return {pid:process.pid,completed:this.#completed,entered:this.#entered};}' +
    'async dispose() {this.#completed = -1;} }' +
    'export async function createLifecycle(selection) {return new Lifecycle(selection);}');
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
    baselineUpdateMode:'none',capabilityRestrictions:{mode:'enabled'},capture:'buffered',coverage:false,record:false,
    debug:{mode:'off',selectors:[]},execution:{mode:'serial'},measureProcessUsage:null,order:'seeded',
    paths:[],profile:'microtest',processBudgetOverrides:null,processUsageSamplingIntervalMilliseconds:null,
    seed:{value:BigInt(seed)},selection:{kind:'all'},shard:{index:1,total:1},timingCollection:'profile-default',
    verbose:false,workers:null
};
const policy = await orchestrator.freezePolicy({
    moduleBoundary:null,source:{kind:'memory'},command:{config,cwd,request,engine:{kind:'default'}}
});
async function invocation(value, selection) {
    const session = orchestrator.createExecutionSession({
        command: {kind:'frozen-policy',policy,
            invocation:{seed:{value:BigInt(value)},selection:{kind:'all'}},
            reporting:{outputRenderer:config.outputRenderer,reporters:[]}},
        lifecycle:{moduleUrl:pathToFileURL(lifecycle).href,exportName:'createLifecycle'},environment:'fresh-invocation'
    });
    try {
        const reply = await session.run({data:selection,timeoutMilliseconds:30000,signal:null});
        if(reply.kind==='failure')throw restoreRunExecutionFailure(reply.failure);
        assert.equal(reply.kind,'result');
        assert.equal(reply.data.completed,reply.result.perTest.length);
        assert.equal(reply.data.entered,reply.result.perTest.length);
        assert.throws(()=>process.kill(reply.data.pid,0));
        return reply.result;
    } finally {
        await session.dispose();
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
