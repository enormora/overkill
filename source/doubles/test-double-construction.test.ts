import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { rule } from './double-rule.ts';
import { testDouble } from './test-double.ts';

type ClientWithId = {
    readonly id: string;
};

registerTest('construction rules can call custom answers', function () {
    type ClientConstructor = new (id: string) => ClientWithId;

    const Client = testDouble<ClientConstructor>({
        rules: [
            rule.whenConstructedWith('client').calls(function createClient(...values: readonly unknown[]) {
                return { id: String(values[0]) };
            })
        ]
    });

    assert.deepEqual(Reflect.construct(Client, [ 'client' ]), { id: 'client' });
});

registerTest('construction rules can sequence answers', function () {
    type ClientConstructor = new (id: string) => ClientWithId;

    const firstClient = { id: 'first' };
    const secondClient = { id: 'second' };
    const Client = testDouble<ClientConstructor>({
        rules: [
            rule.whenConstructedWith('ignored').sequence([
                rule.constructs(firstClient),
                rule.constructs(secondClient)
            ])
        ]
    });

    assert.equal(Reflect.construct(Client, [ 'ignored' ]), firstClient);
    assert.equal(Reflect.construct(Client, [ 'ignored' ]), secondClient);
});

registerTest('construction rules can throw', function () {
    type ClientConstructor = new () => ClientWithId;

    const error = new Error('expected');
    const Client = testDouble<ClientConstructor>({
        rules: [ rule.onConstruction(0).throws(error) ]
    });

    assert.throws(function constructThrownClient() {
        Reflect.construct(Client, []);
    }, error);
});

registerTest('constructor doubles throw TypeError when no behavior can answer', function () {
    type ClientConstructor = new (id: string) => ClientWithId;

    const Client = testDouble<ClientConstructor>({
        rules: [ rule.whenConstructedWith('known').constructs({ id: 'known' }) ]
    });

    assert.throws(function constructUnknownClient() {
        Reflect.construct(Client, [ 'unknown' ]);
    }, /no configured behavior/u);
});

registerTest('constructor doubles reject primitive behavior answers', function () {
    type ClientConstructor = new () => ClientWithId;

    const Client = testDouble<ClientConstructor>({
        answer() {
            return 'invalid' as unknown as ClientWithId;
        }
    });

    assert.throws(function constructPrimitiveAnswer() {
        Reflect.construct(Client, []);
    }, /constructor behavior must return an object instance/u);
    assert.equal(Client.firstConstruction?.instance, null);
    assert.equal(Client.firstResult?.status, 'threw');
});
