import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
  TextChannel,
  NewsChannel,
  ThreadChannel,
} from "discord.js";
import { GuildPlayer } from "./player.js";
import { logger } from "../lib/logger.js";

type SendableChannel = TextChannel | NewsChannel | ThreadChannel;

const COLOR_PLAYING = 0x1db954;
const COLOR_PAUSED  = 0xf0a500;
const COLOR_IDLE    = 0x2f3136;

function progressBar(vol: number): string {
  const filled = Math.round(vol / 10);
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);
  return bar;
}

function repeatLabel(mode: string): string {
  if (mode === "one") return "🔂 One";
  if (mode === "all") return "🔁 All";
  return "➡️ Off";
}

function buildEmbed(player: GuildPlayer): EmbedBuilder {
  const current  = player.getCurrentEntry();
  const isPlaying = player.isPlaying();
  const isPaused  = player.isPaused();
  const repeat    = player.queue.repeatMode;
  const vol       = player.getVolume();
  const queueLen  = player.queue.length;

  if (!current) {
    return new EmbedBuilder()
      .setColor(COLOR_IDLE)
      .setAuthor({ name: "B4 Music  •  Nothing playing" })
      .setTitle("Queue is empty")
      .setDescription(
        "### Use `/play` to start listening!\n" +
        "Add a YouTube link or just type a song name."
      )
      .setFooter({ text: "B4 Music Bot" });
  }

  const statusLine = isPlaying ? "▶  Now Playing" : isPaused ? "⏸  Paused" : "⏹  Stopped";
  const color      = isPlaying ? COLOR_PLAYING : isPaused ? COLOR_PAUSED : COLOR_IDLE;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `B4 Music  •  ${statusLine}` })
    .setTitle(current.title.length > 60 ? current.title.slice(0, 57) + "…" : current.title)
    .setURL(current.url)
    .setDescription(
      `> 🔗 [Open on YouTube](${current.url})\n` +
      `> 👤 **Requested by** ${current.requestedBy}\n` +
      `> ⏱️ **Duration** \`${current.duration}\``
    )
    .addFields(
      {
        name: "🔊 Volume",
        value: `\`${progressBar(vol)}\` **${vol}%**`,
        inline: true,
      },
      {
        name: "🔁 Repeat",
        value: repeatLabel(repeat),
        inline: true,
      },
      {
        name: "📋 Queue",
        value: queueLen === 0 ? "No songs up next" : `**${queueLen}** song${queueLen === 1 ? "" : "s"} up next`,
        inline: true,
      },
    )
    .setImage(current.thumbnail || null)
    .setFooter({ text: "B4 Music Bot  •  Use the buttons below to control playback" });

  return embed;
}

function buildButtons(player: GuildPlayer): ActionRowBuilder<ButtonBuilder>[] {
  const isPlaying = player.isPlaying();
  const isPaused  = player.isPaused();
  const isActive  = player.isActive();
  const hasPrev   = player.getHistory().length > 0;
  const repeat    = player.queue.repeatMode;
  const vol       = player.getVolume();

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

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("music_voldown")
      .setEmoji("🔉")
      .setLabel("Vol −10")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(vol <= 0),

    new ButtonBuilder()
      .setCustomId("music_volup")
      .setEmoji("🔊")
      .setLabel("Vol +10")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(vol >= 100),
  );

  return [row1, row2];
}

export class PlayerEmbed {
  private message: Message | null = null;
  private channel: SendableChannel | null = null;
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

  async autoShow(channel: SendableChannel): Promise<void> {
    if (this.message && this.channel?.id === channel.id) {
      await this.refresh();
      return;
    }
    await this.send(channel);
  }

  async send(channel: SendableChannel): Promise<Message> {
    if (this.message) {
      try { await this.message.delete(); } catch {}
    }

    const msg = await channel.send({
      embeds: [buildEmbed(this.player)],
      components: buildButtons(this.player),
    });

    this.message = msg;
    this.channel = channel;
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
      this.channel = null;
    }
  }

  async destroy(): Promise<void> {
    if (!this.message) return;
    try { await this.message.delete(); } catch {}
    this.message = null;
    this.channel = null;
  }

  getMessage(): Message | null {
    return this.message;
  }
}
