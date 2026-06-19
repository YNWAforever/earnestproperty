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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      articles: {
        Row: {
          author_id: string | null
          category: string | null
          content: string | null
          cover_image: string | null
          created_at: string
          excerpt: string | null
          id: string
          published: boolean
          published_at: string
          reading_minutes: number | null
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          category?: string | null
          content?: string | null
          cover_image?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          published?: boolean
          published_at?: string
          reading_minutes?: number | null
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          category?: string | null
          content?: string | null
          cover_image?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          published?: boolean
          published_at?: string
          reading_minutes?: number | null
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "articles_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      estates: {
        Row: {
          area_max: number | null
          area_min: number | null
          avg_saleable_psf: number | null
          created_at: string
          description: string | null
          developer: string | null
          district_slug: string
          facilities: string[] | null
          hero_image: string | null
          id: string
          lat: number | null
          lng: number | null
          name_en: string | null
          name_zh: string
          phases: number | null
          slug: string
          total_units: number | null
          updated_at: string
          year_completed: number | null
        }
        Insert: {
          area_max?: number | null
          area_min?: number | null
          avg_saleable_psf?: number | null
          created_at?: string
          description?: string | null
          developer?: string | null
          district_slug: string
          facilities?: string[] | null
          hero_image?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name_en?: string | null
          name_zh: string
          phases?: number | null
          slug: string
          total_units?: number | null
          updated_at?: string
          year_completed?: number | null
        }
        Update: {
          area_max?: number | null
          area_min?: number | null
          avg_saleable_psf?: number | null
          created_at?: string
          description?: string | null
          developer?: string | null
          district_slug?: string
          facilities?: string[] | null
          hero_image?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name_en?: string | null
          name_zh?: string
          phases?: number | null
          slug?: string
          total_units?: number | null
          updated_at?: string
          year_completed?: number | null
        }
        Relationships: []
      }
      faqs: {
        Row: {
          answer: string
          created_at: string
          id: string
          question: string
          scope: string
          sort_order: number | null
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          question: string
          scope: string
          sort_order?: number | null
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          question?: string
          scope?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      inquiries: {
        Row: {
          assigned_agent_id: string | null
          created_at: string
          email: string | null
          id: string
          message: string | null
          name: string
          phone: string | null
          property_id: string | null
          source: Database["public"]["Enums"]["inquiry_source"]
          status: Database["public"]["Enums"]["inquiry_status"]
          updated_at: string
        }
        Insert: {
          assigned_agent_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          message?: string | null
          name: string
          phone?: string | null
          property_id?: string | null
          source?: Database["public"]["Enums"]["inquiry_source"]
          status?: Database["public"]["Enums"]["inquiry_status"]
          updated_at?: string
        }
        Update: {
          assigned_agent_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          message?: string | null
          name?: string
          phone?: string | null
          property_id?: string | null
          source?: Database["public"]["Enums"]["inquiry_source"]
          status?: Database["public"]["Enums"]["inquiry_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inquiries_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inquiries_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          branch: string | null
          created_at: string
          id: string
          licence_no: string | null
          name_en: string | null
          name_zh: string | null
          phone: string | null
          slug: string | null
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          branch?: string | null
          created_at?: string
          id: string
          licence_no?: string | null
          name_en?: string | null
          name_zh?: string | null
          phone?: string | null
          slug?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          branch?: string | null
          created_at?: string
          id?: string
          licence_no?: string | null
          name_en?: string | null
          name_zh?: string | null
          phone?: string | null
          slug?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      properties: {
        Row: {
          address: string | null
          agent_id: string | null
          bathrooms: number | null
          bedrooms: number | null
          created_at: string
          deal_type: Database["public"]["Enums"]["deal_type"]
          description: string | null
          district_slug: string
          estate_id: string | null
          featured: boolean
          features: string[] | null
          floor: string | null
          floorplan_url: string | null
          gross_area: number | null
          id: string
          images: string[] | null
          last_scraped_at: string | null
          legacy_detail_id: string | null
          legacy_property_no: string | null
          legacy_source_indexes: string[]
          legacy_url: string | null
          listing_no: string
          management_fee: number | null
          orientation: string | null
          price: number | null
          rent: number | null
          saleable_area: number | null
          source_site: string | null
          status: Database["public"]["Enums"]["property_status"]
          title_en: string | null
          title_zh: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          address?: string | null
          agent_id?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          created_at?: string
          deal_type: Database["public"]["Enums"]["deal_type"]
          description?: string | null
          district_slug: string
          estate_id?: string | null
          featured?: boolean
          features?: string[] | null
          floor?: string | null
          floorplan_url?: string | null
          gross_area?: number | null
          id?: string
          images?: string[] | null
          last_scraped_at?: string | null
          legacy_detail_id?: string | null
          legacy_property_no?: string | null
          legacy_source_indexes?: string[]
          legacy_url?: string | null
          listing_no: string
          management_fee?: number | null
          orientation?: string | null
          price?: number | null
          rent?: number | null
          saleable_area?: number | null
          source_site?: string | null
          status?: Database["public"]["Enums"]["property_status"]
          title_en?: string | null
          title_zh: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          address?: string | null
          agent_id?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          created_at?: string
          deal_type?: Database["public"]["Enums"]["deal_type"]
          description?: string | null
          district_slug?: string
          estate_id?: string | null
          featured?: boolean
          features?: string[] | null
          floor?: string | null
          floorplan_url?: string | null
          gross_area?: number | null
          id?: string
          images?: string[] | null
          last_scraped_at?: string | null
          legacy_detail_id?: string | null
          legacy_property_no?: string | null
          legacy_source_indexes?: string[]
          legacy_url?: string | null
          listing_no?: string
          management_fee?: number | null
          orientation?: string | null
          price?: number | null
          rent?: number | null
          saleable_area?: number | null
          source_site?: string | null
          status?: Database["public"]["Enums"]["property_status"]
          title_en?: string | null
          title_zh?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_estate_id_fkey"
            columns: ["estate_id"]
            isOneToOne: false
            referencedRelation: "estates"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          created_at: string
          deal_date: string | null
          deal_type: Database["public"]["Enums"]["deal_type"]
          estate_id: string | null
          id: string
          price: number | null
          saleable_area: number | null
          saleable_psf: number | null
          unit: string | null
        }
        Insert: {
          created_at?: string
          deal_date?: string | null
          deal_type: Database["public"]["Enums"]["deal_type"]
          estate_id?: string | null
          id?: string
          price?: number | null
          saleable_area?: number | null
          saleable_psf?: number | null
          unit?: string | null
        }
        Update: {
          created_at?: string
          deal_date?: string | null
          deal_type?: Database["public"]["Enums"]["deal_type"]
          estate_id?: string | null
          id?: string
          price?: number | null
          saleable_area?: number | null
          saleable_psf?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_estate_id_fkey"
            columns: ["estate_id"]
            isOneToOne: false
            referencedRelation: "estates"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
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
      app_role: "admin" | "manager" | "agent"
      deal_type: "sale" | "rent"
      inquiry_source: "website" | "whatsapp" | "facebook" | "instagram"
      inquiry_status:
        | "new"
        | "contacted"
        | "viewing"
        | "negotiating"
        | "closed_won"
        | "closed_lost"
      property_status: "draft" | "active" | "sold" | "rented" | "offline"
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
      app_role: ["admin", "manager", "agent"],
      deal_type: ["sale", "rent"],
      inquiry_source: ["website", "whatsapp", "facebook", "instagram"],
      inquiry_status: [
        "new",
        "contacted",
        "viewing",
        "negotiating",
        "closed_won",
        "closed_lost",
      ],
      property_status: ["draft", "active", "sold", "rented", "offline"],
    },
  },
} as const
