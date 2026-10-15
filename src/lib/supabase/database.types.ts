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
      list_pharmacy_actions: {
        Args: {
          target_pharmacy_id: string
          target_date?: string
        }
        Returns: {
          action_id: string
          business_date: string
          action_key: string
          action_kind: string
          severity: string
          title: string
          detail: string
          source_snapshot: Json
          source_active: boolean
          status: string
          snoozed_until: string | null
          assignee_user_id: string | null
          assignee_is_active: boolean
          resolved_by: string | null
          resolved_at: string | null
          version: string
          created_at: string
          updated_at: string
        }[]
      }
      refresh_pharmacy_actions: {
        Args: {
          target_pharmacy_id: string
        }
        Returns: number
      }
      update_pharmacy_action: {
        Args: {
          target_pharmacy_id: string
          target_action_id: string
          expected_version: number
          action_command: string
          assigned_user_id?: string
        }
        Returns: string
      }
      get_pharmacy_stock_health: {
        Args: {
          target_pharmacy_id: string
        }
        Returns: Json
      }
      get_pharmacy_financial_summary: {
        Args: {
          target_pharmacy_id: string
          report_period?: string
        }
        Returns: Json
      }
      close_pharmacy_day: {
        Args: {
          target_pharmacy_id: string
          operation_id: string
          target_date: string
          opening_cash_amount: number
          counted_cash_amount: number
          closure_notes: string
          reviewed_totals: Json
        }
        Returns: string
      }
      get_pharmacy_day_summary: {
        Args: {
          target_pharmacy_id: string
          target_date?: string
        }
        Returns: Json
      }
      record_pharmacy_expense: {
        Args: {
          target_pharmacy_id: string
          operation_id: string
          expense_category: string
          expense_description: string
          expense_amount: number
          expense_payment_source: string
        }
        Returns: string
      }
      list_pharmacy_expenses: {
        Args: {
          target_pharmacy_id: string
          target_date?: string
        }
        Returns: {
          expense_id: string
          category: string
          description: string
          amount: string
          payment_source: string
          recorded_by: string
          spent_at: string
        }[]
      }
      confirm_pharmacy_sale: {
        Args: {
          target_pharmacy_id: string
          operation_id: string
          sale_payment_method: string
          sale_lines: Json
        }
        Returns: string
      }
      list_pharmacy_stock_batches: {
        Args: { target_pharmacy_id: string }
        Returns: {
          batch_id: string
          product_id: string
          product_name: string
          base_unit_label: string
          product_is_active: boolean
          batch_number: string
          supplier_name: string
          expiry_date: string
          days_to_expiry: number
          remaining_quantity: string
          stock_value: string | null
          received_at: string
          as_of_date: string
        }[]
      }
      list_pharmacy_inventory: {
        Args: { target_pharmacy_id: string }
        Returns: {
          product_id: string
          product_name: string
          generic_name: string
          category: string
          shelf_location: string
          base_unit_label: string
          is_active: boolean
          on_hand_quantity: string
          available_quantity: string
          expired_quantity: string
          expiring_quantity: string
          stock_value: string | null
          expiring_value: string | null
          batch_count: number
          nearest_expiry: string | null
          as_of_date: string
        }[]
      }
      confirm_stock_receipt: {
        Args: {
          target_pharmacy_id: string
          operation_id: string
          receipt_supplier: string
          receipt_invoice: string
          receipt_items: Json
        }
        Returns: string
      }
      list_pharmacy_member_audit: {
        Args: { target_pharmacy_id: string }
        Returns: {
          id: string
          actor_user_id: string
          actor_email: string | null
          target_user_id: string
          target_email: string | null
          old_role: Database["public"]["Enums"]["pharmacy_role"]
          new_role: Database["public"]["Enums"]["pharmacy_role"]
          old_is_active: boolean
          new_is_active: boolean
          created_at: string
        }[]
      }
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
