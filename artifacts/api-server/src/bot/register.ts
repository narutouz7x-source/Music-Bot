import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";
import { logger } from "../lib/logger.js";

export async function registerCommands(clientId: string, token: string): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token);

  const body = commands.map((c) => c.data.toJSON());

  logger.info({ count: body.length }, "Registering slash commands globally");
  await rest.put(Routes.applicationCommands(clientId), { body });
  logger.info("Slash commands registered");
}
