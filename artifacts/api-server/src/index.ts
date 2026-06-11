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
if (!token) {
  throw new Error("DISCORD_TOKEN environment variable is required.");
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

async function startBot() {
  const client = createBotClient();
  await client.login(token);

  client.once("ready", async (readyClient) => {
    const clientId = readyClient.user.id;
    try {
      await registerCommands(clientId, token!);
    } catch (err) {
      logger.error({ err }, "Failed to register slash commands");
    }
  });
}

startBot().catch((err) => {
  logger.error({ err }, "Fatal bot startup error");
  process.exit(1);
});
