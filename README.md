# 动物酒馆 · Animal Bar

A cozy multiplayer browser game: a little Beijing hutong bar run by animals. Pick an animal, chat with whoever
is around, queue songs on the jukebox, play liar's dice at the tables, let the cat pick you a beer, ride the
yard's bicycle, bump people into the lagoon, jump off the diving board, and flip the main light switch for
disco (big waves: surf!), Halloween or lights out.

一个可以多人一起玩的网页小游戏：北京胡同里一家动物开的小酒馆。选个动物进门，和在场的人聊天、点歌、
吹牛骰子、让团团帮你选酒、骑院子里的自行车、把人撞进湖里、上跳板起飞，再拉一下灯光总闸：蹦迪（还能冲浪）、
万圣、熄灯。

- Three.js, no game engine; the yard, lagoon, plants and signs are generated in code
- Real-time multiplayer over MQTT (any broker, or the bundled Vercel + Redis one), or local mode with no server
- 中文 / English, switchable in game
- Phones and desktops (joystick + buttons, or WASD / Space / Shift / E)

## Run it

```sh
npm install
npm run dev
```

Open the printed URL. With no configuration the game runs in **local mode**: open it in two tabs of the same
browser and they share a room. For real multiplayer, copy `.env.example` to `.env.local` and point
`VITE_MQTT_URL` at a broker — see [docs/mqtt.md](docs/mqtt.md).

```sh
npm run build      # static site in dist/ (plus api/ for Vercel)
```

### Deploy

- **Vercel**: import the repo, add an Upstash Redis integration (gives `REDIS_URL`), set `VITE_MQTT_URL=/api/mqtt`
  and `VITE_ROOM=main`. The broker runs as a Vercel Function.
- **Any static host + your own MQTT broker**: `npm run build`, serve `dist/`, and set `VITE_MQTT_URL` (plus
  user/password) at build time.
- `VITE_LANG=zh` makes Chinese the default for new players (otherwise English).

## Code map

| | |
| --- | --- |
| `src/main.js` | entry, input, player movement, actions, multiplayer glue, main loop |
| `src/world.js`, `src/layout.js` | the yard's walkable area, colliders, all coordinates |
| `src/scene/*` | architecture, furniture, the lagoon (`water.js`), plants, bike, springboard, lights, characters |
| `src/net.js` | MQTT / local transport; `server/mqtt.js` the bundled broker |
| `src/jukebox*.js` | shared jukebox: one retained state, everyone derives "now playing" from the clock |
| `src/dice/*` | liar's dice (Canton rules) for the tables |
| `src/mood.js` | 团团的怪问题 / Tuantuan's odd questions: a little quiz that picks you a drink |
| `src/i18n.js` | `L('中文', 'English')` — strings live next to the code |
| `src/dev/adversary.js` | dev-only bot that stress-tests movement and collisions (`__adv.run()` in the console) |

## Contributing

Issues and pull requests are welcome. Keep new assets free to share (see [ASSETS.md](ASSETS.md)) — no
commercial music or third-party logos.

## License

Code: [MIT](LICENSE). Character models and portraits: CC BY 4.0. House music: CC0. Details in [ASSETS.md](ASSETS.md).
