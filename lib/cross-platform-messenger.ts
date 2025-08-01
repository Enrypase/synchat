import { Bot } from 'grammy'
import { Client, GatewayIntentBits, TextChannel } from 'discord.js'
import { supabaseAdmin as supabase } from './supabase'
import type { Database } from './database.types'

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

interface IncomingMessage {
  platform: 'discord' | 'telegram'
  chatId: string
  messageId: string
  content: string
  username: string
  userId: string
  pfp: string | null
}

interface PlatformMessageEdit {
  platform: 'discord' | 'telegram'
  messageId: string
  newContent: string
  chatId: string
}

interface PlatformMessageDelete {
  platform: 'discord' | 'telegram'
  messageId: string
  chatId: string
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
        
        // Add message listener for processing incoming messages
        this.telegramBot.on('message', async (ctx) => {
          await this.processIncomingMessage({
            platform: 'telegram',
            chatId: ctx.chat.id.toString(),
            messageId: ctx.message.message_id.toString(),
            content: ctx.message.text || '[Non-text message]',
            username: ctx.from?.username || ctx.from?.first_name || 'Unknown',
            userId: ctx.from?.id.toString() || 'unknown',
            pfp: null // Telegram doesn't provide direct avatar URLs in messages
          })
        })

        // Add listener for edited messages
        this.telegramBot.on('edited_message', async (ctx) => {
          console.log('📝 Telegram message edited:', ctx.editedMessage.message_id)
          await this.handlePlatformMessageEdit({
            platform: 'telegram',
            messageId: ctx.editedMessage.message_id.toString(),
            newContent: ctx.editedMessage.text || '[Non-text message]',
            chatId: ctx.chat.id.toString()
          })
        })

        // Note: Telegram Bot API doesn't provide message deletion events
        // Message deletions from Telegram side must be handled manually or through other means
        
        this.telegramBot.start() 
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

        // Add message listener for processing incoming messages
        this.discordBot.on('messageCreate', async (message) => {
          // Ignore bot messages
          if (message.author.bot) return
          
          await this.processIncomingMessage({
            platform: 'discord',
            chatId: message.channel.id,
            messageId: message.id,
            content: message.content || '[Empty message]',
            username: message.author.globalName || message.author.username,
            userId: message.author.id,
            pfp: message.author.displayAvatarURL()
          })
        })

        // Add listener for message edits
        this.discordBot.on('messageUpdate', async (oldMessage, newMessage) => {
          // Ignore bot messages and partial messages
          if (newMessage.author?.bot || !newMessage.content) return
          
          console.log('📝 Discord message edited:', newMessage.id)
          await this.handlePlatformMessageEdit({
            platform: 'discord',
            messageId: newMessage.id,
            newContent: newMessage.content,
            chatId: newMessage.channel.id
          })
        })

        // Add listener for message deletions
        this.discordBot.on('messageDelete', async (deletedMessage) => {
          // Ignore bot messages and partial messages
          if (deletedMessage.author?.bot || !deletedMessage.id) return
          
          console.log('🗑️ Discord message deleted:', deletedMessage.id)
          await this.handlePlatformMessageDelete({
            platform: 'discord',
            messageId: deletedMessage.id,
            chatId: deletedMessage.channel.id
          })
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

  private async processIncomingMessage(incomingMessage: IncomingMessage) {
    try {
      console.log(`📥 Processing incoming ${incomingMessage.platform} message from ${incomingMessage.username}`)
      
      // Step 1: Find matching channel in database
      const channel = await this.findMatchingChannel(incomingMessage.platform, incomingMessage.chatId)
      if (!channel) {
        console.log(`⚠️ No matching channel found for ${incomingMessage.platform} chat ${incomingMessage.chatId}`)
        return
      }
      
      console.log(`✅ Found matching channel: ${channel.id} (type: ${channel.type})`)
      
      // Step 2: Upsert user (handle username/pfp changes)
      const user = await this.upsertUser(incomingMessage)
      if (!user) {
        console.error(`❌ Failed to upsert user for ${incomingMessage.platform} user ${incomingMessage.userId}`)
        return
      }
      
      console.log(`✅ User upserted: ${user.id} (${user.username})`)
      
      // Step 3: Insert message into messages table
      const message = await this.insertMessage(incomingMessage, user.id, channel.id)
      if (!message) {
        console.error(`❌ Failed to insert message for user ${user.username}`)
        return
      }
      
      console.log(`✅ Message inserted: ${message.id}`)
      
    } catch (error) {
      console.error('❌ Error processing incoming message:', error)
    }
  }

  private async findMatchingChannel(platform: 'discord' | 'telegram', chatId: string) {
    try {
      const { data, error } = await supabase
        .from('channels')
        .select('*')
        .eq(platform === 'discord' ? 'discord_chat_id' : 'telegram_chat_id', chatId)
        .single()
      
      if (error) {
        console.log(`No channel found for ${platform} chat ${chatId}:`, error.message)
        return null
      }
      
      return data
    } catch (error) {
      console.error('Error finding matching channel:', error)
      return null
    }
  }

  private async upsertUser(incomingMessage: IncomingMessage) {
    try {
      // First, check if user exists and get current data
      const { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('id', incomingMessage.userId)
        .single()
      
      if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = not found
        console.error('Error fetching existing user:', fetchError)
        return null
      }
      
      // If user doesn't exist, insert new user
      if (!existingUser) {
        console.log(`👤 Creating new user: ${incomingMessage.username}`)
        const { data, error } = await supabase
          .from('users')
          .insert({
            id: incomingMessage.userId,
            username: incomingMessage.username,
            pfp: incomingMessage.pfp,
            platform: incomingMessage.platform as Database['public']['Enums']['platform']
          })
          .select()
          .single()
        
        if (error) {
          console.error('Error inserting new user:', error)
          return null
        }
        
        return data
      }
      
      // Check if user data needs updating
      const needsUpdate = 
        existingUser.username !== incomingMessage.username ||
        existingUser.pfp !== incomingMessage.pfp
      
      if (!needsUpdate) {
        console.log(`✅ User ${incomingMessage.username} is up to date`)
        return existingUser
      }
      
      // Update user with new data
      console.log(`🔄 Updating user: ${existingUser.username} -> ${incomingMessage.username}`)
      const { data, error } = await supabase
        .from('users')
        .update({
          username: incomingMessage.username,
          pfp: incomingMessage.pfp
        })
        .eq('id', incomingMessage.userId)
        .select()
        .single()
      
      if (error) {
        console.error('Error updating user:', error)
        return null
      }
      
      return data
    } catch (error) {
      console.error('Error in upsertUser:', error)
      return null
    }
  }

  private async insertMessage(incomingMessage: IncomingMessage, userId: string, channelId: string) {
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          id: incomingMessage.messageId,
          content: incomingMessage.content,
          user_id: userId,
          channel_id: channelId
        })
        .select()
        .single()
      
      if (error) {
        console.error('Error inserting message:', error)
        return null
      }
      
      return data
    } catch (error) {
      console.error('Error inserting message:', error)
      return null
    }
  }

  private async handlePlatformMessageEdit(editData: PlatformMessageEdit) {
    try {
      console.log(`📝 Processing ${editData.platform} message edit for ID: ${editData.messageId}`)
      
      // Check if this message exists in our database and is from a tracked channel
      const { data: existingMessage, error: fetchError } = await supabase
        .from('messages')
        .select(`
          *,
          channels!inner(*)
        `)
        .eq('id', editData.messageId)
        .single()
      
      if (fetchError || !existingMessage) {
        console.log(`⚠️ Message ${editData.messageId} not found in database or not from tracked channel`)
        return
      }
      
      // Verify the message is from the correct chat
      const channel = existingMessage.channels
      const isCorrectChat = 
        (editData.platform === 'discord' && channel.discord_chat_id === editData.chatId) ||
        (editData.platform === 'telegram' && channel.telegram_chat_id === editData.chatId)
      
      if (!isCorrectChat) {
        console.log(`⚠️ Message edit from different chat than expected`)
        return
      }
      
      // Update the message content in the database
      const { data: _updatedMessage, error: updateError } = await supabase
        .from('messages')
        .update({
          content: editData.newContent,
          modified_at: new Date().toISOString()
        })
        .eq('id', editData.messageId)
        .select()
        .single()
      
      if (updateError) {
        console.error('❌ Failed to update message content:', updateError)
        return
      }
      
      console.log(`✅ Message ${editData.messageId} content updated in database`)
      
    } catch (error) {
      console.error('❌ Error handling platform message edit:', error)
    }
  }

  private async handlePlatformMessageDelete(deleteData: PlatformMessageDelete) {
    try {
      console.log(`🗑️ Processing ${deleteData.platform} message deletion for ID: ${deleteData.messageId}`)
      
      // Check if this message exists in our database and is from a tracked channel
      const { data: existingMessage, error: fetchError } = await supabase
        .from('messages')
        .select(`
          *,
          channels!inner(*)
        `)
        .eq('id', deleteData.messageId)
        .single()
      
      if (fetchError || !existingMessage) {
        console.log(`⚠️ Message ${deleteData.messageId} not found in database or not from tracked channel`)
        return
      }
      
      // Verify the message is from the correct chat
      const channel = existingMessage.channels
      const isCorrectChat = 
        (deleteData.platform === 'discord' && channel.discord_chat_id === deleteData.chatId) ||
        (deleteData.platform === 'telegram' && channel.telegram_chat_id === deleteData.chatId)
      
      if (!isCorrectChat) {
        console.log(`⚠️ Message deletion from different chat than expected`)
        return
      }
      
      // Update the message with deleted_at timestamp in the database
      const { data: _updatedMessage, error: updateError } = await supabase
        .from('messages')
        .update({
          deleted_at: new Date().toISOString()
        })
        .eq('id', deleteData.messageId)
        .select()
        .single()
      
      if (updateError) {
        console.error('❌ Failed to update message deleted_at:', updateError)
        return
      }
      
      console.log(`✅ Message ${deleteData.messageId} marked as deleted in database`)
      
    } catch (error) {
      console.error('❌ Error handling platform message deletion:', error)
    }
  }

  async handleMessageUpdate(newPayload: MessagePayload, oldPayload: MessagePayload) {
    if (!this.isReady) {
      console.error('❌ Cross-platform messenger not initialized')
      return
    }

    console.log('📝 Processing message update:', {
      id: newPayload.id,
      oldContent: oldPayload?.content,
      newContent: newPayload.content
    })

    try {
      // Get the message details from database to determine original platform
      const { data: existingMessage, error: fetchError } = await supabase
        .from('messages')
        .select(`
          *,
          channels!inner(*),
          users!inner(*)
        `)
        .eq('id', newPayload.id)
        .single()
      
      if (fetchError || !existingMessage) {
        console.log('⚠️ Message not found in database - no update needed')
        return
      }

      const channel = existingMessage.channels
      const user = existingMessage.users
      
      console.log(`📝 Editing related message on the other platform (original from ${user.platform})`)
      console.log(`📝 Original content: "${newPayload.content}"`)
      
      // Find the corresponding message on the other platform using message_mappings
      const { data: mapping, error: mappingError } = await supabase
        .from('message_mappings')
        .select('*')
        .or(`discord_id.eq.${newPayload.id},telegram_id.eq.${newPayload.id}`)
        .single()
      
      if (mappingError || !mapping) {
        console.log('⚠️ No message mapping found - no cross-platform update needed')
        return
      }
      
      // Edit the related message on the OTHER platform
      if (user.platform === 'telegram' && channel.discord_chat_id) {
        // Original message was from Telegram, edit the Discord version
        const formattedContent = this.formatEditedMessageForDiscord(user.username, newPayload.content, user.platform, channel.type)
        console.log(`📝 Formatted for Discord: "${formattedContent}"`)
        await this.editDiscordMessage(mapping.discord_id, formattedContent, channel.discord_chat_id)
      } else if (user.platform === 'discord' && channel.telegram_chat_id) {
        // Original message was from Discord, edit the Telegram version
        const formattedContent = this.formatEditedMessageForTelegram(user.username, newPayload.content, user.platform, channel.type)
        console.log(`📝 Formatted for Telegram: "${formattedContent}"`)
        await this.editTelegramMessage(mapping.telegram_id, formattedContent, channel.telegram_chat_id)
      }
      
    } catch (error) {
      console.error('❌ Error handling message update:', error)
    }
  }

  async handleMessageDeletion(deletedPayload: MessagePayload) {
    if (!this.isReady) {
      console.error('❌ Cross-platform messenger not initialized')
      return
    }

    console.log('🗑️ Processing message deletion from database:', {
      id: deletedPayload.id,
      platform: deletedPayload.platform
    })

    try {
      // Find the corresponding message on the other platform using message_mappings
      const { data: mapping, error: mappingError } = await supabase
        .from('message_mappings')
        .select('*')
        .or(`discord_id.eq.${deletedPayload.id},telegram_id.eq.${deletedPayload.id}`)
        .single()
      
      if (mappingError || !mapping) {
        console.log('⚠️ No message mapping found - no cross-platform deletion needed')
        return
      }

      // Delete the related message on the OTHER platform
      if (deletedPayload.platform === 'telegram' && deletedPayload.discord_chat_id) {
        // Original message was from Telegram, delete the Discord version
        await this.deleteDiscordMessage(mapping.discord_id, deletedPayload.discord_chat_id)
      } else if (deletedPayload.platform === 'discord' && deletedPayload.telegram_chat_id) {
        // Original message was from Discord, delete the Telegram version
        await this.deleteTelegramMessage(mapping.telegram_id, deletedPayload.telegram_chat_id)
      }
      
    } catch (error) {
      console.error('❌ Error handling message deletion:', error)
    }
  }

  async handleMessage(payload: MessagePayload) {
    if (!this.isReady) {
      console.error('❌ Cross-platform messenger not initialized')
      return
    }

    try {
        console.log("Handling message:",payload.type, payload.platform)
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
          await this.sendToDiscord(payload)
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
      const sentMessage = await this.telegramBot.api.sendMessage(payload.telegram_chat_id, message, {
        parse_mode: 'HTML'
      })
      
      // Store the message mapping in the message_mappings table
      await this.createMessageMapping(payload.id, sentMessage.message_id.toString(), payload.platform)
      
      console.log('✅ Message sent to Telegram chat:', payload.telegram_chat_id)
    } catch (error) {
      console.error('❌ Failed to send to Telegram:', error)
    }
  }

  private async sendToDiscord(payload: MessagePayload) {
    console.log("Sending to Discord:",payload.content)
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
      const sentMessage = await (channel as TextChannel).send(message)
      
      // Store the message mapping in the message_mappings table
      await this.createMessageMapping(payload.id, sentMessage.id, payload.platform)
      
      console.log('✅ Message sent to Discord channel:', payload.discord_chat_id)
    } catch (error) {
      console.error('❌ Failed to send to Discord:', error)
    }
  }

  private async createMessageMapping(originalMessageId: string, forwardedMessageId: string, originalPlatform: 'discord' | 'telegram') {
    try {
      // Determine which ID goes where based on the original platform
      const mappingData = originalPlatform === 'discord' 
        ? { discord_id: originalMessageId, telegram_id: forwardedMessageId }
        : { discord_id: forwardedMessageId, telegram_id: originalMessageId }
      
      const { error } = await supabase
        .from('message_mappings')
        .upsert(mappingData)
      
      if (error) {
        console.error('❌ Failed to create message mapping:', error)
      } else {
        console.log(`✅ Created message mapping: Discord(${mappingData.discord_id}) ↔ Telegram(${mappingData.telegram_id})`)
      }
    } catch (error) {
      console.error('❌ Error creating message mapping:', error)
    }
  }

  private async editTelegramMessage(messageId: string, newContent: string, chatId: string) {
    if (!this.telegramBot) {
      console.error('❌ Cannot edit Telegram message: bot not initialized')
      return
    }

    try {
      await this.telegramBot.api.editMessageText(chatId, parseInt(messageId), newContent, {
        parse_mode: 'HTML'
      })
      console.log('✅ Message edited on Telegram chat:', chatId)
    } catch (error) {
      console.error('❌ Failed to edit Telegram message:', error)
    }
  }

  private async editDiscordMessage(messageId: string, newContent: string, chatId: string) {
    if (!this.discordBot) {
      console.error('❌ Cannot edit Discord message: bot not initialized')
      return
    }

    try {
      const channel = await this.discordBot.channels.fetch(chatId)
      
      if (!channel || !channel.isTextBased()) {
        console.error('❌ Discord channel not found or not text-based:', chatId)
        return
      }

      const message = await (channel as TextChannel).messages.fetch(messageId)
      await message.edit(newContent)
      console.log('✅ Message edited on Discord channel:', chatId)
    } catch (error) {
      console.error('❌ Failed to edit Discord message:', error)
    }
  }

  private async deleteTelegramMessage(messageId: string, chatId: string) {
    if (!this.telegramBot) {
      console.error('❌ Cannot delete Telegram message: bot not initialized')
      return
    }

    try {
      await this.telegramBot.api.deleteMessage(chatId, parseInt(messageId))
      console.log('✅ Message deleted from Telegram chat:', chatId)
    } catch (error) {
      console.error('❌ Failed to delete Telegram message:', error)
    }
  }

  private async deleteDiscordMessage(messageId: string, chatId: string) {
    if (!this.discordBot) {
      console.error('❌ Cannot delete Discord message: bot not initialized')
      return
    }

    try {
      const channel = await this.discordBot.channels.fetch(chatId)
      
      if (!channel || !channel.isTextBased()) {
        console.error('❌ Discord channel not found or not text-based:', chatId)
        return
      }

      const message = await (channel as TextChannel).messages.fetch(messageId)
      await message.delete()
      console.log('✅ Message deleted from Discord channel:', chatId)
    } catch (error) {
      console.error('❌ Failed to delete Discord message:', error)
    }
  }

  private formatMessageForTelegram(payload: MessagePayload): string {
    const platformEmoji = payload.platform === 'discord' ? '🔷' : '📱'
    const typeEmoji = payload.type === 'two-ways' ? '↔️' : '➡️'
    
    return `${platformEmoji} ${typeEmoji} <b>${this.escapeHtmlForTelegram(payload.username)}</b>\n${this.escapeHtmlForTelegram(payload.content)}`
  }

  private formatMessageForDiscord(payload: MessagePayload): string {
    const platformEmoji = payload.platform === 'telegram' ? '📱' : '🔷'
    const typeEmoji = payload.type === 'two-ways' ? '↔️' : '➡️'
    
    return `${platformEmoji} ${typeEmoji} **${payload.username}**\n${payload.content}`
  }

  private formatEditedMessageForTelegram(username: string, content: string, originalPlatform: Database['public']['Enums']['platform'], channelType: Database['public']['Enums']['channel_direction']): string {
    const platformEmoji = originalPlatform === 'discord' ? '🔷' : '📱'
    const typeEmoji = channelType === 'two-ways' ? '↔️' : '➡️'
    
    return `${platformEmoji} ${typeEmoji} <b>${this.escapeHtmlForTelegram(username)}</b>\n${this.escapeHtmlForTelegram(content)}`
  }

  private formatEditedMessageForDiscord(username: string, content: string, originalPlatform: Database['public']['Enums']['platform'], channelType: Database['public']['Enums']['channel_direction']): string {
    const platformEmoji = originalPlatform === 'telegram' ? '📱' : '🔷'
    const typeEmoji = channelType === 'two-ways' ? '↔️' : '➡️'
    
    return `${platformEmoji} ${typeEmoji} **${username}**\n${content}`
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  private escapeHtmlForTelegram(text: string): string {
    // More conservative HTML escaping for Telegram
    // Only escape characters that absolutely need to be escaped for HTML parsing
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Don't escape quotes and apostrophes for Telegram - they cause display issues
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