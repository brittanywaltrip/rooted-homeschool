export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          child_ids: string[] | null
          created_at: string | null
          days: number[] | null
          duration_minutes: number | null
          emoji: string | null
          frequency: string
          id: string
          is_active: boolean | null
          location: string | null
          name: string
          scheduled_start_time: string | null
          school_year_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          child_ids?: string[] | null
          created_at?: string | null
          days?: number[] | null
          duration_minutes?: number | null
          emoji?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          location?: string | null
          name: string
          scheduled_start_time?: string | null
          school_year_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          child_ids?: string[] | null
          created_at?: string | null
          days?: number[] | null
          duration_minutes?: number | null
          emoji?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          location?: string | null
          name?: string
          scheduled_start_time?: string | null
          school_year_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_school_year_id_fkey"
            columns: ["school_year_id"]
            isOneToOne: false
            referencedRelation: "school_years"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_logs: {
        Row: {
          activity_id: string
          completed: boolean | null
          completed_at: string | null
          created_at: string | null
          date: string
          id: string
          is_backfill: boolean | null
          minutes_spent: number | null
          notes: string | null
          school_year_id: string | null
          started_at: string | null
          user_id: string
        }
        Insert: {
          activity_id: string
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          date: string
          id?: string
          is_backfill?: boolean | null
          minutes_spent?: number | null
          notes?: string | null
          school_year_id?: string | null
          started_at?: string | null
          user_id: string
        }
        Update: {
          activity_id?: string
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          date?: string
          id?: string
          is_backfill?: boolean | null
          minutes_spent?: number | null
          notes?: string | null
          school_year_id?: string | null
          started_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_school_year_id_fkey"
            columns: ["school_year_id"]
            isOneToOne: false
            referencedRelation: "school_years"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliates: {
        Row: {
          clicks: number | null
          code: string
          commission_rate: number | null
          contact_email: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          notes: string | null
          paypal_email: string | null
          stripe_api_id: string | null
          stripe_coupon_id: string
          user_id: string | null
        }
        Insert: {
          clicks?: number | null
          code: string
          commission_rate?: number | null
          contact_email?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          notes?: string | null
          paypal_email?: string | null
          stripe_api_id?: string | null
          stripe_coupon_id: string
          user_id?: string | null
        }
        Update: {
          clicks?: number | null
          code?: string
          commission_rate?: number | null
          contact_email?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          notes?: string | null
          paypal_email?: string | null
          stripe_api_id?: string | null
          stripe_coupon_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          count: number | null
          id: string
          month: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          count?: number | null
          id?: string
          month: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          count?: number | null
          id?: string
          month?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_events: {
        Row: {
          created_at: string | null
          id: string
          payload: Json | null
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          payload?: Json | null
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          payload?: Json | null
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      appointments: {
        Row: {
          child_ids: string[] | null
          completed: boolean | null
          created_at: string | null
          date: string
          duration_minutes: number | null
          emoji: string | null
          id: string
          is_recurring: boolean | null
          location: string | null
          notes: string | null
          recurrence_rule: Json | null
          time: string | null
          title: string
          user_id: string
        }
        Insert: {
          child_ids?: string[] | null
          completed?: boolean | null
          created_at?: string | null
          date: string
          duration_minutes?: number | null
          emoji?: string | null
          id?: string
          is_recurring?: boolean | null
          location?: string | null
          notes?: string | null
          recurrence_rule?: Json | null
          time?: string | null
          title: string
          user_id: string
        }
        Update: {
          child_ids?: string[] | null
          completed?: boolean | null
          created_at?: string | null
          date?: string
          duration_minutes?: number | null
          emoji?: string | null
          id?: string
          is_recurring?: boolean | null
          location?: string | null
          notes?: string | null
          recurrence_rule?: Json | null
          time?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      attendance: {
        Row: {
          child_id: string | null
          created_at: string
          day: string
          id: string
          present: boolean
          user_id: string
        }
        Insert: {
          child_id?: string | null
          created_at?: string
          day: string
          id?: string
          present?: boolean
          user_id: string
        }
        Update: {
          child_id?: string | null
          created_at?: string
          day?: string
          id?: string
          present?: boolean
          user_id?: string
        }
        Relationships: []
      }
      badges: {
        Row: {
          badge_key: string
          badge_type: string
          child_id: string | null
          earned_at: string | null
          id: string
          school_year_id: string | null
          tier: string
          user_id: string
        }
        Insert: {
          badge_key: string
          badge_type: string
          child_id?: string | null
          earned_at?: string | null
          id?: string
          school_year_id?: string | null
          tier: string
          user_id: string
        }
        Update: {
          badge_key?: string
          badge_type?: string
          child_id?: string | null
          earned_at?: string | null
          id?: string
          school_year_id?: string | null
          tier?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "badges_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badges_school_year_id_fkey"
            columns: ["school_year_id"]
            isOneToOne: false
            referencedRelation: "school_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      child_ui_prefs: {
        Row: {
          child_id: string
          created_at: string
          id: string
          tree_style: string
          updated_at: string
          user_id: string
        }
        Insert: {
          child_id: string
          created_at?: string
          id?: string
          tree_style?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          child_id?: string
          created_at?: string
          id?: string
          tree_style?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      children: {
        Row: {
          archived: boolean
          avatar_style: string
          avatar_url: string | null
          avatar_value: string
          birthday: string | null
          color: string
          created_at: string
          graduated_at: string | null
          id: string
          name: string
          name_key: string | null
          sort_order: number | null
          user_id: string
        }
        Insert: {
          archived?: boolean
          avatar_style?: string
          avatar_url?: string | null
          avatar_value?: string
          birthday?: string | null
          color?: string
          created_at?: string
          graduated_at?: string | null
          id?: string
          name: string
          name_key?: string | null
          sort_order?: number | null
          user_id: string
        }
        Update: {
          archived?: boolean
          avatar_style?: string
          avatar_url?: string | null
          avatar_value?: string
          birthday?: string | null
          color?: string
          created_at?: string
          graduated_at?: string | null
          id?: string
          name?: string
          name_key?: string | null
          sort_order?: number | null
          user_id?: string
        }
        Relationships: []
      }
      commission_payments: {
        Row: {
          affiliate_code: string
          amount: number
          created_at: string | null
          id: string
          month: string
          notes: string | null
          paid_at: string | null
          paypal_email: string | null
        }
        Insert: {
          affiliate_code: string
          amount: number
          created_at?: string | null
          id?: string
          month: string
          notes?: string | null
          paid_at?: string | null
          paypal_email?: string | null
        }
        Update: {
          affiliate_code?: string
          amount?: number
          created_at?: string | null
          id?: string
          month?: string
          notes?: string | null
          paid_at?: string | null
          paypal_email?: string | null
        }
        Relationships: []
      }
      curriculum_goals: {
        Row: {
          child_id: string | null
          created_at: string | null
          current_lesson: number
          curriculum_name: string
          default_minutes: number
          icon_emoji: string | null
          id: string
          is_backfilled: boolean | null
          lessons_per_day: number
          scheduled_start_time: string | null
          school_days: string[] | null
          school_year: string | null
          school_year_id: string | null
          start_at_lesson: number | null
          start_date: string | null
          subject_label: string | null
          target_date: string | null
          total_lessons: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          child_id?: string | null
          created_at?: string | null
          current_lesson?: number
          curriculum_name: string
          default_minutes?: number
          icon_emoji?: string | null
          id?: string
          is_backfilled?: boolean | null
          lessons_per_day?: number
          scheduled_start_time?: string | null
          school_days?: string[] | null
          school_year?: string | null
          school_year_id?: string | null
          start_at_lesson?: number | null
          start_date?: string | null
          subject_label?: string | null
          target_date?: string | null
          total_lessons: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          child_id?: string | null
          created_at?: string | null
          current_lesson?: number
          curriculum_name?: string
          default_minutes?: number
          icon_emoji?: string | null
          id?: string
          is_backfilled?: boolean | null
          lessons_per_day?: number
          scheduled_start_time?: string | null
          school_days?: string[] | null
          school_year?: string | null
          school_year_id?: string | null
          start_at_lesson?: number | null
          start_date?: string | null
          subject_label?: string | null
          target_date?: string | null
          total_lessons?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "curriculum_goals_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curriculum_goals_school_year_id_fkey"
            columns: ["school_year_id"]
            isOneToOne: false
            referencedRelation: "school_years"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_reflections: {
        Row: {
          created_at: string
          date: string
          id: string
          is_private: boolean | null
          reflection: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          is_private?: boolean | null
          reflection: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          is_private?: boolean | null
          reflection?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      earned_awards: {
        Row: {
          award_type: string
          certificate_data: Json | null
          child_id: string | null
          downloaded_at: string | null
          earned_at: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          award_type: string
          certificate_data?: Json | null
          child_id?: string | null
          downloaded_at?: string | null
          earned_at?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          award_type?: string
          certificate_data?: Json | null
          child_id?: string | null
          downloaded_at?: string | null
          earned_at?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      email_log: {
        Row: {
          email_type: string
          id: string
          sent_at: string | null
          user_id: string | null
        }
        Insert: {
          email_type: string
          id?: string
          sent_at?: string | null
          user_id?: string | null
        }
        Update: {
          email_type?: string
          id?: string
          sent_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      family_invites: {
        Row: {
          created_at: string | null
          email: string | null
          email_opt_out: boolean | null
          first_visited_at: string | null
          id: string
          is_active: boolean | null
          last_visited_at: string | null
          token: string
          trial_ends_at: string | null
          trial_started_at: string | null
          trial_warning_sent_at: string | null
          user_id: string
          viewer_name: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          email_opt_out?: boolean | null
          first_visited_at?: string | null
          id?: string
          is_active?: boolean | null
          last_visited_at?: string | null
          token?: string
          trial_ends_at?: string | null
          trial_started_at?: string | null
          trial_warning_sent_at?: string | null
          user_id: string
          viewer_name?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          email_opt_out?: boolean | null
          first_visited_at?: string | null
          id?: string
          is_active?: boolean | null
          last_visited_at?: string | null
          token?: string
          trial_ends_at?: string | null
          trial_started_at?: string | null
          trial_warning_sent_at?: string | null
          user_id?: string
          viewer_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_invites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      family_notifications: {
        Row: {
          actor_name: string
          created_at: string | null
          emoji: string | null
          id: string
          memory_id: string | null
          preview: string | null
          read: boolean | null
          read_at: string | null
          type: string
          user_id: string
        }
        Insert: {
          actor_name: string
          created_at?: string | null
          emoji?: string | null
          id?: string
          memory_id?: string | null
          preview?: string | null
          read?: boolean | null
          read_at?: string | null
          type: string
          user_id: string
        }
        Update: {
          actor_name?: string
          created_at?: string | null
          emoji?: string | null
          id?: string
          memory_id?: string | null
          preview?: string | null
          read?: boolean | null
          read_at?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_notifications_memory_id_fkey"
            columns: ["memory_id"]
            isOneToOne: false
            referencedRelation: "memories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      family_updates: {
        Row: {
          created_at: string | null
          date_from: string | null
          date_to: string | null
          family_name: string | null
          id: string
          narrative: string | null
          stats: Json | null
          token: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          date_from?: string | null
          date_to?: string | null
          family_name?: string | null
          id?: string
          narrative?: string | null
          stats?: Json | null
          token: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          date_from?: string | null
          date_to?: string | null
          family_name?: string | null
          id?: string
          narrative?: string | null
          stats?: Json | null
          token?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_updates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_overrides: {
        Row: {
          created_at: string | null
          id: string
          lesson_id: string | null
          override_date: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          lesson_id?: string | null
          override_date?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          lesson_id?: string | null
          override_date?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      lessons: {
        Row: {
          child_id: string | null
          completed: boolean
          completed_at: string | null
          counts_toward_goal: boolean
          created_at: string
          curriculum_goal_id: string | null
          date: string
          goal_id: string | null
          hours: number
          id: string
          is_backfill: boolean | null
          lesson_number: number | null
          minutes_spent: number | null
          notes: string | null
          scheduled_date: string | null
          scheduled_source: string | null
          school_year: string | null
          school_year_id: string | null
          started_at: string | null
          subject_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          child_id?: string | null
          completed?: boolean
          completed_at?: string | null
          counts_toward_goal?: boolean
          created_at?: string
          curriculum_goal_id?: string | null
          date: string
          goal_id?: string | null
          hours?: number
          id?: string
          is_backfill?: boolean | null
          lesson_number?: number | null
          minutes_spent?: number | null
          notes?: string | null
          scheduled_date?: string | null
          scheduled_source?: string | null
          school_year?: string | null
          school_year_id?: string | null
          started_at?: string | null
          subject_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          child_id?: string | null
          completed?: boolean
          completed_at?: string | null
          counts_toward_goal?: boolean
          created_at?: string
          curriculum_goal_id?: string | null
          date?: string
          goal_id?: string | null
          hours?: number
          id?: string
          is_backfill?: boolean | null
          lesson_number?: number | null
          minutes_spent?: number | null
          notes?: string | null
          scheduled_date?: string | null
          scheduled_source?: string | null
          school_year?: string | null
          school_year_id?: string | null
          started_at?: string | null
          subject_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_curriculum_goal_id_fkey"
            columns: ["curriculum_goal_id"]
            isOneToOne: false
            referencedRelation: "curriculum_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_school_year_id_fkey"
            columns: ["school_year_id"]
            isOneToOne: false
            referencedRelation: "school_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      list_items: {
        Row: {
          child_id: string | null
          created_at: string | null
          done: boolean | null
          id: string
          list_id: string
          sort_order: number | null
          text: string
          user_id: string
        }
        Insert: {
          child_id?: string | null
          created_at?: string | null
          done?: boolean | null
          id?: string
          list_id: string
          sort_order?: number | null
          text: string
          user_id: string
        }
        Update: {
          child_id?: string | null
          created_at?: string | null
          done?: boolean | null
          id?: string
          list_id?: string
          sort_order?: number | null
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_items_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      lists: {
        Row: {
          archived: boolean | null
          archived_at: string | null
          created_at: string | null
          emoji: string | null
          id: string
          name: string
          sort_order: number | null
          user_id: string
        }
        Insert: {
          archived?: boolean | null
          archived_at?: string | null
          created_at?: string | null
          emoji?: string | null
          id?: string
          name: string
          sort_order?: number | null
          user_id: string
        }
        Update: {
          archived?: boolean | null
          archived_at?: string | null
          created_at?: string | null
          emoji?: string | null
          id?: string
          name?: string
          sort_order?: number | null
          user_id?: string
        }
        Relationships: []
      }
      memories: {
        Row: {
          caption: string | null
          child_id: string | null
          created_at: string | null
          date: string
          duration_minutes: number | null
          family_visible: boolean | null
          favorite: boolean | null
          id: string
          include_in_book: boolean | null
          page_order: number | null
          photo_url: string | null
          title: string | null
          type: string
          updated_at: string | null
          user_id: string | null
          yearbook_bookmark: boolean | null
        }
        Insert: {
          caption?: string | null
          child_id?: string | null
          created_at?: string | null
          date?: string
          duration_minutes?: number | null
          family_visible?: boolean | null
          favorite?: boolean | null
          id?: string
          include_in_book?: boolean | null
          page_order?: number | null
          photo_url?: string | null
          title?: string | null
          type?: string
          updated_at?: string | null
          user_id?: string | null
          yearbook_bookmark?: boolean | null
        }
        Update: {
          caption?: string | null
          child_id?: string | null
          created_at?: string | null
          date?: string
          duration_minutes?: number | null
          family_visible?: boolean | null
          favorite?: boolean | null
          id?: string
          include_in_book?: boolean | null
          page_order?: number | null
          photo_url?: string | null
          title?: string | null
          type?: string
          updated_at?: string | null
          user_id?: string | null
          yearbook_bookmark?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "memories_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memories_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_comments: {
        Row: {
          body: string
          commenter_key: string
          commenter_name: string
          created_at: string | null
          family_token: string
          id: string
          invite_token: string | null
          memory_id: string
          viewer_name: string | null
        }
        Insert: {
          body: string
          commenter_key: string
          commenter_name: string
          created_at?: string | null
          family_token: string
          id?: string
          invite_token?: string | null
          memory_id: string
          viewer_name?: string | null
        }
        Update: {
          body?: string
          commenter_key?: string
          commenter_name?: string
          created_at?: string | null
          family_token?: string
          id?: string
          invite_token?: string | null
          memory_id?: string
          viewer_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memory_comments_family_token_fkey"
            columns: ["family_token"]
            isOneToOne: false
            referencedRelation: "family_invites"
            referencedColumns: ["token"]
          },
          {
            foreignKeyName: "memory_comments_invite_token_fkey"
            columns: ["invite_token"]
            isOneToOne: false
            referencedRelation: "family_invites"
            referencedColumns: ["token"]
          },
          {
            foreignKeyName: "memory_comments_memory_id_fkey"
            columns: ["memory_id"]
            isOneToOne: false
            referencedRelation: "memories"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_reactions: {
        Row: {
          created_at: string | null
          emoji: string
          family_token: string
          id: string
          invite_token: string | null
          memory_id: string
          reactor_key: string
          reactor_name: string
          viewer_name: string | null
        }
        Insert: {
          created_at?: string | null
          emoji: string
          family_token: string
          id?: string
          invite_token?: string | null
          memory_id: string
          reactor_key: string
          reactor_name: string
          viewer_name?: string | null
        }
        Update: {
          created_at?: string | null
          emoji?: string
          family_token?: string
          id?: string
          invite_token?: string | null
          memory_id?: string
          reactor_key?: string
          reactor_name?: string
          viewer_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memory_reactions_family_token_fkey"
            columns: ["family_token"]
            isOneToOne: false
            referencedRelation: "family_invites"
            referencedColumns: ["token"]
          },
          {
            foreignKeyName: "memory_reactions_invite_token_fkey"
            columns: ["invite_token"]
            isOneToOne: false
            referencedRelation: "family_invites"
            referencedColumns: ["token"]
          },
          {
            foreignKeyName: "memory_reactions_memory_id_fkey"
            columns: ["memory_id"]
            isOneToOne: false
            referencedRelation: "memories"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_applications: {
        Row: {
          audience_size: string | null
          created_at: string | null
          email: string
          has_rooted_account: boolean | null
          id: string
          name: string
          notes: string | null
          paypal_email: string | null
          reviewed_at: string | null
          rooted_account_email: string | null
          social_handle: string | null
          status: string | null
          why_rooted: string | null
        }
        Insert: {
          audience_size?: string | null
          created_at?: string | null
          email: string
          has_rooted_account?: boolean | null
          id?: string
          name: string
          notes?: string | null
          paypal_email?: string | null
          reviewed_at?: string | null
          rooted_account_email?: string | null
          social_handle?: string | null
          status?: string | null
          why_rooted?: string | null
        }
        Update: {
          audience_size?: string | null
          created_at?: string | null
          email?: string
          has_rooted_account?: boolean | null
          id?: string
          name?: string
          notes?: string | null
          paypal_email?: string | null
          reviewed_at?: string | null
          rooted_account_email?: string | null
          social_handle?: string | null
          status?: string | null
          why_rooted?: string | null
        }
        Relationships: []
      }
      partner_apps: {
        Row: {
          about_journey: string | null
          created_at: string | null
          email: string
          first_name: string
          id: string
          last_name: string
          platform_sizes: Json | null
          platforms: string[] | null
          status: string | null
          used_rooted: string | null
        }
        Insert: {
          about_journey?: string | null
          created_at?: string | null
          email: string
          first_name: string
          id?: string
          last_name: string
          platform_sizes?: Json | null
          platforms?: string[] | null
          status?: string | null
          used_rooted?: string | null
        }
        Update: {
          about_journey?: string | null
          created_at?: string | null
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          platform_sizes?: Json | null
          platforms?: string[] | null
          status?: string | null
          used_rooted?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          ai_update_last_generated: string | null
          created_at: string
          current_period_end: string | null
          current_streak_days: number | null
          display_name: string | null
          email_marketing: boolean | null
          email_unsubscribed: boolean | null
          email_weekly_summary: boolean | null
          family_photo_url: string | null
          first_name: string | null
          id: string
          is_pro: boolean | null
          last_logged_date: string | null
          last_name: string | null
          legacy_free: boolean | null
          longest_streak_days: number | null
          onboarded: boolean | null
          onboarded_at: string | null
          partner_email: string | null
          photo_count: number | null
          plan_type: string | null
          printable_style: string | null
          re_engagement_sent: boolean | null
          referred_by: string | null
          school_days: string[] | null
          school_year_end: string | null
          school_year_start: string | null
          state: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_end_date: string | null
          subscription_status: string | null
          unsubscribe_token: string | null
          yearbook_closed_at: string | null
          yearbook_opened_at: string | null
          yearbook_settings: Json | null
          yearly_review_count: number | null
          yearly_review_reset_year: number | null
        }
        Insert: {
          ai_update_last_generated?: string | null
          created_at?: string
          current_period_end?: string | null
          current_streak_days?: number | null
          display_name?: string | null
          email_marketing?: boolean | null
          email_unsubscribed?: boolean | null
          email_weekly_summary?: boolean | null
          family_photo_url?: string | null
          first_name?: string | null
          id: string
          is_pro?: boolean | null
          last_logged_date?: string | null
          last_name?: string | null
          legacy_free?: boolean | null
          longest_streak_days?: number | null
          onboarded?: boolean | null
          onboarded_at?: string | null
          partner_email?: string | null
          photo_count?: number | null
          plan_type?: string | null
          printable_style?: string | null
          re_engagement_sent?: boolean | null
          referred_by?: string | null
          school_days?: string[] | null
          school_year_end?: string | null
          school_year_start?: string | null
          state?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_end_date?: string | null
          subscription_status?: string | null
          unsubscribe_token?: string | null
          yearbook_closed_at?: string | null
          yearbook_opened_at?: string | null
          yearbook_settings?: Json | null
          yearly_review_count?: number | null
          yearly_review_reset_year?: number | null
        }
        Update: {
          ai_update_last_generated?: string | null
          created_at?: string
          current_period_end?: string | null
          current_streak_days?: number | null
          display_name?: string | null
          email_marketing?: boolean | null
          email_unsubscribed?: boolean | null
          email_weekly_summary?: boolean | null
          family_photo_url?: string | null
          first_name?: string | null
          id?: string
          is_pro?: boolean | null
          last_logged_date?: string | null
          last_name?: string | null
          legacy_free?: boolean | null
          longest_streak_days?: number | null
          onboarded?: boolean | null
          onboarded_at?: string | null
          partner_email?: string | null
          photo_count?: number | null
          plan_type?: string | null
          printable_style?: string | null
          re_engagement_sent?: boolean | null
          referred_by?: string | null
          school_days?: string[] | null
          school_year_end?: string | null
          school_year_start?: string | null
          state?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_end_date?: string | null
          subscription_status?: string | null
          unsubscribe_token?: string | null
          yearbook_closed_at?: string | null
          yearbook_opened_at?: string | null
          yearbook_settings?: Json | null
          yearly_review_count?: number | null
          yearly_review_reset_year?: number | null
        }
        Relationships: []
      }
      referrals: {
        Row: {
          affiliate_code: string
          converted: boolean | null
          created_at: string | null
          id: string
          stripe_session_id: string | null
          user_id: string | null
        }
        Insert: {
          affiliate_code: string
          converted?: boolean | null
          created_at?: string | null
          id?: string
          stripe_session_id?: string | null
          user_id?: string | null
        }
        Update: {
          affiliate_code?: string
          converted?: boolean | null
          created_at?: string | null
          id?: string
          stripe_session_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referrals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          active: boolean
          badge_text: string
          category: string
          consecutive_failures: number | null
          created_at: string
          description: string
          grade_level: string
          id: string
          is_free_pick: boolean
          last_check_status: string | null
          metadata: Json
          sort_order: number
          title: string
          url: string
        }
        Insert: {
          active?: boolean
          badge_text?: string
          category: string
          consecutive_failures?: number | null
          created_at?: string
          description?: string
          grade_level?: string
          id?: string
          is_free_pick?: boolean
          last_check_status?: string | null
          metadata?: Json
          sort_order?: number
          title: string
          url?: string
        }
        Update: {
          active?: boolean
          badge_text?: string
          category?: string
          consecutive_failures?: number | null
          created_at?: string
          description?: string
          grade_level?: string
          id?: string
          is_free_pick?: boolean
          last_check_status?: string | null
          metadata?: Json
          sort_order?: number
          title?: string
          url?: string
        }
        Relationships: []
      }
      schedule_items: {
        Row: {
          child_id: string
          course_id: string | null
          created_at: string | null
          date: string | null
          id: string
          lesson_id: string
          lesson_number: number | null
          scheduled_date: string
          status: string | null
          user_id: string
        }
        Insert: {
          child_id: string
          course_id?: string | null
          created_at?: string | null
          date?: string | null
          id?: string
          lesson_id: string
          lesson_number?: number | null
          scheduled_date: string
          status?: string | null
          user_id: string
        }
        Update: {
          child_id?: string
          course_id?: string | null
          created_at?: string | null
          date?: string | null
          id?: string
          lesson_id?: string
          lesson_number?: number | null
          scheduled_date?: string
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_items_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_items_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      school_years: {
        Row: {
          created_at: string | null
          end_date: string
          id: string
          name: string
          start_date: string
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          end_date: string
          id?: string
          name: string
          start_date: string
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          end_date?: string
          id?: string
          name?: string
          start_date?: string
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_years_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_goals: {
        Row: {
          child_id: string
          created_at: string
          id: string
          paused: boolean | null
          schedule_outdated: boolean | null
          starting_lesson: number
          subject_id: string
          target_date: string
          total_lessons: number
          updated_at: string
          user_id: string
        }
        Insert: {
          child_id: string
          created_at?: string
          id?: string
          paused?: boolean | null
          schedule_outdated?: boolean | null
          starting_lesson?: number
          subject_id: string
          target_date: string
          total_lessons: number
          updated_at?: string
          user_id: string
        }
        Update: {
          child_id?: string
          created_at?: string
          id?: string
          paused?: boolean | null
          schedule_outdated?: boolean | null
          starting_lesson?: number
          subject_id?: string
          target_date?: string
          total_lessons?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subject_goals_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_goals_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      transcript_courses: {
        Row: {
          child_id: string
          course_description: string | null
          course_name: string
          created_at: string | null
          credit_type: string
          credits_earned: number | null
          curriculum_goal_id: string | null
          external_provider: string | null
          grade_letter: string | null
          grade_level: string | null
          grade_percentage: number | null
          grade_points: number | null
          hours_logged: number | null
          id: string
          is_external: boolean | null
          school_year: string
          semester: string | null
          subject_category: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          child_id: string
          course_description?: string | null
          course_name: string
          created_at?: string | null
          credit_type?: string
          credits_earned?: number | null
          curriculum_goal_id?: string | null
          external_provider?: string | null
          grade_letter?: string | null
          grade_level?: string | null
          grade_percentage?: number | null
          grade_points?: number | null
          hours_logged?: number | null
          id?: string
          is_external?: boolean | null
          school_year: string
          semester?: string | null
          subject_category?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          child_id?: string
          course_description?: string | null
          course_name?: string
          created_at?: string | null
          credit_type?: string
          credits_earned?: number | null
          curriculum_goal_id?: string | null
          external_provider?: string | null
          grade_letter?: string | null
          grade_level?: string | null
          grade_percentage?: number | null
          grade_points?: number | null
          hours_logged?: number | null
          id?: string
          is_external?: boolean | null
          school_year?: string
          semester?: string | null
          subject_category?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcript_courses_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcript_courses_curriculum_goal_id_fkey"
            columns: ["curriculum_goal_id"]
            isOneToOne: false
            referencedRelation: "curriculum_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      transcript_settings: {
        Row: {
          child_id: string
          created_at: string | null
          grading_scale: Json | null
          graduation_year: number | null
          id: string
          notes: string | null
          principal_name: string | null
          school_name: string | null
          state: string | null
          updated_at: string | null
          use_weighted_gpa: boolean | null
          user_id: string
        }
        Insert: {
          child_id: string
          created_at?: string | null
          grading_scale?: Json | null
          graduation_year?: number | null
          id?: string
          notes?: string | null
          principal_name?: string | null
          school_name?: string | null
          state?: string | null
          updated_at?: string | null
          use_weighted_gpa?: boolean | null
          user_id: string
        }
        Update: {
          child_id?: string
          created_at?: string | null
          grading_scale?: Json | null
          graduation_year?: number | null
          id?: string
          notes?: string | null
          principal_name?: string | null
          school_name?: string | null
          state?: string | null
          updated_at?: string | null
          use_weighted_gpa?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcript_settings_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
        ]
      }
      user_badges: {
        Row: {
          badge_id: string
          earned_at: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          badge_id: string
          earned_at?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          badge_id?: string
          earned_at?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_badges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vacation_blocks: {
        Row: {
          created_at: string | null
          end_date: string
          id: string
          name: string
          start_date: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          end_date: string
          id?: string
          name: string
          start_date: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          end_date?: string
          id?: string
          name?: string
          start_date?: string
          user_id?: string
        }
        Relationships: []
      }
      yearbook_content: {
        Row: {
          child_id: string | null
          content: string
          content_type: string
          id: string
          question_key: string | null
          updated_at: string | null
          user_id: string
          yearbook_key: string
        }
        Insert: {
          child_id?: string | null
          content?: string
          content_type: string
          id?: string
          question_key?: string | null
          updated_at?: string | null
          user_id: string
          yearbook_key: string
        }
        Update: {
          child_id?: string | null
          content?: string
          content_type?: string
          id?: string
          question_key?: string | null
          updated_at?: string | null
          user_id?: string
          yearbook_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "yearbook_content_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yearbook_content_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      increment_photo_count: { Args: { p_user_id: string }; Returns: undefined }
      seed_default_list: { Args: { p_user_id: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

