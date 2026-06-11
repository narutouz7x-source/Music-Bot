import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  EmbedBuilder,
  Colors,
} from "discord.js";
import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";
import playdl from "play-dl";
import { GuildPlayer } from "./player.js";
import { logger } from "../lib/logger.js";

const players = new Map<string, GuildPlayer>();

function getOrCreatePlayer(guildId: string): GuildPlayer {
  if (!players.has(guildId)) {
    players.set(guildId, new GuildPlayer(guildId));
  }
  return players.get(guildId)!;
}

function embed(color: number, description: string, title?: string): EmbedBuilder {
  const e = new EmbedBuilder().setColor(color).setDescription(description);
  if (title) e.setTitle(title);
  return e;
}

function errorEmbed(msg: string): EmbedBuilder {
  return embed(Colors.Red, msg);
}

function successEmbed(msg: string, title?: string): EmbedBuilder {
  return embed(Colors.Green, msg, title);
}

function infoEmbed(msg: string, title?: string): EmbedBuilder {
  return embed(Colors.Blurple, msg, title);
}

async function ensureVoiceChannel(
  interaction: ChatInputCommandInteraction
): Promise<{ channelId: string; guildId: string; adapterCreator: unknown } | null> {
  const member = interaction.member as GuildMember;
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    await interaction.reply({
      embeds: [errorEmbed("You must be in a voice channel to use this command.")],
      ephemeral: true,
    });
    return null;
  }

  return {
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  };
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
      await interaction.deferReply();

      const voiceInfo = await ensureVoiceChannel(interaction);
      if (!voiceInfo) return;

      const query = interaction.options.getString("query", true);
      const guildId = interaction.guildId!;
      const player = getOrCreatePlayer(guildId);

      try {
        let url: string;
        let title: string;

        if (playdl.yt_validate(query) === "video") {
          const info = await playdl.video_info(query);
          url = query;
          title = info.video_details.title ?? "Unknown";
        } else {
          const results = await playdl.search(query, { source: { youtube: "video" }, limit: 1 });
          if (!results.length) {
            await interaction.editReply({ embeds: [errorEmbed("No results found.")] });
            return;
          }
          url = results[0]!.url;
          title = results[0]!.title ?? "Unknown";
        }

        let connection = getVoiceConnection(guildId);
        if (!connection) {
          connection = joinVoiceChannel({
            channelId: voiceInfo.channelId,
            guildId: voiceInfo.guildId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            adapterCreator: voiceInfo.adapterCreator as any,
            selfDeaf: true,
          });

          try {
            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
          } catch (err) {
            connection.destroy();
            logger.error({ err }, "Failed to connect to voice channel");
            await interaction.editReply({ embeds: [errorEmbed("Failed to join voice channel.")] });
            return;
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
            }
          });
        }

        const entry = { title, url, requestedBy: interaction.user.tag };

        if (player.isPlaying() || player.isPaused()) {
          player.queue.enqueue(entry);
          await interaction.editReply({
            embeds: [successEmbed(`Added to queue (position ${player.queue.length}): **${title}**`)],
          });
        } else {
          player.queue.enqueue(entry);
          await player.processQueue();
          await interaction.editReply({
            embeds: [successEmbed(`🎵 Now playing: **${title}**`, "Now Playing")],
          });
        }
      } catch (err) {
        logger.error({ err }, "Error in /play");
        await interaction.editReply({ embeds: [errorEmbed("Something went wrong while trying to play that track.")] });
      }
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("pause")
      .setDescription("Pause the current track"),
    async execute(interaction: ChatInputCommandInteraction) {
      const guildId = interaction.guildId!;
      const player = players.get(guildId);
      if (!player?.isPlaying()) {
        await interaction.reply({ embeds: [errorEmbed("Nothing is playing.")], ephemeral: true });
        return;
      }
      player.pause();
      await interaction.reply({ embeds: [infoEmbed("⏸ Paused.")] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("resume")
      .setDescription("Resume the paused track"),
    async execute(interaction: ChatInputCommandInteraction) {
      const guildId = interaction.guildId!;
      const player = players.get(guildId);
      if (!player?.isPaused()) {
        await interaction.reply({ embeds: [errorEmbed("Nothing is paused.")], ephemeral: true });
        return;
      }
      player.resume();
      await interaction.reply({ embeds: [infoEmbed("▶️ Resumed.")] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("skip")
      .setDescription("Skip the current track"),
    async execute(interaction: ChatInputCommandInteraction) {
      const guildId = interaction.guildId!;
      const player = players.get(guildId);
      if (!player?.isPlaying() && !player?.isPaused()) {
        await interaction.reply({ embeds: [errorEmbed("Nothing is playing.")], ephemeral: true });
        return;
      }
      player.skip();
      await interaction.reply({ embeds: [infoEmbed("⏭ Skipped.")] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Stop playback and clear the queue"),
    async execute(interaction: ChatInputCommandInteraction) {
      const guildId = interaction.guildId!;
      const player = players.get(guildId);
      if (!player) {
        await interaction.reply({ embeds: [errorEmbed("Nothing is playing.")], ephemeral: true });
        return;
      }
      player.stop();
      await interaction.reply({ embeds: [infoEmbed("⏹ Stopped and queue cleared.")] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("queue")
      .setDescription("Show the current queue"),
    async execute(interaction: ChatInputCommandInteraction) {
      const guildId = interaction.guildId!;
      const player = players.get(guildId);
      const current = player?.getCurrentEntry();
      const queue = player?.queue.getAll() ?? [];

      if (!current && queue.length === 0) {
        await interaction.reply({ embeds: [infoEmbed("The queue is empty.")], ephemeral: true });
        return;
      }

      const lines: string[] = [];
      if (current) {
        lines.push(`**Now Playing:** ${current.title} — *${current.requestedBy}*`);
      }
      if (queue.length > 0) {
        lines.push("");
        lines.push("**Up Next:**");
        queue.slice(0, 10).forEach((e, i) => {
          lines.push(`${i + 1}. ${e.title} — *${e.requestedBy}*`);
        });
        if (queue.length > 10) {
          lines.push(`…and ${queue.length - 10} more`);
        }
      }

      await interaction.reply({
        embeds: [infoEmbed(lines.join("\n"), "Queue")],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("nowplaying")
      .setDescription("Show the currently playing track"),
    async execute(interaction: ChatInputCommandInteraction) {
      const guildId = interaction.guildId!;
      const player = players.get(guildId);
      const current = player?.getCurrentEntry();
      if (!current) {
        await interaction.reply({ embeds: [infoEmbed("Nothing is playing.")], ephemeral: true });
        return;
      }
      await interaction.reply({
        embeds: [infoEmbed(`🎵 **${current.title}**\nRequested by: ${current.requestedBy}`, "Now Playing")],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("volume")
      .setDescription("Set or check the playback volume")
      .addIntegerOption((opt) =>
        opt
          .setName("level")
          .setDescription("Volume level (0–100)")
          .setMinValue(0)
          .setMaxValue(100)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      const guildId = interaction.guildId!;
      const player = players.get(guildId);

      const level = interaction.options.getInteger("level");
      if (level === null) {
        const vol = player?.getVolume() ?? 50;
        await interaction.reply({ embeds: [infoEmbed(`Current volume: **${vol}%**`)] });
        return;
      }

      if (!player) {
        await interaction.reply({ embeds: [errorEmbed("Nothing is playing.")], ephemeral: true });
        return;
      }

      player.setVolume(level / 100);
      await interaction.reply({ embeds: [successEmbed(`🔊 Volume set to **${level}%**`)] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("leave")
      .setDescription("Disconnect the bot from the voice channel"),
    async execute(interaction: ChatInputCommandInteraction) {
      const guildId = interaction.guildId!;
      const player = players.get(guildId);
      if (!player) {
        await interaction.reply({ embeds: [errorEmbed("I'm not in a voice channel.")], ephemeral: true });
        return;
      }
      player.disconnect();
      players.delete(guildId);
      await interaction.reply({ embeds: [infoEmbed("👋 Left the voice channel.")] });
    },
  },
];
