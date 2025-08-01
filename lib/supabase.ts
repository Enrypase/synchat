import { createClient } from '@supabase/supabase-js'

// Get environment variables
const supabaseUrl = process.env.PROJECT_URL
const supabaseAnonKey = process.env.ANON_KEY
const supabaseServiceRole = process.env.SERVICE_ROLE

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing PROJECT_URL or ANON_KEY environment variables. Please check your .env file.')
}

if (!supabaseServiceRole) {
  throw new Error('Missing SERVICE_ROLE environment variable. Please check your .env file.')
}

// Regular client for client-side operations (respects RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Service role client for server-side operations (bypasses RLS)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})