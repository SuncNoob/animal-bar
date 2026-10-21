import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

// Dev-only helper: POST a canvas data URL to /__snap?name=x and it is saved as snaps/x.jpg.
// Lets us review frames even when the preview window is not being composited.
const snapDir = fileURLToPath(new URL('./snaps/', import.meta.url));

export default {
  plugins: [{
    name: 'tiaohai-snap',
    apply: 'serve',
    async configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '');
      if (env.VITE_MQTT_URL === '/api/mqtt' && (env.REDIS_URL || env.KV_URL)) {
        const { createMqttServer } = await import('./server/mqtt.js');
        const mqtt = createMqttServer({
          redisUrl: env.REDIS_URL || env.KV_URL, room: env.VITE_ROOM || 'dev',
        });
        server.middlewares.use('/api/mqtt', (req, res) => mqtt.emit('request', req, res));
        server.httpServer.on('upgrade', (req, socket, head) => {
          if (req.url.split('?')[0] === '/api/mqtt') mqtt.emit('upgrade', req, socket, head);
        });
        server.httpServer.once('close', () => { void mqtt.closeMqtt(); });
      }
      server.middlewares.use('/__snap', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'snap').replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || 'snap';
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const b64 = Buffer.concat(chunks).toString().replace(/^data:image\/\w+;base64,/, '');
          fs.mkdirSync(snapDir, { recursive: true });
          const file = snapDir + name + '.jpg';
          fs.writeFileSync(file, Buffer.from(b64, 'base64'));
          res.end(file);
        });
      });
    },
  }],
};
