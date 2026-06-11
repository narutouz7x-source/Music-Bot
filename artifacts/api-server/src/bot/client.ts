import { Client, GatewayIntentBits, Events, Collection, Interaction } from "discord.js";
import { commands, handleButton } from "./commands.js";
import { logger } from "../lib/logger.js";

type CommandLike = (typeof commands)[number];

export function createBotClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  const commandMap = new Collection<string, CommandLike>();
  for (const cmd of commands) {
    commandMap.set(cmd.data.name, cmd);
  }

  client.once(Events.ClientReady, (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, "Bot is ready");
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith("music_")) {
        try {
          await handleButton(interaction);
        } catch (err) {
          logger.error({ err, customId: interaction.customId }, "Error handling button");
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "An error occurred.", ephemeral: true }).catch(() => {});
          }
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = commandMap.get(interaction.commandName);
    if (!command) {
      logger.warn({ command: interaction.commandName }, "Unknown command");
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error({ err, command: interaction.commandName }, "Error executing command");
      const msg = { content: "An error occurred while running that command.", ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    }
  });

  return client;
}
