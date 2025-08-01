import { Bot } from 'grammy'
import { Client, GatewayIntentBits } from 'discord.js'

// Bot tokens for cross-platform messaging
export const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN
export const DISCORD_TOKEN = process.env.DISCORD_TOKEN

if (!TELEGRAM_TOKEN || !DISCORD_TOKEN) {
  throw new Error('Missing TELEGRAM_TOKEN or DISCORD_TOKEN environment variables. Please check your .env file.')
}

interface MessagePayload {
  id: string
  content: string
  username: string
  pfp: string
  platform: 'discord' | 'telegram'
  type: 'one-way' | 'two-ways'
  discord_chat_id?: string
  telegram_chat_id?: string
  user_id: string
  channel_id: string
  created_at: string
}

class CrossPlatformMessenger {
  private telegramBot: Bot | null = null
  private discordBot: Client | null = null
  private isReady = false

  async initialize() {
    try {
      // Initialize Telegram bot
      if (TELEGRAM_TOKEN) {
        this.telegramBot = new Bot(TELEGRAM_TOKEN)
        console.log('✅ Telegram bot initialized')
      } else {
        console.warn('⚠️ TELEGRAM_BOT_TOKEN not found - Telegram messaging disabled')
      }

      // Initialize Discord bot
      if (DISCORD_TOKEN) {
        this.discordBot = new Client({
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
          ]
        })

        this.discordBot.once('ready', () => {
          console.log('✅ Discord bot ready as', this.discordBot?.user?.tag)
        })

        await this.discordBot.login(DISCORD_TOKEN)
        console.log('✅ Discord bot initialized')
      } else {
        console.warn('⚠️ DISCORD_BOT_TOKEN not found - Discord messaging disabled')
      }

      this.isReady = true
      console.log('🚀 Cross-platform messenger ready!')
    } catch (error) {
      console.error('❌ Failed to initialize cross-platform messenger:', error)
      throw error
    }
  }

  async handleMessage(payload: MessagePayload) {
    if (!this.isReady) {
      console.error('❌ Cross-platform messenger not initialized')
      return
    }

    console.log('📨 Processing message:', {
      type: payload.type,
      platform: payload.platform,
      content: payload.content.substring(0, 50) + '...'
    })

    try {
      // Handle two-way messaging
      if (payload.type === 'two-ways') {
        if (payload.platform === 'discord') {
          await this.sendToTelegram(payload)
        } else if (payload.platform === 'telegram') {
          await this.sendToDiscord(payload)
        }
      }
      // Handle one-way messaging (only from Telegram)
      else if (payload.type === 'one-way') {
        if (payload.platform === 'telegram') {
          await this.sendToTelegram(payload)
        } else {
          console.log('⚠️ One-way message from non-Telegram platform ignored')
        }
      }
    } catch (error) {
      console.error('❌ Error handling message:', error)
    }
  }

  private async sendToTelegram(payload: MessagePayload) {
    if (!this.telegramBot || !payload.telegram_chat_id) {
      console.error('❌ Cannot send to Telegram: bot not initialized or chat ID missing')
      return
    }

    try {
      const message = this.formatMessageForTelegram(payload)
      await this.telegramBot.api.sendMessage(payload.telegram_chat_id, message, {
        parse_mode: 'HTML'
      })
      console.log('✅ Message sent to Telegram chat:', payload.telegram_chat_id)
    } catch (error) {
      console.error('❌ Failed to send to Telegram:', error)
    }
  }

  private async sendToDiscord(payload: MessagePayload) {
    if (!this.discordBot || !payload.discord_chat_id) {
      console.error('❌ Cannot send to Discord: bot not initialized or chat ID missing')
      return
    }

    try {
      const channel = await this.discordBot.channels.fetch(payload.discord_chat_id)
      
      if (!channel || !channel.isTextBased()) {
        console.error('❌ Discord channel not found or not text-based:', payload.discord_chat_id)
        return
      }

      const message = this.formatMessageForDiscord(payload)
      await channel.send(message)
      console.log('✅ Message sent to Discord channel:', payload.discord_chat_id)
    } catch (error) {
      console.error('❌ Failed to send to Discord:', error)
    }
  }

  private formatMessageForTelegram(payload: MessagePayload): string {
    const platformEmoji = payload.platform === 'discord' ? '🔷' : '📱'
    const typeEmoji = payload.type === 'two-ways' ? '↔️' : '➡️'
    
    return `${platformEmoji} ${typeEmoji} <b>${this.escapeHtml(payload.username)}</b>\n${this.escapeHtml(payload.content)}`
  }

  private formatMessageForDiscord(payload: MessagePayload): string {
    const platformEmoji = payload.platform === 'telegram' ? '📱' : '🔷'
    const typeEmoji = payload.type === 'two-ways' ? '↔️' : '➡️'
    
    return `${platformEmoji} ${typeEmoji} **${payload.username}**\n${payload.content}`
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  async shutdown() {
    console.log('🔄 Shutting down cross-platform messenger...')
    
    if (this.telegramBot) {
      await this.telegramBot.stop()
      console.log('✅ Telegram bot stopped')
    }
    
    if (this.discordBot) {
      this.discordBot.destroy()
      console.log('✅ Discord bot stopped')
    }
    
    this.isReady = false
    console.log('✅ Cross-platform messenger shutdown complete')
  }
}

export const crossPlatformMessenger = new CrossPlatformMessenger()