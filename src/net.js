import mqtt from 'mqtt';

// Both transports expose: send(m), onmessage(m), onstatus(online), online,
// and shared "retained" state: setState(name, obj) / onstate(name, obj) — the broker keeps the last value
// so late joiners get it immediately (used by the jukebox).
// LocalNet = same-browser tabs (offline/dev fallback). MqttNet = MQTT over WebSocket.
export class LocalNet {
  constructor() {
    this.kind = 'local'; this.online = true; this.onstatus = () => {};
    this.bc = new BroadcastChannel('tiaohai-room-v1');
    this.bc.onmessage = (e) => { if (e.data?.__state) this.onstate?.(e.data.__state, e.data.obj); else this.onmessage && this.onmessage(e.data); };
    this.onstate = null;
  }
  send(m) { this.bc.postMessage(m); return true; }
  setState(name, obj) { try { localStorage.setItem('tiaohai.state.' + name, JSON.stringify(obj)); } catch {} this.bc.postMessage({ __state: name, obj }); return true; }
  loadState(name) { try { const v = localStorage.getItem('tiaohai.state.' + name); if (v) this.onstate?.(name, JSON.parse(v)); } catch {} }
}

export class MqttNet {
  constructor({ url, user, pass, room, me }) {
    this.kind = 'mqtt'; this.online = false; this.onstatus = () => {};
    this.topic = `tiaohai/v1/rooms/${room}/ev`;
    this.stateRoot = `tiaohai/v1/rooms/${room}/state/`; this.onstate = null;
    this.c = mqtt.connect(url, {
      username: user, password: pass, clientId: `th_${me.id}`, clean: true, keepalive: 20,
      reconnectPeriod: 2000, connectTimeout: 20000, resubscribe: false, queueQoSZero: false,
      will: { topic: this.topic, qos: 0, retain: false, payload: JSON.stringify({ t: 'bye', id: me.id, nick: me.nick }) },
    });
    this.c.on('connect', () => {
      // Every reconnect may reach a new Vercel instance. Re-subscribe to reload
      // retained state, and only report online once both subscriptions succeed.
      this.c.subscribe({ [this.topic]: { qos: 1 }, [this.stateRoot + '+']: { qos: 1 } }, (error, granted) => {
        if (error || granted?.length !== 2 || granted.some(sub => sub.qos === 128)) {
          down();
          this.c.stream?.destroy();
          return;
        }
        if (this.c.connected) { this.online = true; this.onstatus(true); }
      });
    });
    const down = () => { if (this.online) { this.online = false; this.onstatus(false); } };
    this.c.on('close', down); this.c.on('offline', down); this.c.on('error', down);
    this.c.on('message', (topic, buf) => {
      try {
        const obj = JSON.parse(buf.toString());
        if (topic.startsWith(this.stateRoot)) this.onstate?.(topic.slice(this.stateRoot.length), obj);
        else this.onmessage && this.onmessage(obj);
      } catch {}
    });
  }
  send(m) {
    if (!this.online) return false;
    // chat/rename are the ones a person would notice losing → QoS 1; presence/position are disposable → QoS 0
    const reliable = m.t === 'chat' || m.t === 'rename' || m.t === 'join';
    this.c.publish(this.topic, JSON.stringify(m), { qos: reliable ? 1 : 0, retain: false });
    return true;
  }
  setState(name, obj) { if (!this.online) return false; this.c.publish(this.stateRoot + name, JSON.stringify(obj), { qos: 1, retain: true }); return true; }
  loadState() {} // retained values arrive on subscribe
}

export function createNet(me) {
  const configured = import.meta.env.VITE_MQTT_URL;
  if (!configured) return new LocalNet();
  const endpoint = new URL(configured, location.href);
  if (endpoint.protocol === 'https:') endpoint.protocol = 'wss:';
  if (endpoint.protocol === 'http:') endpoint.protocol = 'ws:';
  const url = endpoint.href;
  if (location.protocol === 'https:' && url.startsWith('ws://')) { console.warn('ws:// blocked on https page; using local mode'); return new LocalNet(); }
  return new MqttNet({ url, user: import.meta.env.VITE_MQTT_USER, pass: import.meta.env.VITE_MQTT_PASS, room: import.meta.env.VITE_ROOM || 'main', me });
}
