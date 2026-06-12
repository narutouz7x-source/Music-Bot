import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ButtonInteraction,
  GuildMember,
  EmbedBuilder,
  Colors,
  TextChannel,
  NewsChannel,
  ThreadChannel,
} from "discord.js";
import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";
import { resolveTrack } from "./streamer.js";
import { GuildPlayer } from "./player.js";
import { PlayerEmbed } from "./embed.js";
import { logger } from "../lib/logger.js";

const players = new Map<string, GuildPlayer>();
const embeds = new Map<string, PlayerEmbed>();

export function getPlayers(): Map<string, GuildPlayer> {
  return players;
}

export function getEmbeds(): Map<string, PlayerEmbed> {
  return embeds;
}

function getOrCreatePlayer(guildId: string): GuildPlayer {
  if (!players.has(guildId)) {
    const p = new GuildPlayer(guildId);
    players.set(guildId, p);
    const embed = new PlayerEmbed(p);
    embeds.set(guildId, embed);
  }
  return players.get(guildId)!;
}

function reply(color: number, description: string, title?: string): EmbedBuilder {
  const e = new EmbedBuilder().setColor(color).setDescription(description);
  if (title) e.setTitle(title);
  return e;
}
const err = (msg: string) => reply(Colors.Red, msg);
const ok = (msg: string, title?: string) => reply(Colors.Green, msg, title);
const info = (msg: string, title?: string) => reply(Colors.Blurple, msg, title);

async function ensureVoice(interaction: ChatInputCommandInteraction | ButtonInteraction) {
  const member = interaction.member as GuildMember;
  const vc = member?.voice?.channel;
  if (!vc) {
    await interaction.reply({ embeds: [err("You must be in a voice channel.")], ephemeral: true });
    return null;
  }
  return vc;
}

async function ensureConnected(
  guildId: string,
  player: GuildPlayer,
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<boolean> {
  const vc = await ensureVoice(interaction);
  if (!vc) return false;

  let connection = getVoiceConnection(guildId);
  if (!connection) {
    connection = joinVoiceChannel({
      channelId: vc.id,
      guildId: vc.guild.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapterCreator: vc.guild.voiceAdapterCreator as any,
      selfDeaf: true,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (e) {
      connection.destroy();
      logger.error({ err: e }, "Failed to connect to voice channel");
      await interaction.reply({ embeds: [err("Failed to join voice channel.")], ephemeral: true });
      return false;
    }

    player.setConnection(connection);

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection!, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection!, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        connection!.destroy();
        player.disconnect();
        players.delete(guildId);
        embeds.delete(guildId);
      }
    });
  }

  return true;
}


export const commands = [
  {
    data: new SlashCommandBuilder()
      .setName("play")
      .setDescription("Play a song from YouTube")
      .addStringOption((opt) =>
        opt.setName("query").setDescription("YouTube URL or search query").setRequired(true)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply({ ephemeral: true });
      const guildId = interaction.guildId!;
      const player = getOrCreatePlayer(guildId);

      const connected = await ensureConnected(guildId, player, interaction);
      if (!connected) return;

      const query = interaction.options.getString("query", true);

      try {
        const track = await resolveTrack(query);
        if (!track) {
          await interaction.editReply({ embeds: [err("No results found for that query.")] });
          return;
        }

        const entry = { ...track, requestedBy: interaction.user.tag };
        const wasActive = player.isActive();

        player.queue.enqueue(entry);

        if (wasActive) {
          await interaction.editReply({
            embeds: [ok(`Added **${track.title}** to queue (position **${player.queue.length}**)`)],
          });
        } else {
          await player.processQueue();
          await interaction.editReply({
            embeds: [ok(`▶️ Starting **${track.title}**`)],
          });
        }

        const channel = interaction.channel as TextChannel | NewsChannel | ThreadChannel | null;
        if (channel?.isTextBased()) {
          const embed = embeds.get(guildId)!;
          await embed.autoShow(channel as TextChannel | NewsChannel | ThreadChannel);
        }

        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      } catch (e) {
        logger.error({ err: e }, "Error in /play");
        await interaction.editReply({ embeds: [err("Something went wrong trying to play that track.")] });
      }
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("player")
      .setDescription("Open the interactive music player panel"),
    async execute(interaction: ChatInputCommandInteraction) {
      const guildId = interaction.guildId!;
      const player = getOrCreatePlayer(guildId);

      const channel = interaction.channel as TextChannel | NewsChannel | ThreadChannel;
      if (!channel?.isTextBased()) {
        await interaction.reply({ embeds: [err("This command can only be used in a text channel.")], ephemeral: true });
        return;
      }

      await interaction.deferReply();

      const embed = embeds.get(guildId)!;
      const msg = await embed.send(channel);

      await interaction.editReply({
        embeds: [info(`🎛️ Player panel opened above.`)],
      });

      setTimeout(() => interaction.deleteReply().catch(() => {}), 4000);

      logger.info({ guildId, messageId: msg.id }, "Player embed sent");
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("pause")
      .setDescription("Pause the current track"),
    async execute(interaction: ChatInputCommandInteraction) {
      const player = players.get(interaction.guildId!);
      if (!player?.isPlaying()) {
        await interaction.reply({ embeds: [err("Nothing is playing.")], ephemeral: true });
        return;
      }
      player.pause();
      await interaction.reply({ embeds: [info("⏸️ Paused.")] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("resume")
      .setDescription("Resume the paused track"),
    async execute(interaction: ChatInputCommandInteraction) {
      const player = players.get(interaction.guildId!);
      if (!player?.isPaused()) {
        await interaction.reply({ embeds: [err("Nothing is paused.")], ephemeral: true });
        return;
      }
      player.resume();
      await interaction.reply({ embeds: [info("▶️ Resumed.")] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("skip")
      .setDescription("Skip the current track"),
    async execute(interaction: ChatInputCommandInteraction) {
      const player = players.get(interaction.guildId!);
      if (!player?.isActive()) {
        await interaction.reply({ embeds: [err("Nothing is playing.")], ephemeral: true });
        return;
      }
      player.skip();
      await interaction.reply({ embeds: [info("⏭️ Skipped.")] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Stop playback and clear the queue"),
    async execute(interaction: ChatInputCommandInteraction) {
      const player = players.get(interaction.guildId!);
      if (!player?.isActive()) {
        await interaction.reply({ embeds: [err("Nothing is playing.")], ephemeral: true });
        return;
      }
      player.stop();
      await interaction.reply({ embeds: [info("⏹️ Stopped and queue cleared.")] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("queue")
      .setDescription("Show the current queue"),
    async execute(interaction: ChatInputCommandInteraction) {
      const player = players.get(interaction.guildId!);
      const current = player?.getCurrentEntry();
      const queue = player?.queue.getAll() ?? [];

      if (!current && queue.length === 0) {
        await interaction.reply({ embeds: [info("The queue is empty.")], ephemeral: true });
        return;
      }

      const lines: string[] = [];
      if (current) lines.push(`**▶️ Now Playing:** [${current.title}](${current.url}) \`${current.duration}\` — *${current.requestedBy}*`);
      if (queue.length > 0) {
        lines.push("\n**Up Next:**");
        queue.slice(0, 10).forEach((e, i) => {
          lines.push(`\`${i + 1}.\` [${e.title}](${e.url}) \`${e.duration}\` — *${e.requestedBy}*`);
        });
        if (queue.length > 10) lines.push(`\n…and **${queue.length - 10}** more`);
      }

      await interaction.reply({ embeds: [info(lines.join("\n"), "📋 Queue")] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("nowplaying")
      .setDescription("Show the currently playing track"),
    async execute(interaction: ChatInputCommandInteraction) {
      const player = players.get(interaction.guildId!);
      const current = player?.getCurrentEntry();
      if (!current) {
        await interaction.reply({ embeds: [info("Nothing is playing.")], ephemeral: true });
        return;
      }
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Green)
            .setTitle("▶️ Now Playing")
            .setDescription(`**[${current.title}](${current.url})**`)
            .setThumbnail(current.thumbnail)
            .addFields(
              { name: "👤 Requested by", value: current.requestedBy, inline: true },
              { name: "⏱️ Duration", value: current.duration, inline: true },
            ),
        ],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("volume")
      .setDescription("Set or check the playback volume")
      .addIntegerOption((opt) =>
        opt.setName("level").setDescription("Volume level (0–100)").setMinValue(0).setMaxValue(100)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const player = players.get(interaction.guildId!);
      const level = interaction.options.getInteger("level");
      if (level === null) {
        const vol = player?.getVolume() ?? 50;
        await interaction.reply({ embeds: [info(`🔊 Volume: **${vol}%**`)] });
        return;
      }
      if (!player) {
        await interaction.reply({ embeds: [err("Nothing is playing.")], ephemeral: true });
        return;
      }
      player.setVolume(level / 100);
      await interaction.reply({ embeds: [ok(`🔊 Volume set to **${level}%**`)] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("leave")
      .setDescription("Disconnect the bot from the voice channel"),
    async execute(interaction: ChatInputCommandInteraction) {
      const guildId = interaction.guildId!;
      
      // Check for voice connection (bot might be connected but player not initialized)
      const connection = getVoiceConnection(guildId);
      const player = players.get(guildId);

      if (!connection && !player) {
        await interaction.reply({ embeds: [err("I'm not in a voice channel.")], ephemeral: true });
        return;
      }

      // Destroy connection if it exists
      if (connection) {
        connection.destroy();
        logger.info({ guildId }, "Voice connection destroyed");
      }

      // Clean up player if it exists
      if (player) {
        const embed = embeds.get(guildId);
        await embed?.destroy();
        embeds.delete(guildId);
        player.disconnect();
        players.delete(guildId);
      }

      await interaction.reply({ embeds: [ok("👋 Left the voice channel.")] });
      logger.info({ guildId }, "Bot left voice channel");
    },
  },
];

export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const player = players.get(guildId);

  switch (interaction.customId) {
    case "music_pause": {
      if (!player?.isPlaying()) {
        await interaction.reply({ embeds: [err("Nothing is playing.")], ephemeral: true });
        return;
      }
      player.pause();
      await interaction.deferUpdate();
      break;
    }
    case "music_resume": {
      if (!player?.isPaused()) {
        await interaction.reply({ embeds: [err("Nothing is paused.")], ephemeral: true });
        return;
      }
      player.resume();
      await interaction.deferUpdate();
      break;
    }
    case "music_skip": {
      if (!player?.isActive()) {
        await interaction.reply({ embeds: [err("Nothing is playing.")], ephemeral: true });
        return;
      }
      player.skip();
      await interaction.deferUpdate();
      break;
    }
    case "music_prev": {
      if (!player) {
        await interaction.reply({ embeds: [err("Nothing is playing.")], ephemeral: true });
        return;
      }
      await interaction.deferUpdate();
      const success = await player.previous();
      if (!success) {
        await interaction.followUp({ embeds: [err("No previous track in history.")], ephemeral: true });
      }
      break;
    }
    case "music_stop": {
      if (!player?.isActive()) {
        await interaction.reply({ embeds: [err("Nothing is playing.")], ephemeral: true });
        return;
      }
      player.stop();
      await interaction.deferUpdate();
      break;
    }
    case "music_repeat": {
      if (!player) {
        await interaction.reply({ embeds: [err("No player active.")], ephemeral: true });
        return;
      }
      const mode = player.cycleRepeat();
      const labels: Record<string, string> = { off: "Off", one: "One", all: "All" };
      await interaction.deferUpdate();
      await interaction.followUp({ embeds: [info(`🔁 Repeat: **${labels[mode]}**`)], ephemeral: true });
      break;
    }
    case "music_voldown": {
      if (!player) {
        await interaction.reply({ embeds: [err("No player active.")], ephemeral: true });
        return;
      }
      player.setVolume((player.getVolume() - 10) / 100);
      await interaction.deferUpdate();
      break;
    }
    case "music_volup": {
      if (!player) {
        await interaction.reply({ embeds: [err("No player active.")], ephemeral: true });
        return;
      }
      player.setVolume((player.getVolume() + 10) / 100);
      await interaction.deferUpdate();
      break;
    }
    default:
      break;
  }
}
