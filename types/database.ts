export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          user_id: string
          display_name: string | null
          avatar_url: string | null
          role: 'user' | 'sub_admin' | 'admin'
          credits: number
          unlimited_credits: boolean
          subscription_tier: 'free' | 'pro' | 'unlimited'
          account_status: 'active' | 'disabled'
          account_expires_at: string | null
          owner_sub_admin_id: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          display_name?: string | null
          avatar_url?: string | null
          role?: 'user' | 'sub_admin' | 'admin'
          credits?: number
          unlimited_credits?: boolean
          subscription_tier?: 'free' | 'pro' | 'unlimited'
          account_status?: 'active' | 'disabled'
          account_expires_at?: string | null
          owner_sub_admin_id?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          display_name?: string | null
          avatar_url?: string | null
          role?: 'user' | 'sub_admin' | 'admin'
          credits?: number
          unlimited_credits?: boolean
          subscription_tier?: 'free' | 'pro' | 'unlimited'
          account_status?: 'active' | 'disabled'
          account_expires_at?: string | null
          owner_sub_admin_id?: string | null
          created_by?: string | null
          created_at?: string
        }
      }
      conversations: {
        Row: {
          id: string
          user_id: string
          title: string
          model_used: string
          project_id?: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title?: string
          model_used: string
          project_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          model_used?: string
          project_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      projects: {
        Row: {
          id: string
          user_id: string
          name: string
          description: string | null
          instructions: string | null
          icon: string | null
          color: string | null
          archived_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          description?: string | null
          instructions?: string | null
          icon?: string | null
          color?: string | null
          archived_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          description?: string | null
          instructions?: string | null
          icon?: string | null
          color?: string | null
          archived_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      project_memories: {
        Row: {
          id: string
          project_id: string
          user_id: string
          memory_type: string | null
          title: string | null
          content: string
          importance: number
          source_type: string | null
          source_id: string | null
          last_used_at: string | null
          archived_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          user_id: string
          memory_type?: string | null
          title?: string | null
          content: string
          importance?: number
          source_type?: string | null
          source_id?: string | null
          last_used_at?: string | null
          archived_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          user_id?: string
          memory_type?: string | null
          title?: string | null
          content?: string
          importance?: number
          source_type?: string | null
          source_id?: string | null
          last_used_at?: string | null
          archived_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      messages: {
        Row: {
          id: string
          conversation_id: string
          role: 'user' | 'assistant'
          content: string
          model: string
          created_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          role: 'user' | 'assistant'
          content: string
          model: string
          created_at?: string
        }
        Update: {
          id?: string
          conversation_id?: string
          role?: 'user' | 'assistant'
          content?: string
          model?: string
          created_at?: string
        }
      }
      subscriptions: {
        Row: {
          id: string
          user_id: string
          stripe_customer_id: string
          stripe_subscription_id: string | null
          tier: 'free' | 'pro' | 'unlimited'
          status: 'active' | 'canceled' | 'past_due' | 'trialing'
          current_period_end: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          stripe_customer_id: string
          stripe_subscription_id?: string | null
          tier?: 'free' | 'pro' | 'unlimited'
          status?: 'active' | 'canceled' | 'past_due' | 'trialing'
          current_period_end?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string | null
          tier?: 'free' | 'pro' | 'unlimited'
          status?: 'active' | 'canceled' | 'past_due' | 'trialing'
          current_period_end?: string | null
          created_at?: string
        }
      }
      credit_transactions: {
        Row: {
          id: string
          user_id: string
          amount: number
          type: 'deduction' | 'top_up' | 'grant'
          description: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          amount: number
          type: 'deduction' | 'top_up' | 'grant'
          description: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          amount?: number
          type?: 'deduction' | 'top_up' | 'grant'
          description?: string
          created_at?: string
        }
      }
    }
  }
}
