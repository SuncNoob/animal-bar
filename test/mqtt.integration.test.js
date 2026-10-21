import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mqtt from 'mqtt';
import Redis from 'ioredis';
import { createMqttServer } from '../server/mqtt.js';

const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
test('shared Redis: delivery, retained state, restart, reconnect and room boundaries',
  { skip: !redisUrl, timeout: 120000 }, async () => {
    const room = 'qa_' + randomUUID().replaceAll('-', '');
    const root = `tiaohai/v1/rooms/${room}/`;
    const servers = [];
    const clients = [];
    const states = ['jukebox', 'disco', 'orders', 'bike'];
    const cleanup = new Redis(redisUrl);
    cleanup.on('error', () => {});
    async function start() {
      const server = createMqttServer({ redisUrl, room });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      servers.push(server);
      return `ws://127.0.0.1:${server.address().port}/api/mqtt`;
    }
    function makeClient(url, id, extra = {}) {
      const client = mqtt.connect(url, {
        clientId: 'th_' + id, clean: true, keepalive: 20,
        reconnectPeriod: 0, connectTimeout: 20000,
        wsOptions: { origin: url.replace('ws:', 'http:').replace('/api/mqtt', '') },
        ...extra,
      });
      client.on('error', () => {});
      clients.push(client);
      return client;
    }
    function once(client, event, timeout = 20000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { client.off(event, done); reject(new Error('Timeout: ' + event)); }, timeout);
        function done(...args) { clearTimeout(timer); resolve(args); }
        client.once(event, done);
      });
    }
    function message(client, topic, nonce) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { client.off('message', receive); reject(new Error('Message timeout: ' + topic)); }, 15000);
        function receive(gotTopic, payload, packet) {
          if (gotTopic !== topic) return;
          const value = JSON.parse(payload);
          if (value.nonce !== nonce) return;
          clearTimeout(timer); client.off('message', receive); resolve({ value, packet });
        }
        client.on('message', receive);
      });
    }
    try {
      const [urlA, urlB] = await Promise.all([start(), start()]);
      const alice = makeClient(urlA, 'alice');
      const bob = makeClient(urlB, 'bob');
      await Promise.all([once(alice, 'connect'), once(bob, 'connect')]);
      await bob.subscribeAsync({ [root + 'ev']: { qos: 1 }, [root + 'state/+']: { qos: 1 } });
      for (const qos of [0, 1]) {
        const nonce = randomUUID();
        const incoming = message(bob, root + 'ev', nonce);
        await alice.publishAsync(root + 'ev', JSON.stringify({ id: 'alice', t: qos ? 'chat' : 'pos', nonce }), { qos });
        assert.equal((await incoming).packet.qos, qos);
      }
      const retainedNonce = randomUUID();
      for (const name of states) {
        const incoming = message(bob, root + 'state/' + name, retainedNonce);
        await alice.publishAsync(root + 'state/' + name, JSON.stringify({ v: 1, nonce: retainedNonce }), { qos: 1, retain: true });
        await incoming;
      }
      const late = makeClient(urlB, 'late');
      await once(late, 'connect');
      const retained = states.map(name => message(late, root + 'state/' + name, retainedNonce));
      await late.subscribeAsync(root + 'state/+', { qos: 1 });
      assert.ok((await Promise.all(retained)).every(item => item.packet.retain));

      // Simulate platform disconnect, then re-subscribe on the same MQTT client.
      bob.options.reconnectPeriod = 200;
      const connectedAgain = once(bob, 'connect');
      bob.stream.destroy();
      await connectedAgain;
      const restored = message(bob, root + 'state/bike', retainedNonce);
      await bob.subscribeAsync(root + 'state/+', { qos: 1 });
      assert.equal((await restored).packet.retain, true);
      bob.options.reconnectPeriod = 0;

      await assert.rejects(bob.subscribeAsync('#'));
      await assert.rejects(bob.subscribeAsync('tiaohai/v1/rooms/main/ev'));
      const badPublish = makeClient(urlA, 'badpublish');
      await once(badPublish, 'connect');
      const denied = once(badPublish, 'close');
      badPublish.publish(root + 'ev', JSON.stringify({ id: 'alice', t: 'chat' }));
      await denied;
      const badConnect = makeClient(urlB, 'badconnect', { clean: false });
      await once(badConnect, 'close');

      await Promise.all(clients.map(client => client.endAsync(true)));
      await Promise.all(servers.map(server => server.closeMqtt()));
      const urlC = await start();
      const fresh = makeClient(urlC, 'fresh');
      await once(fresh, 'connect');
      const afterRestart = states.map(name => message(fresh, root + 'state/' + name, retainedNonce));
      await fresh.subscribeAsync(root + 'state/+', { qos: 1 });
      assert.ok((await Promise.all(afterRestart)).every(item => item.packet.retain));
      await fresh.endAsync();
      const unhealthy = createMqttServer({ redisUrl: '', room });
      await new Promise(resolve => unhealthy.listen(0, '127.0.0.1', resolve));
      servers.push(unhealthy);
      const response = await fetch(`http://127.0.0.1:${unhealthy.address().port}/api/mqtt`);
      assert.equal(response.status, 503);
    } finally {
      await Promise.all(clients.map(client => client.endAsync(true)));
      await Promise.all(servers.map(server => server.closeMqtt()));
      await cleanup.hdel('retained', ...states.map(name => root + 'state/' + name));
      cleanup.disconnect();
    }
  });
