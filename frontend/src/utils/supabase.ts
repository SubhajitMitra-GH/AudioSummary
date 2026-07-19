import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Session {
  id: string; // UUIDv4
  session_title: string; // Ciphertext (AES encrypted)
  created_at: string;
  synced?: boolean;
}

export interface ChatMessage {
  id: string;
  session_id: string; // UUIDv4
  sender: 'user' | 'assistant';
  message_text: string; // Ciphertext (AES encrypted)
  created_at: string;
  synced?: boolean;
}
