# FoldDeck

**Drop a folder. FoldDeck detects what it is. Press Start.**

FoldDeck is a local-first desktop dashboard that detects, runs, monitors, and audits web apps, bots, workers, game servers, and Docker stacks from a folder.

- Next.js / Vite app → Start and open URL
- Static HTML → Serve instantly
- Python server → Run locally
- Minecraft server → Start with logs
- Discord Bot → Start and monitor
- Docker Compose → Start stack
- Env files → Edit safely
- Packages → Install, inspect, audit


## Tech Stack

- [Tauri](https://tauri.app/) (Rust backend)
- React + TypeScript (frontend)

## Development

```sh
pnpm install
pnpm tauri dev
```

## Custom Recipes

Detection can be extended with YAML recipes in `<app-data>/FoldDeck/recipes/*.yaml`.
A matching recipe overrides project classification; package manager, scripts and
env detection still run.

```yaml
id: my-bot
name: My Bot Framework
kind: bot            # web-app | static-site | backend-server | bot | worker | game-server
subtype: discord
runtime: node
priority: 90         # higher wins
detect:
  any:
    - packageDependency: my-bot-lib
    - file: mybot.config.js
    - envKey: MY_BOT_TOKEN
run:
  fallback:
    - node mybot.js  # used when no package.json script applies
defaultPort: 9000
```

## License

MIT
