/* eslint-disable */
// Generated via Supabase MCP for project 1Cube (diubdforaeqzbtbwxdfc)
// Additions: None. Do not edit manually.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      cart_products: {
        Row: {
          cart_id: string
          created_at: string
          id: string
          image_url: string | null
          product_id: string
          qty: number
          title_snapshot: string | null
          unit_price: number
          updated_at: string
          variant_id: string | null
          vendor: string | null
        }
        Insert: {
          cart_id: string
          created_at?: string
          id?: string
          image_url?: string | null
          product_id: string
          qty: number
          title_snapshot?: string | null
          unit_price: number
          updated_at?: string
          variant_id?: string | null
          vendor?: string | null
        }
        Update: Partial<Database["public"]["Tables"]["cart_products"]["Insert"]>
        Relationships: []
      }
      carts: {
        Row: {
          id: string
          session_id: string
          total: number
          currency: string
          updated_at: string
          user_id: string | null
          voucher_id: string | null
          checkout_url: string | null
          created_at: string
          last_activity_at: string
          status: "active" | "checked_out" | "abandoned" | "void"
          shop_id: string | null
          shopify_cart_id: string | null
          shopify_checkout_id: string | null
        }
        Insert: Partial<Database["public"]["Tables"]["carts"]["Row"]>
        Update: Partial<Database["public"]["Tables"]["carts"]["Row"]>
        Relationships: []
      }
      events: {
        Row: { id: string; created_at: string; session_id: string; type: string; payload: Json }
        Insert: { id?: string; created_at?: string; session_id: string; type: string; payload?: Json }
        Update: Partial<Database["public"]["Tables"]["events"]["Insert"]>
        Relationships: []
      }
      products: {
        Row: { id: string; content: string; metadata: Json; created_at: string | null; updated_at: string | null; variant_id: string | null; embedding: string | null; shopify_product_id: string | null }
        Insert: Partial<Database["public"]["Tables"]["products"]["Row"]> & { content: string }
        Update: Partial<Database["public"]["Tables"]["products"]["Row"]>
        Relationships: []
      }
      sessions: {
        Row: { id: string; user_id: string | null; started_at: string; last_seen_at: string | null; locale: string | null; channel: string | null }
        Insert: Partial<Database["public"]["Tables"]["sessions"]["Row"]>
        Update: Partial<Database["public"]["Tables"]["sessions"]["Row"]>
        Relationships: []
      }
      tickets: {
        Row: { id: string; description: string; email: string | null; category: string | null; source: string; status: string; created_at: string | null; updated_at: string | null; user_id: string | null; order_ref: string | null }
        Insert: Partial<Database["public"]["Tables"]["tickets"]["Row"]> & { description: string }
        Update: Partial<Database["public"]["Tables"]["tickets"]["Row"]>
        Relationships: []
      }
      vouchers: {
        Row: { id: string; code: string; discount_type: string; discount_value: number; min_spend: number | null; is_active: boolean | null; valid_from: string; valid_to: string | null; description: string | null; created_at: string | null; updated_at: string | null; usage_limit: number | null; per_user_limit: number | null; max_discount: number | null; applicable_products: string[] | null; applicable_collections: string[] | null; excluded_products: string[] | null }
        Insert: Partial<Database["public"]["Tables"]["vouchers"]["Row"]> & { code: string; discount_type: string; discount_value: number }
        Update: Partial<Database["public"]["Tables"]["vouchers"]["Row"]>
        Relationships: []
      }
    }
    Views: {
      v_cart: {
        Row: {
          cart_id: string | null
          checkout_url: string | null
          created_at: string | null
          currency: string | null
          discount_amount: number | null
          estimated_total: number | null
          has_voucher: boolean | null
          last_activity_at: string | null
          last_modified_at: string | null
          lines: Json | null
          session_id: string | null
          status: "active" | "checked_out" | "abandoned" | "void" | null
          subtotal: number | null
          total_qty: number | null
          updated_at: string | null
          user_id: string | null
          voucher: Json | null
          voucher_id: string | null
        }
      }
    }
    Functions: {
      ensure_cart: { Args: { p_currency?: string; p_session_id: string; p_user_id?: string }; Returns: Database["public"]["Tables"]["carts"]["Row"] }
      cart_add_line: { Args: { p_cart_id: string; p_variant_gid: string; p_qty: number; p_unit_price: number; p_product_id: string; p_image?: string; p_title?: string; p_vendor?: string }; Returns: Database["public"]["Tables"]["cart_products"]["Row"] }
      cart_set_qty: { Args: { p_cart_id: string; p_qty: number; p_variant_gid: string }; Returns: undefined }
      cart_remove_line: { Args: { p_cart_id: string; p_variant_gid: string }; Returns: undefined }
      cart_get: { Args: { p_cart_id: string; p_session_id?: string }; Returns: Json }
      get_applicable_vouchers: { Args: { p_collections?: string[]; p_product_ids?: string[]; p_subtotal: number; p_user_ref?: string }; Returns: { code: string; description: string; discount_type: string; discount_value: number; estimated_savings: number; reason: string }[] }
    }
    Enums: {
      cart_status: "active" | "checked_out" | "abandoned" | "void"
    }
    CompositeTypes: { [_ in never]: never }
  }
}

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];


