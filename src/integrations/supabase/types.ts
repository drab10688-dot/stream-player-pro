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
      active_connections: {
        Row: {
          city: string | null
          client_id: string
          connected_at: string
          country: string | null
          device_id: string
          id: string
          ip_address: string | null
          last_heartbeat: string
          watching_channel_id: string | null
        }
        Insert: {
          city?: string | null
          client_id: string
          connected_at?: string
          country?: string | null
          device_id: string
          id?: string
          ip_address?: string | null
          last_heartbeat?: string
          watching_channel_id?: string | null
        }
        Update: {
          city?: string | null
          client_id?: string
          connected_at?: string
          country?: string | null
          device_id?: string
          id?: string
          ip_address?: string | null
          last_heartbeat?: string
          watching_channel_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "active_connections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "active_connections_watching_channel_id_fkey"
            columns: ["watching_channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      ads: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          message: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          message: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          message?: string
          title?: string
        }
        Relationships: []
      }
      channel_health_logs: {
        Row: {
          channel_id: string
          checked_at: string
          checked_by: string | null
          error_message: string | null
          id: string
          response_code: number | null
          status: string
        }
        Insert: {
          channel_id: string
          checked_at?: string
          checked_by?: string | null
          error_message?: string | null
          id?: string
          response_code?: number | null
          status?: string
        }
        Update: {
          channel_id?: string
          checked_at?: string
          checked_by?: string | null
          error_message?: string | null
          id?: string
          response_code?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_health_logs_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          auto_disabled: boolean
          category: string
          consecutive_failures: number
          created_at: string
          id: string
          is_active: boolean
          keep_alive: boolean
          last_checked_at: string | null
          logo_url: string | null
          name: string
          sort_order: number | null
          url: string
        }
        Insert: {
          auto_disabled?: boolean
          category?: string
          consecutive_failures?: number
          created_at?: string
          id?: string
          is_active?: boolean
          keep_alive?: boolean
          last_checked_at?: string | null
          logo_url?: string | null
          name: string
          sort_order?: number | null
          url: string
        }
        Update: {
          auto_disabled?: boolean
          category?: string
          consecutive_failures?: number
          created_at?: string
          id?: string
          is_active?: boolean
          keep_alive?: boolean
          last_checked_at?: string | null
          logo_url?: string | null
          name?: string
          sort_order?: number | null
          url?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          created_at: string
          expiry_date: string
          id: string
          is_active: boolean
          max_screens: number
          notes: string | null
          password: string
          plan_id: string | null
          playlist_token: string | null
          reseller_id: string | null
          updated_at: string
          username: string
          vod_enabled: boolean
        }
        Insert: {
          created_at?: string
          expiry_date: string
          id?: string
          is_active?: boolean
          max_screens?: number
          notes?: string | null
          password: string
          plan_id?: string | null
          playlist_token?: string | null
          reseller_id?: string | null
          updated_at?: string
          username: string
          vod_enabled?: boolean
        }
        Update: {
          created_at?: string
          expiry_date?: string
          id?: string
          is_active?: boolean
          max_screens?: number
          notes?: string | null
          password?: string
          plan_id?: string | null
          playlist_token?: string | null
          reseller_id?: string | null
          updated_at?: string
          username?: string
          vod_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "clients_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_reseller_id_fkey"
            columns: ["reseller_id"]
            isOneToOne: false
            referencedRelation: "resellers"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          categories: string[]
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          price: number | null
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          categories?: string[]
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          price?: number | null
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          categories?: string[]
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          price?: number | null
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      resellers: {
        Row: {
          commission_percent: number | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          max_clients: number
          name: string
          notes: string | null
          password: string
          phone: string | null
          updated_at: string
          username: string
        }
        Insert: {
          commission_percent?: number | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          max_clients?: number
          name: string
          notes?: string | null
          password: string
          phone?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          commission_percent?: number | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          max_clients?: number
          name?: string
          notes?: string | null
          password?: string
          phone?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      system_backups: {
        Row: {
          created_at: string
          created_by: string | null
          file_path: string | null
          file_size: number | null
          id: string
          includes_config: boolean
          includes_db: boolean
          name: string
          notes: string | null
          status: string
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          includes_config?: boolean
          includes_db?: boolean
          name: string
          notes?: string | null
          status?: string
          type?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          includes_config?: boolean
          includes_db?: boolean
          name?: string
          notes?: string | null
          status?: string
          type?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vod_episodes: {
        Row: {
          created_at: string
          description: string | null
          duration_minutes: number | null
          episode_number: number
          id: string
          is_active: boolean
          poster_url: string | null
          season_id: string
          sort_order: number | null
          title: string
          updated_at: string
          video_filename: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          episode_number?: number
          id?: string
          is_active?: boolean
          poster_url?: string | null
          season_id: string
          sort_order?: number | null
          title: string
          updated_at?: string
          video_filename: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          episode_number?: number
          id?: string
          is_active?: boolean
          poster_url?: string | null
          season_id?: string
          sort_order?: number | null
          title?: string
          updated_at?: string
          video_filename?: string
        }
        Relationships: [
          {
            foreignKeyName: "vod_episodes_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "vod_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      vod_items: {
        Row: {
          category: string
          created_at: string
          description: string | null
          duration_minutes: number | null
          id: string
          is_active: boolean
          poster_url: string | null
          sort_order: number | null
          title: string
          updated_at: string
          video_filename: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_active?: boolean
          poster_url?: string | null
          sort_order?: number | null
          title: string
          updated_at?: string
          video_filename: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_active?: boolean
          poster_url?: string | null
          sort_order?: number | null
          title?: string
          updated_at?: string
          video_filename?: string
        }
        Relationships: []
      }
      vod_seasons: {
        Row: {
          created_at: string
          id: string
          poster_url: string | null
          season_number: number
          series_id: string
          sort_order: number | null
          title: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          poster_url?: string | null
          season_number?: number
          series_id: string
          sort_order?: number | null
          title?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          poster_url?: string | null
          season_number?: number
          series_id?: string
          sort_order?: number | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vod_seasons_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "vod_series"
            referencedColumns: ["id"]
          },
        ]
      }
      vod_series: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          poster_url: string | null
          sort_order: number | null
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          poster_url?: string | null
          sort_order?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          poster_url?: string | null
          sort_order?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin"
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
    Enums: {
      app_role: ["admin"],
    },
  },
} as const
