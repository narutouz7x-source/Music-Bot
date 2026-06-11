# B4 Music Bot

A Discord music bot that joins voice channels and plays audio from YouTube using slash commands.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + Discord bot (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- Required env: `DISCORD_TOKEN` — Discord bot token (from Discord Developer Portal)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Discord: discord.js v14, @discordjs/voice
- Audio streaming: play-dl (YouTube), opusscript (audio encoding)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/bot/` — all bot logic
  - `client.ts` — Discord client setup and event handling
  - `commands.ts` — all slash command definitions and handlers
  - `player.ts` — per-guild audio player (queue processing, volume, pause/resume)
  - `queue.ts` — music queue data structure
  - `register.ts` — slash command registration via REST API

## Commands

| Command | Description |
|---|---|
| `/play <query>` | Play a YouTube URL or search for a song |
| `/pause` | Pause playback |
| `/resume` | Resume paused playback |
| `/skip` | Skip to the next song |
| `/stop` | Stop playback and clear the queue |
| `/queue` | Show the current queue |
| `/nowplaying` | Show the currently playing track |
| `/volume [0-100]` | Get or set the volume |
| `/leave` | Disconnect the bot from voice |

## Architecture decisions

- Bot and Express API server run in the same Node.js process for simplicity.
- Slash commands are registered globally on bot startup (can take up to 1 hour to propagate to all servers on first deploy).
- `play-dl` is used instead of `ytdl-core` for more reliable YouTube streaming.
- `opusscript` (pure JS) is used instead of `@discordjs/opus` (native) since the NixOS environment cannot compile native modules.
- One `GuildPlayer` instance per guild, stored in memory (resets on restart).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Slash commands may take up to 1 hour to appear in Discord after first registration (Discord global propagation).
- The bot needs the `bot` and `applications.commands` OAuth2 scopes when inviting to a server.
- Required bot permissions: Connect, Speak, Use Voice Activity.
- `opusscript` is significantly slower than native opus — fine for most use cases but may have higher CPU usage under load.
