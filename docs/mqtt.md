# Networking

All multiplayer traffic is MQTT 3.1.1 over WebSocket. The browser client is `src/net.js`:

| Topic | QoS | Retained | What |
| --- | --- | --- | --- |
| `tiaohai/v1/rooms/<room>/ev` | 0 / 1 | no | events: positions (10/s per player), chat, bumps, dice, … |
| `tiaohai/v1/rooms/<room>/state/jukebox` · `disco` · `orders` · `bike` | 1 | yes | shared objects late joiners need at once |

`VITE_MQTT_URL` picks the transport (see `.env.example`):

- **unset**: local mode. No server; tabs of one browser share a room through `BroadcastChannel`.
- **any MQTT broker** with WebSocket support (EMQX, Mosquitto, HiveMQ…): set the `ws://` / `wss://` URL and,
  if the broker needs them, `VITE_MQTT_USER` / `VITE_MQTT_PASS`. These end up in the page, so give that user
  rights on `tiaohai/#` only. An `https` page needs a `wss://` broker.
- **`/api/mqtt`**: the broker in this repo.

## The bundled broker (`server/mqtt.js`, `api/mqtt.js`)

An [Aedes](https://github.com/moscajs/aedes) broker behind a WebSocket endpoint, with Redis for retained state
and for relaying messages between instances. It is meant to run as a Vercel Function (`vercel.json`) but works
anywhere Node can accept WebSocket upgrades.

- Only this room's event topic and the four state objects are allowed, with payload and rate limits, clean
  MQTT 3.1.1 sessions and same-origin WebSocket upgrades. It is a game room, not a general relay.
- Messages are delivered to clients on the same instance straight away; Redis only carries them to the other
  instances (and the echo back is dropped), so position updates never wait on Redis.
- Vercel Functions have a maximum duration (800 s in `vercel.json`); the client reconnects, re-subscribes and
  reloads retained state on its own.
- Pick the function region (`vercel.json` → `regions`) close to where your players' traffic enters Vercel;
  the `/api/mqtt` health check returns the region and a `Server-Timing: redis;dur=…` header.

Configuration (Vercel project or `.env.local`):

| Variable | Example | |
| --- | --- | --- |
| `VITE_MQTT_URL` | `/api/mqtt` | browser |
| `VITE_ROOM` / `MQTT_ROOM` | `main` | must match |
| `REDIS_URL` | `rediss://…` | server only, never `VITE_` |

`npm run dev` serves the same broker on the Vite port when `VITE_MQTT_URL=/api/mqtt` and `REDIS_URL` are set
(use another room, e.g. `VITE_ROOM=dev`, so local testing stays out of the live room).

Integration test against a real Redis (uses a throwaway room and cleans up):

```sh
npm run test:mqtt
```
