
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "accounts": {
                  Row: {
                    "created_at": string,"external_id": string | null,"household_id": string,"id": string,"name": string,"owner_id": string | null,"provider": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"external_id"?: string | null,"household_id": string,"id"?: string,"name": string,"owner_id"?: string | null,"provider"?: string
                  }
                  Update: {
                    "created_at"?: string,"external_id"?: string | null,"household_id"?: string,"id"?: string,"name"?: string,"owner_id"?: string | null,"provider"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "accounts_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"activity": {
                  Row: {
                    "action": string,"actor": string | null,"at": string,"entity": string,"entity_id": string | null,"household_id": string,"id": number,"summary": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor"?: string | null,"at"?: string,"entity": string,"entity_id"?: string | null,"household_id": string,"id"?: never,"summary"?: NonNullable<Json>
                  }
                  Update: {
                    "action"?: string,"actor"?: string | null,"at"?: string,"entity"?: string,"entity_id"?: string | null,"household_id"?: string,"id"?: never,"summary"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_usage": {
                  Row: {
                    "calls": number,"day": string,"household_id": string,"kind": string
                  }
                  ComputedFields: never
                  Insert: {
                    "calls"?: number,"day": string,"household_id": string,"kind": string
                  }
                  Update: {
                    "calls"?: number,"day"?: string,"household_id"?: string,"kind"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_usage_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"app_config": {
                  Row: {
                    "key": string,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"value": NonNullable<Json>
                  }
                  Update: {
                    "key"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"categories": {
                  Row: {
                    "archived": boolean,"colour": string,"default_ratio": Json | null,"emoji": string,"household_id": string,"id": string,"name": string,"sort": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived"?: boolean,"colour"?: string,"default_ratio"?: Json | null,"emoji"?: string,"household_id": string,"id"?: string,"name": string,"sort"?: number,"updated_at"?: string
                  }
                  Update: {
                    "archived"?: boolean,"colour"?: string,"default_ratio"?: Json | null,"emoji"?: string,"household_id"?: string,"id"?: string,"name"?: string,"sort"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"category_memory": {
                  Row: {
                    "category_id": string | null,"household_id": string,"key": string,"source": string,"split_mode": string | null,"split_params": Json | null,"updated_at": string,"uses": number
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id"?: string | null,"household_id": string,"key": string,"source"?: string,"split_mode"?: string | null,"split_params"?: Json | null,"updated_at"?: string,"uses"?: number
                  }
                  Update: {
                    "category_id"?: string | null,"household_id"?: string,"key"?: string,"source"?: string,"split_mode"?: string | null,"split_params"?: Json | null,"updated_at"?: string,"uses"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "category_memory_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "category_memory_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"change_requests": {
                  Row: {
                    "created_at": string,"decided_at": string | null,"decided_by": string | null,"household_id": string,"id": string,"kind": string,"payload": NonNullable<Json>,"requested_by": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"household_id": string,"id"?: string,"kind": string,"payload": NonNullable<Json>,"requested_by": string,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"household_id"?: string,"id"?: string,"kind"?: string,"payload"?: NonNullable<Json>,"requested_by"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "change_requests_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"chapters": {
                  Row: {
                    "closed": boolean,"country": string | null,"created_at": string,"created_by": string | null,"emoji": string,"end_date": string | null,"household_id": string,"id": string,"kind": string,"name": string,"start_date": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed"?: boolean,"country"?: string | null,"created_at"?: string,"created_by"?: string | null,"emoji"?: string,"end_date"?: string | null,"household_id": string,"id"?: string,"kind"?: string,"name": string,"start_date"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "closed"?: boolean,"country"?: string | null,"created_at"?: string,"created_by"?: string | null,"emoji"?: string,"end_date"?: string | null,"household_id"?: string,"id"?: string,"kind"?: string,"name"?: string,"start_date"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chapters_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"client_errors": {
                  Row: {
                    "app_version": string | null,"at": string,"context": Json | null,"id": number,"message": string,"route": string | null,"stack": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "app_version"?: string | null,"at"?: string,"context"?: Json | null,"id"?: never,"message": string,"route"?: string | null,"stack"?: string | null,"user_id"?: string
                  }
                  Update: {
                    "app_version"?: string | null,"at"?: string,"context"?: Json | null,"id"?: never,"message"?: string,"route"?: string | null,"stack"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"comments": {
                  Row: {
                    "author": string,"body": string,"created_at": string,"deleted_at": string | null,"expense_id": string,"household_id": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author": string,"body": string,"created_at"?: string,"deleted_at"?: string | null,"expense_id": string,"household_id": string,"id"?: string
                  }
                  Update: {
                    "author"?: string,"body"?: string,"created_at"?: string,"deleted_at"?: string | null,"expense_id"?: string,"household_id"?: string,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "comments_expense_id_fkey"
      columns: ["expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comments_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"expenses": {
                  Row: {
                    "account_id": string | null,"amount_pence": number,"bill_total_pence": number | null,"category_guess": boolean,"category_id": string | null,"chapter_id": string | null,"country": string,"created_at": string,"created_by": string | null,"date": string,"deleted_at": string | null,"description": string,"external_category": string | null,"external_id": string | null,"fx_rate": number | null,"household_id": string,"id": string,"items": Json | null,"kind": string,"lat": number | null,"lng": number | null,"merchant": string | null,"notes": string | null,"occurrence_date": string | null,"original_amount": number | null,"original_currency": string | null,"paid": NonNullable<Json>,"paid_via": string,"place": string | null,"receipt_path": string | null,"recurring_id": string | null,"refund_of": string | null,"shares": NonNullable<Json>,"source": string,"split_mode": string,"split_params": Json | null,"tags": (string)[],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"amount_pence": number,"bill_total_pence"?: number | null,"category_guess"?: boolean,"category_id"?: string | null,"chapter_id"?: string | null,"country"?: string,"created_at"?: string,"created_by"?: string | null,"date"?: string,"deleted_at"?: string | null,"description": string,"external_category"?: string | null,"external_id"?: string | null,"fx_rate"?: number | null,"household_id": string,"id"?: string,"items"?: Json | null,"kind"?: string,"lat"?: number | null,"lng"?: number | null,"merchant"?: string | null,"notes"?: string | null,"occurrence_date"?: string | null,"original_amount"?: number | null,"original_currency"?: string | null,"paid": NonNullable<Json>,"paid_via"?: string,"place"?: string | null,"receipt_path"?: string | null,"recurring_id"?: string | null,"refund_of"?: string | null,"shares": NonNullable<Json>,"source"?: string,"split_mode"?: string,"split_params"?: Json | null,"tags"?: (string)[],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "account_id"?: string | null,"amount_pence"?: number,"bill_total_pence"?: number | null,"category_guess"?: boolean,"category_id"?: string | null,"chapter_id"?: string | null,"country"?: string,"created_at"?: string,"created_by"?: string | null,"date"?: string,"deleted_at"?: string | null,"description"?: string,"external_category"?: string | null,"external_id"?: string | null,"fx_rate"?: number | null,"household_id"?: string,"id"?: string,"items"?: Json | null,"kind"?: string,"lat"?: number | null,"lng"?: number | null,"merchant"?: string | null,"notes"?: string | null,"occurrence_date"?: string | null,"original_amount"?: number | null,"original_currency"?: string | null,"paid"?: NonNullable<Json>,"paid_via"?: string,"place"?: string | null,"receipt_path"?: string | null,"recurring_id"?: string | null,"refund_of"?: string | null,"shares"?: NonNullable<Json>,"source"?: string,"split_mode"?: string,"split_params"?: Json | null,"tags"?: (string)[],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "expenses_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_chapter_id_fkey"
      columns: ["chapter_id"]
isOneToOne: false
      referencedRelation: "chapters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_recurring_id_fkey"
      columns: ["recurring_id"]
isOneToOne: false
      referencedRelation: "recurring"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_refund_of_fkey"
      columns: ["refund_of"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    }
                  ]
                },"households": {
                  Row: {
                    "created_at": string,"default_ratio": Json | null,"home_country": string,"id": string,"join_code": string,"joint_enabled": boolean,"joint_ratio": Json | null,"settle_day": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"default_ratio"?: Json | null,"home_country"?: string,"id"?: string,"join_code"?: string,"joint_enabled"?: boolean,"joint_ratio"?: Json | null,"settle_day"?: number | null
                  }
                  Update: {
                    "created_at"?: string,"default_ratio"?: Json | null,"home_country"?: string,"id"?: string,"join_code"?: string,"joint_enabled"?: boolean,"joint_ratio"?: Json | null,"settle_day"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"import_ignores": {
                  Row: {
                    "household_id": string,"id_hash": string,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "household_id": string,"id_hash": string,"source": string
                  }
                  Update: {
                    "household_id"?: string,"id_hash"?: string,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_ignores_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"import_rules": {
                  Row: {
                    "category_id": string | null,"created_at": string,"decision": string,"household_id": string,"id": string,"match_text": string,"split_mode": string | null,"split_params": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id"?: string | null,"created_at"?: string,"decision": string,"household_id": string,"id"?: string,"match_text": string,"split_mode"?: string | null,"split_params"?: Json | null
                  }
                  Update: {
                    "category_id"?: string | null,"created_at"?: string,"decision"?: string,"household_id"?: string,"id"?: string,"match_text"?: string,"split_mode"?: string | null,"split_params"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_rules_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "import_rules_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"inbox_items": {
                  Row: {
                    "created_at": string,"created_by": string | null,"expense_id": string | null,"external_id": string | null,"household_id": string,"id": string,"occurrence_date": string | null,"payload": NonNullable<Json>,"receipt_path": string | null,"recurring_id": string | null,"source": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"expense_id"?: string | null,"external_id"?: string | null,"household_id": string,"id"?: string,"occurrence_date"?: string | null,"payload"?: NonNullable<Json>,"receipt_path"?: string | null,"recurring_id"?: string | null,"source": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"expense_id"?: string | null,"external_id"?: string | null,"household_id"?: string,"id"?: string,"occurrence_date"?: string | null,"payload"?: NonNullable<Json>,"receipt_path"?: string | null,"recurring_id"?: string | null,"source"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inbox_items_expense_id_fkey"
      columns: ["expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inbox_items_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inbox_items_recurring_id_fkey"
      columns: ["recurring_id"]
isOneToOne: false
      referencedRelation: "recurring"
      referencedColumns: ["id"]
    }
                  ]
                },"join_attempts": {
                  Row: {
                    "at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"user_id": string
                  }
                  Update: {
                    "at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"members": {
                  Row: {
                    "animal": string | null,"display_name": string | null,"household_id": string,"joined_at": string,"locked_at": string | null,"monzo_me": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "animal"?: string | null,"display_name"?: string | null,"household_id": string,"joined_at"?: string,"locked_at"?: string | null,"monzo_me"?: string | null,"user_id": string
                  }
                  Update: {
                    "animal"?: string | null,"display_name"?: string | null,"household_id"?: string,"joined_at"?: string,"locked_at"?: string | null,"monzo_me"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "members_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"recaps": {
                  Row: {
                    "created_at": string,"household_id": string,"period": string,"prose": string | null,"stats": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"household_id": string,"period": string,"prose"?: string | null,"stats": NonNullable<Json>
                  }
                  Update: {
                    "created_at"?: string,"household_id"?: string,"period"?: string,"prose"?: string | null,"stats"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "recaps_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"recurring": {
                  Row: {
                    "active": boolean,"amount_pence": number,"amount_varies": boolean,"category_id": string | null,"created_at": string,"created_by": string | null,"description": string,"end_date": string | null,"every": number,"frequency": string,"household_id": string,"id": string,"is_subscription": boolean,"notes": string | null,"paid": NonNullable<Json>,"paid_via": string,"posted_count": number,"shares": NonNullable<Json>,"split_mode": string,"split_params": Json | null,"start_date": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"amount_pence": number,"amount_varies"?: boolean,"category_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description": string,"end_date"?: string | null,"every"?: number,"frequency": string,"household_id": string,"id"?: string,"is_subscription"?: boolean,"notes"?: string | null,"paid": NonNullable<Json>,"paid_via"?: string,"posted_count"?: number,"shares": NonNullable<Json>,"split_mode"?: string,"split_params"?: Json | null,"start_date": string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"amount_pence"?: number,"amount_varies"?: boolean,"category_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string,"end_date"?: string | null,"every"?: number,"frequency"?: string,"household_id"?: string,"id"?: string,"is_subscription"?: boolean,"notes"?: string | null,"paid"?: NonNullable<Json>,"paid_via"?: string,"posted_count"?: number,"shares"?: NonNullable<Json>,"split_mode"?: string,"split_params"?: Json | null,"start_date"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recurring_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recurring_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"settlements": {
                  Row: {
                    "amount_pence": number,"created_at": string,"created_by": string | null,"date": string,"deleted_at": string | null,"from_user": string,"household_id": string,"id": string,"method": string,"note": string | null,"to_user": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_pence": number,"created_at"?: string,"created_by"?: string | null,"date"?: string,"deleted_at"?: string | null,"from_user": string,"household_id": string,"id"?: string,"method"?: string,"note"?: string | null,"to_user": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_pence"?: number,"created_at"?: string,"created_by"?: string | null,"date"?: string,"deleted_at"?: string | null,"from_user"?: string,"household_id"?: string,"id"?: string,"method"?: string,"note"?: string | null,"to_user"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "settlements_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "member_net": {
                  Row: {
                    "household_id": string,"net_pence": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                           "household_id"?: string | null,"net_pence"?: never,"user_id"?: string | null
                         }
                        Update: {
                           "household_id"?: string | null,"net_pence"?: never,"user_id"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "members_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "create_household":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"dearmor":
{ Args: { "": string }; Returns: string
                           },
"decide_change":
{ Args: { "p_approve": boolean,"p_id": string }; Returns: undefined
                           },
"gen_random_uuid":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"gen_salt":
{ Args: { "": string }; Returns: string
                           },
"health":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"increment_ai_usage":
{ Args: { "p_kind": string }; Returns: number
                           },
"join_household":
{ Args: { "p_code": string }; Returns: string
                           },
"jsonb_pence_sum":
{ Args: { "j": Json }; Returns: number
                           },
"my_household":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"pgp_armor_headers":
{ Args: { "": string }; Returns: Record<string, unknown>[]
                           },
"post_due_recurring":
{ Args: { "p_household"?: string }; Returns: number
                           },
"post_due_recurring_all":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"recurring_step":
{ Args: { "p_every": number,"p_frequency": string }; Returns: string
                           },
"request_change":
{ Args: { "p_kind": string,"p_payload": Json }; Returns: string
                           },
"set_identity":
{ Args: { "p_animal": string,"p_name": string }; Returns: undefined
                           },
"set_monzo_me":
{ Args: { "p_username": string }; Returns: undefined
                           },
"set_settle_day":
{ Args: { "p_day": number }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
