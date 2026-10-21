import { createMqttServer } from '../server/mqtt.js';

// Vercel owns the HTTP listener and upgrades. Do not call listen() here.
export default createMqttServer();
