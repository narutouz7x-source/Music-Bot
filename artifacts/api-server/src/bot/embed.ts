import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Colors,
  Message,
  TextChannel,
  NewsChannel,
  ThreadChannel,
} from "discord.js";
import { GuildPlayer } from "./player.js";
import { logger } from "../lib/logger.js";

type SendableChannel = TextChannel | NewsChannel | ThreadChannel;

const REPEAT_LABELS: Record<string, string> = {
  off: "🔁 Off",
  one: "🔂 One",
  all: "🔁 All",
};

function volumeBar(vol: number): string {
  const filled = Math.round(vol / 10);
  return "▓".repeat(filled) + "░".repeat(10 - filled);
}

function buildEmbed(player: GuildPlayer): EmbedBuilder {
  const current = player.getCurrentEntry();
  const isPlaying = player.isPlaying();
  const isPaused = player.isPaused();
  const repeat = player.queue.repeatMode;
  const vol = player.getVolume();
  const queueLen = player.queue.length;

  if (!current) {
    return new EmbedBuilder()
      .setColor(Colors.Grey)
      .setTitle("🎵 Music Player")
      .setDescription("No song is currently playing.\nUse `/play` to add a song!")
      .setFooter({ text: "B4 Music Bot" });
  }

  const statusEmoji = isPlaying ? "▶️" : isPaused ? "⏸" : "⏹";
  const statusText = isPlaying ? "Playing" : isPaused ? "Paused" : "Idle";
  const color = isPlaying ? Colors.Green : isPaused ? Colors.Yellow : Colors.Grey;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle("🎵 Music Player")
    .setURL(current.url)
    .setThumbnail(current.thumbnail)
    .addFields(
      {
        name: `${statusEmoji}  ${statusText}`,
        value: `**[${current.title}](${current.url})**`,
        inline: false,
      },
      {
        name: "👤 Requested by",
        value: current.requestedBy,
        inline: true,
      },
      {
        name: "⏱️ Duration",
        value: current.duration || "Unknown",
        inline: true,
      },
      {
        name: "🔊 Volume",
        value: `${volumeBar(vol)} **${vol}%**`,
        inline: false,
      },
      {
        name: "🔁 Repeat",
        value: REPEAT_LABELS[repeat] ?? "Off",
        inline: true,
      },
      {
        name: "📋 Queue",
        value: queueLen === 0 ? "No songs up next" : `${queueLen} song${queueLen === 1 ? "" : "s"} up next`,
        inline: true,
      },
    )
    .setFooter({ text: "B4 Music Bot • Use the buttons below to control playback" });

  return embed;
}

function buildButtons(player: GuildPlayer): ActionRowBuilder<ButtonBuilder>[] {
  const isPlaying = player.isPlaying();
  const isPaused = player.isPaused();
  const isActive = player.isActive();
  const hasPrev = player.getHistory().length > 0;
  const repeat = player.queue.repeatMode;

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("music_prev")
      .setEmoji("⏮️")
      .setLabel("Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasPrev),
    new ButtonBuilder()
      .setCustomId(isPaused ? "music_resume" : "music_pause")
      .setEmoji(isPaused ? "▶️" : "⏸️")
      .setLabel(isPaused ? "Resume" : "Pause")
      .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(!isActive),
    new ButtonBuilder()
      .setCustomId("music_skip")
      .setEmoji("⏭️")
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isActive),
    new ButtonBuilder()
      .setCustomId("music_repeat")
      .setEmoji(repeat === "one" ? "🔂" : "🔁")
      .setLabel(repeat === "off" ? "Repeat" : repeat === "one" ? "One" : "All")
      .setStyle(repeat !== "off" ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_stop")
      .setEmoji("⏹️")
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!isActive),
  );

  const vol = player.getVolume();
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("music_voldown")
      .setEmoji("🔉")
      .setLabel("Vol -10%")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(vol <= 0),
    new ButtonBuilder()
      .setCustomId("music_volup")
      .setEmoji("🔊")
      .setLabel("Vol +10%")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(vol >= 100),
  );

  return [row1, row2];
}

export class PlayerEmbed {
  private message: Message | null = null;
  private player: GuildPlayer;
  private updatePending = false;

  constructor(player: GuildPlayer) {
    this.player = player;

    const scheduleUpdate = () => {
      if (this.updatePending) return;
      this.updatePending = true;
      setTimeout(() => {
        this.updatePending = false;
        void this.refresh();
      }, 300);
    };

    player.on("trackStart", scheduleUpdate);
    player.on("trackEnd", scheduleUpdate);
    player.on("queueEmpty", scheduleUpdate);
    player.on("stateChange", scheduleUpdate);
  }

  async send(channel: SendableChannel): Promise<Message> {
    if (this.message) {
      try {
        await this.message.delete();
      } catch {}
    }

    const msg = await channel.send({
      embeds: [buildEmbed(this.player)],
      components: buildButtons(this.player),
    });

    this.message = msg;
    return msg;
  }

  async refresh(): Promise<void> {
    if (!this.message) return;
    try {
      await this.message.edit({
        embeds: [buildEmbed(this.player)],
        components: buildButtons(this.player),
      });
    } catch (err) {
      logger.warn({ err }, "Failed to refresh player embed");
      this.message = null;
    }
  }

  async destroy(): Promise<void> {
    if (!this.message) return;
    try {
      await this.message.delete();
    } catch {}
    this.message = null;
  }

  getMessage(): Message | null {
    return this.message;
  }
}
