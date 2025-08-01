import { canThrow } from './lib/can-throw';
import { supabaseAdmin } from './lib/supabase'
import { crossPlatformMessenger } from './lib/cross-platform-messenger'


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
    const [data, err] = await canThrow(() => supabaseAdmin.auth.getSession())

    if(err || !data) return console.error('Session error:', err)
    if(data.error) return console.error('Auth error:', data.error)
    
    console.log('Supabase connected successfully!')
    console.log('Current session:', data.data.session ? 'Authenticated' : 'Not authenticated')
    
    // Setup realtime channel for both broadcast and table updates
    const channel = supabaseAdmin.channel('realtime_messages')
    
    // Listen for table updates on realtime_messages table
    channel.on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'realtime_messages' 
    }, async (payload) => {   
        console.log("From Supabase:",payload.eventType)
        // Handle cross-platform messaging for INSERT events
        if (payload.eventType === 'INSERT' && payload.new) {
            await crossPlatformMessenger.handleMessage(payload.new as any)
        }
        // Handle message updates for EDIT events  
        else if (payload.eventType === 'UPDATE' && payload.new && payload.old) {
            // Check if this is a deletion (deleted_at was set)
            if (payload.new.deleted_at && !payload.old.deleted_at) {
                console.log("Message deletion detected via database update")
                await crossPlatformMessenger.handleMessageDeletion(payload.new as any)
            } else {
                // Regular content update
                await crossPlatformMessenger.handleMessageUpdate(payload.new as any, payload.old as any)
            }
        }
    })
    
    // Subscribe to the channel to start receiving events
    channel.subscribe((status) => {
        console.log('🔌 Realtime subscription status:', status)
        if (status === 'SUBSCRIBED') {
            console.log('✅ Successfully subscribed to realtime_messages channel!')
        } else if (status === 'CHANNEL_ERROR') {
            console.error('❌ Channel subscription error - check your Supabase configuration')
        } else if (status === 'TIMED_OUT') {
            console.error('⏰ Channel subscription timed out')
        }
    })
    
    return channel
}

// Initialize everything
async function main() {
    await initializeMessaging()
    await testSupabase()
}

main().catch((error) => {
    console.error('❌ Application startup failed:', error)
    process.exit(1)
})