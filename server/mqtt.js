import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Aedes } from 'aedes';
import persistenceRedis from 'aedes-persistence-redis';
import mqemitterRedis from 'mqemitter-redis';
import Redis from 'ioredis';
import { WebSocketServer, createWebSocketStream } from 'ws';

// Latency: deliver to this instance's clients straight away and let Redis only carry the message to the other
// instances (its echo back here is dropped by origin). QoS 0 traffic (positions, ~10/s per player) also stops
// waiting for the Redis publish, so the function can sit next to the edge even when Redis is a region away.
function localFirst(mq) {
  const origin = randomUUID(), deliver = mq._emit.bind(mq), relay = mq.emit.bind(mq);
  mq._emit = (msg, cb) => { if (msg.origin === origin) cb?.(); else deliver(msg, cb); };
  mq.emit = (msg, done = () => {}) => {
    deliver(msg);
    if (msg.qos > 0 || msg.retain) relay({ ...msg, origin }, done);
    else { relay({ ...msg, origin }); done(); }
  };
  return mq;
}

// This is a public game room, not a general-purpose MQTT relay. Redis credentials
// stay on the server; clients can only use this room's events and shared objects.
export function createMqttServer({
  redisUrl = process.env.REDIS_URL || process.env.KV_URL,
  room = process.env.MQTT_ROOM || 'main',
} = {}) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(room)) throw new Error('Invalid MQTT_ROOM');
  const eventTopic = `tiaohai/v1/rooms/${room}/ev`;
  const stateRoot = `tiaohai/v1/rooms/${room}/state/`;
  const stateTopics = new Set(['jukebox', 'disco', 'orders', 'bike'].map(name => stateRoot + name));
  let brokerPromise;
  let broker;
  let redisConnections = [];
  const sockets = new Set();
  const healthy = () => broker && redisConnections.every(conn => conn.status === 'ready');
  const logError = () => console.error('MQTT storage unavailable');

  function validPublish(client, packet) {
    if (packet.qos > 1 || packet.payload.length > 65536) return false;
    let value;
    try { value = JSON.parse(packet.payload.toString()); } catch { return false; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    // A surviving instance can deliver a crashed instance's stored last will.
    if (!client) {
      return /^tiaohai\/v1\/rooms\/[a-zA-Z0-9_-]+\/ev$/.test(packet.topic) &&
        !packet.retain && packet.qos === 0 && value.t === 'bye' && typeof value.id === 'string';
    }
    if (packet.topic === eventTopic) {
      return !packet.retain && packet.payload.length <= 8192 &&
        value.id === client.id.slice(3) && typeof value.t === 'string' && value.t.length <= 40;
    }
    return stateTopics.has(packet.topic) && packet.retain && packet.qos === 1;
  }

  async function startBroker() {
    if (!redisUrl) throw new Error('REDIS_URL is required');
    const options = {
      lazyConnect: true, connectTimeout: 8000, maxRetriesPerRequest: 1,
      retryStrategy: times => Math.min(times * 500, 5000),
    };
    const connections = Array.from({ length: 3 }, () => new Redis(redisUrl, options));
    redisConnections = connections;
    connections.forEach(conn => {
      conn.on('error', logError);
      // Fail visibly and let clients reconnect instead of showing a split room.
      conn.on('close', () => { for (const ws of sockets) ws.terminate(); });
    });
    try {
      await Promise.all(connections.map(conn => conn.connect()));
      const mq = localFirst(mqemitterRedis({ pubConn: connections[1], subConn: connections[2] }));
      mq.state.on('error', logError);
      const persistence = persistenceRedis({
        conn: connections[0], maxSessionDelivery: 100, packetTTL: () => 60,
      });
      persistence.on('error', logError);
      const instance = new Aedes({
        mq, persistence, connectTimeout: 10000, drainTimeout: 10000,
        maxTopicLevels: 8, maxInflightInbound: 8, keepaliveLimit: 60,
        preConnect(client, packet, done) {
          const valid = packet.protocolVersion === 4 && packet.clean &&
            /^th_[a-zA-Z0-9_-]{1,80}$/.test(packet.clientId) &&
            packet.keepalive >= 10 && packet.keepalive <= 60;
          const willClient = { id: packet.clientId };
          const willValid = !packet.will || (packet.will.topic === eventTopic &&
            packet.will.qos === 0 && validPublish(willClient, packet.will) &&
            JSON.parse(packet.will.payload.toString()).t === 'bye');
          if (!valid || !willValid) return done(new Error('Connection denied'), false);
          done(null, true);
        },
        authorizePublish(client, packet, done) {
          if (!healthy() || !validPublish(client, packet)) return done(new Error('Publish denied'));
          if (client) {
            const now = Date.now();
            const rate = client.gameRate ||= { at: now, tokens: 60 };
            rate.tokens = Math.min(60, rate.tokens + (now - rate.at) * 0.03);
            rate.at = now;
            if (rate.tokens < 1) return done(new Error('Rate limit'));
            rate.tokens--;
          }
          done(null);
        },
        authorizeSubscribe(client, subscription, done) {
          const allowed = subscription.topic === eventTopic ||
            subscription.topic === stateRoot + '+' || stateTopics.has(subscription.topic);
          if (!healthy() || !allowed || subscription.qos > 1) return done(null, null);
          done(null, subscription);
        },
      });
      instance.on('error', logError);
      instance.on('clientError', () => {});
      instance.on('connectionError', () => {});
      await instance.listen();
      broker = instance;
      return instance;
    } catch (error) {
      connections.forEach(conn => conn.disconnect());
      throw error;
    }
  }

  function getBroker() {
    brokerPromise ||= startBroker().catch(error => {
      brokerPromise = undefined;
      throw error;
    });
    return brokerPromise;
  }

  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    try {
      await getBroker();
      if (!healthy()) throw new Error('Not ready');
      const pingStarted = performance.now();
      await redisConnections[0].ping();
      res.setHeader('Server-Timing', `redis;dur=${(performance.now() - pingStarted).toFixed(1)}`);
      res.writeHead(200);
      res.end(JSON.stringify({ service: 'animal-bar-mqtt', online: true, region: process.env.VERCEL_REGION || 'local' }));
    } catch {
      res.writeHead(503);
      res.end(JSON.stringify({ service: 'animal-bar-mqtt', online: false }));
    }
  });
  const wss = new WebSocketServer({
    noServer: true, maxPayload: 131072, perMessageDeflate: false,
    handleProtocols: protocols => protocols.has('mqtt') ? 'mqtt' : false,
  });
  server.on('upgrade', async (req, socket, head) => {
    const reject = status => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    let origin;
    try { origin = new URL(req.headers.origin); } catch { return reject('403 Forbidden'); }
    if (origin.host !== req.headers.host || !['https:', 'http:'].includes(origin.protocol)) {
      return reject('403 Forbidden');
    }
    if (req.url.split('?')[0] !== '/api/mqtt') return reject('404 Not Found');
    if (sockets.size >= 100) return reject('503 Service Unavailable');
    try {
      const instance = await getBroker();
      if (socket.destroyed) return;
      if (!healthy()) return reject('503 Service Unavailable');
      wss.handleUpgrade(req, socket, head, ws => {
        sockets.add(ws);
        ws.on('error', () => {});
        ws.once('close', () => sockets.delete(ws));
        // Bound incomplete MQTT packets across multiple WebSocket messages too.
        let bytes = 0;
        const window = setInterval(() => { bytes = 0; }, 1000);
        window.unref();
        ws.on('message', data => { bytes += data.length; if (bytes > 262144) ws.terminate(); });
        ws.once('close', () => clearInterval(window));
        instance.handle(createWebSocketStream(ws), req);
      });
    } catch {
      reject('503 Service Unavailable');
    }
  });
  // Used by local development and integration tests for a clean shutdown.
  server.closeMqtt = async () => {
    for (const ws of sockets) ws.terminate();
    if (broker) await new Promise(resolve => broker.close(resolve));
    redisConnections.forEach(conn => conn.disconnect());
    wss.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  };
  return server;
}
