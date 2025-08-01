import { canThrow } from './lib/can-throw';
import { supabaseAdmin as supabase } from './lib/supabase'
import { crossPlatformMessenger } from './lib/cross-platform-messenger'

console.log("Hello via Bun!");

// Initialize cross-platform messaging
async function initializeMessaging() {
    try {
        await crossPlatformMessenger.initialize()
        console.log('🚀 Cross-platform messaging initialized!')
    } catch (error) {
        console.error('❌ Failed to initialize messaging:', error)
    }
}

// Example: Test Supabase connection and setup realtime
async function testSupabase() {
    const [data, err] = await canThrow(() => supabase.auth.getSession())
    console.log('Session check:', data, err)

    if(err || !data) return console.error('Session error:', err)
    if(data.error) return console.error('Auth error:', data.error)
    
    console.log('Supabase connected successfully!')
    console.log('Current session:', data.data.session ? 'Authenticated' : 'Not authenticated')
    
    // Setup realtime channel for both broadcast and table updates
    const channel = supabase.channel('realtime_messages')
    
    // Listen for broadcast messages
    channel.on('broadcast', { event: 'message' }, (payload) => {
        console.log('📡 Broadcast message received:', payload)
    })
    
    // Listen for any broadcast event (catch-all)
    channel.on('broadcast', { event: '*' }, (payload) => {
        console.log('📡 Any broadcast event:', payload)
    })
    
    // Listen for table updates on realtime_messages table
    channel.on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'realtime_messages' 
    }, async (payload) => {
        console.log('🗄️ Table update:', payload)
        console.log('Event type:', payload.eventType)
        console.log('New record:', payload.new)
        console.log('Old record:', payload.old)
        
        // Handle cross-platform messaging for INSERT events
        if (payload.eventType === 'INSERT' && payload.new) {
            console.log('🔄 Processing cross-platform message...')
            await crossPlatformMessenger.handleMessage(payload.new as any)
        }
    })
    
    // Subscribe to the channel
    channel.subscribe((status) => {
        console.log('🔌 Realtime subscription status:', status)
        if (status === 'SUBSCRIBED') {
            console.log('✅ Successfully subscribed to realtime channel!')
        } else if (status === 'CHANNEL_ERROR') {
            console.error('❌ Channel subscription error - check your Supabase configuration')
        } else if (status === 'TIMED_OUT') {
            console.error('⏰ Channel subscription timed out')
        }
    })
    
    return channel
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🔄 Received SIGINT, shutting down gracefully...')
    await crossPlatformMessenger.shutdown()
    process.exit(0)
})

process.on('SIGTERM', async () => {
    console.log('\n🔄 Received SIGTERM, shutting down gracefully...')
    await crossPlatformMessenger.shutdown()
    process.exit(0)
})

// Initialize everything
async function main() {
    await initializeMessaging()
    await testSupabase()
}

main().catch((error) => {
    console.error('❌ Application startup failed:', error)
    process.exit(1)
})