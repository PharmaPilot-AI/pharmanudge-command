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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      packaging_units: {
        Row: {
          base_units_per_unit: number
          created_at: string
          id: string
          is_active: boolean
          label: string
          price: number
          product_id: string
          updated_at: string
        }
        Insert: {
          base_units_per_unit: number
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          price: number
          product_id: string
          updated_at?: string
        }
        Update: {
          base_units_per_unit?: number
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          price?: number
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packaging_units_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pharmacies: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      pharmacy_members: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          pharmacy_id: string
          role: Database["public"]["Enums"]["pharmacy_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          pharmacy_id: string
          role: Database["public"]["Enums"]["pharmacy_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          pharmacy_id?: string
          role?: Database["public"]["Enums"]["pharmacy_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_members_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          base_unit_label: string
          category: string
          cost_per_base_unit: number
          created_at: string
          generic_name: string
          id: string
          is_active: boolean
          name: string
          pharmacy_id: string
          shelf_location: string
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          base_unit_label: string
          category?: string
          cost_per_base_unit?: number
          created_at?: string
          generic_name?: string
          id?: string
          is_active?: boolean
          name: string
          pharmacy_id: string
          shelf_location?: string
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          base_unit_label?: string
          category?: string
          cost_per_base_unit?: number
          created_at?: string
          generic_name?: string
          id?: string
          is_active?: boolean
          name?: string
          pharmacy_id?: string
          shelf_location?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          category: string
          created_at: string
          description: string
          duration_minutes: number | null
          id: string
          is_active: boolean
          name: string
          pharmacy_id: string
          price: number
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string
          duration_minutes?: number | null
          id?: string
          is_active?: boolean
          name: string
          pharmacy_id: string
          price: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          duration_minutes?: number | null
          id?: string
          is_active?: boolean
          name?: string
          pharmacy_id?: string
          price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_pharmacy_invitation: {
        Args: { target_invitation_id: string }
        Returns: string
      }
      create_pharmacy_invitation: {
        Args: {
          target_pharmacy_id: string
          invitation_email: string
          invitation_role: Database["public"]["Enums"]["pharmacy_role"]
        }
        Returns: string
      }
      list_pharmacy_invitations: {
        Args: { target_pharmacy_id: string }
        Returns: {
          id: string
          email: string
          role: Database["public"]["Enums"]["pharmacy_role"]
          status: string
          expires_at: string
          created_at: string
        }[]
      }
      cancel_pharmacy_invitation: {
        Args: {
          target_pharmacy_id: string
          target_invitation_id: string
        }
        Returns: string
      }
      is_pharmacy_member: {
        Args: { target_pharmacy_id: string }
        Returns: boolean
      }
      list_pharmacy_members: {
        Args: { target_pharmacy_id: string }
        Returns: {
          email: string
          is_active: boolean
          role: Database["public"]["Enums"]["pharmacy_role"]
          user_id: string
        }[]
      }
      update_pharmacy_member: {
        Args: {
          new_is_active: boolean
          new_role: Database["public"]["Enums"]["pharmacy_role"]
          target_pharmacy_id: string
          target_user_id: string
        }
        Returns: {
          email: string
          is_active: boolean
          role: Database["public"]["Enums"]["pharmacy_role"]
          user_id: string
        }[]
      }
    }
    Enums: {
      pharmacy_role: "owner" | "pharmacist" | "cashier" | "accountant"
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
      pharmacy_role: ["owner", "pharmacist", "cashier", "accountant"],
    },
  },
} as const
