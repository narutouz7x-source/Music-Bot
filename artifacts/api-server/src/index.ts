import app from "./app.js";
import { logger } from "./lib/logger.js";
import { createBotClient } from "./bot/client.js";
import { registerCommands } from "./bot/register.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const token = process.env["DISCORD_TOKEN"];
const botEnabled = process.env["BOT_ENABLED"] === "true";

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

if (!botEnabled) {
  logger.info("BOT_ENABLED is not set — bot will not start (set BOT_ENABLED=true on Render to enable)");
} else {
  if (!token) {
    throw new Error("DISCORD_TOKEN environment variable is required when BOT_ENABLED=true.");
  }
  void startBot();
}

const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

async function startBot(attempt = 1): Promise<void> {
  const delay = Math.min(RECONNECT_DELAY_MS * attempt, MAX_RECONNECT_DELAY_MS);

  try {
    const client = createBotClient();

    client.once("ready", async (readyClient) => {
      const clientId = readyClient.user.id;
      try {
        await registerCommands(clientId, token!);
      } catch (err) {
        logger.error({ err }, "Failed to register slash commands");
      }
    });

    client.on("shardError", (err) => {
      logger.error({ err }, "Shard error");
    });

    client.on("invalidated", () => {
      logger.error("Session invalidated — token may be invalid");
    });

    client.on("error", (err) => {
      logger.error({ err }, "Discord client error");
    });

    await client.login(token);
    logger.info({ attempt }, "Bot logged in successfully");

    client.once("shardDisconnect", async (_, shardId) => {
      logger.warn({ shardId }, "Shard disconnected — scheduling reconnect");
      client.destroy();
      await sleep(delay);
      void startBot(1);
    });

  } catch (err) {
    logger.error({ err, attempt }, "Bot login failed — retrying");
    await sleep(delay);
    void startBot(attempt + 1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
