export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      conversations: {
        Row: {
          created_at: string | null;
          current_message_leaf_id: string | null;
          id: string;
          privacy: Database['public']['Enums']['privacy_type'];
          settings: Json;
          title: string;
          type: Database['public']['Enums']['conversation-type'];
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          current_message_leaf_id?: string | null;
          id?: string;
          privacy?: Database['public']['Enums']['privacy_type'];
          settings?: Json;
          title: string;
          type?: Database['public']['Enums']['conversation-type'];
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          current_message_leaf_id?: string | null;
          id?: string;
          privacy?: Database['public']['Enums']['privacy_type'];
          settings?: Json;
          title?: string;
          type?: Database['public']['Enums']['conversation-type'];
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      images: {
        Row: {
          conversation_id: string;
          created_at: string;
          id: string;
          image_generation_call_id: string | null;
          prompt: Json;
          status: Database['public']['Enums']['generation-status'];
          user_id: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          id?: string;
          image_generation_call_id?: string | null;
          prompt?: Json;
          status?: Database['public']['Enums']['generation-status'];
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          id?: string;
          image_generation_call_id?: string | null;
          prompt?: Json;
          status?: Database['public']['Enums']['generation-status'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'images_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      meshes: {
        Row: {
          conversation_id: string;
          created_at: string;
          file_type: Database['public']['Enums']['mesh_file_type'];
          id: string;
          images: string[] | null;
          prompt: Json;
          status: Database['public']['Enums']['generation-status'];
          user_id: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          file_type?: Database['public']['Enums']['mesh_file_type'];
          id?: string;
          images?: string[] | null;
          prompt?: Json;
          status?: Database['public']['Enums']['generation-status'];
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          file_type?: Database['public']['Enums']['mesh_file_type'];
          id?: string;
          images?: string[] | null;
          prompt?: Json;
          status?: Database['public']['Enums']['generation-status'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'meshes_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      messages: {
        Row: {
          content: Json;
          conversation_id: string;
          created_at: string;
          id: string;
          parent_message_id: string | null;
          rating: number;
          role: string;
        };
        Insert: {
          content: Json;
          conversation_id: string;
          created_at?: string;
          id?: string;
          parent_message_id?: string | null;
          rating?: number;
          role: string;
        };
        Update: {
          content?: Json;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          parent_message_id?: string | null;
          rating?: number;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'messages_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      previews: {
        Row: {
          conversation_id: string;
          created_at: string;
          id: string;
          mesh_id: string;
          status: Database['public']['Enums']['generation-status'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          id?: string;
          mesh_id: string;
          status?: Database['public']['Enums']['generation-status'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          id?: string;
          mesh_id?: string;
          status?: Database['public']['Enums']['generation-status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'previews_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'previews_mesh_id_fkey';
            columns: ['mesh_id'];
            isOneToOne: false;
            referencedRelation: 'meshes';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_path: string | null;
          created_at: string;
          full_name: string;
          id: string;
          notifications_enabled: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          avatar_path?: string | null;
          created_at?: string;
          full_name: string;
          id?: string;
          notifications_enabled?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          avatar_path?: string | null;
          created_at?: string;
          full_name?: string;
          id?: string;
          notifications_enabled?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      prompts: {
        Row: {
          created_at: string;
          id: number;
          type: Database['public']['Enums']['prompt_type'];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: number;
          type?: Database['public']['Enums']['prompt_type'];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: number;
          type?: Database['public']['Enums']['prompt_type'];
          user_id?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          created_at: string | null;
          current_period_end: string | null;
          id: string;
          level: Database['public']['Enums']['stripe-level'];
          status: string | null;
          stripe_event_created_at: string | null;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          current_period_end?: string | null;
          id?: string;
          level?: Database['public']['Enums']['stripe-level'];
          status?: string | null;
          stripe_event_created_at?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          current_period_end?: string | null;
          id?: string;
          level?: Database['public']['Enums']['stripe-level'];
          status?: string | null;
          stripe_event_created_at?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      stripe_webhook_events: {
        Row: {
          created_at: string;
          event_id: string;
          event_type: string;
          processed_at: string | null;
          status: string;
          stripe_event_created_at: string | null;
          stripe_object_id: string | null;
        };
        Insert: {
          created_at?: string;
          event_id: string;
          event_type: string;
          processed_at?: string | null;
          status?: string;
          stripe_event_created_at?: string | null;
          stripe_object_id?: string | null;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          event_type?: string;
          processed_at?: string | null;
          status?: string;
          stripe_event_created_at?: string | null;
          stripe_object_id?: string | null;
        };
        Relationships: [];
      };
      token_balances: {
        Row: {
          balance: number;
          created_at: string;
          expires_at: string | null;
          id: string;
          source: Database['public']['Enums']['token_source_type'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          balance?: number;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          source: Database['public']['Enums']['token_source_type'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          balance?: number;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          source?: Database['public']['Enums']['token_source_type'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      token_costs: {
        Row: {
          cost: number;
          created_at: string;
          operation: Database['public']['Enums']['token_operation_type'];
          updated_at: string;
        };
        Insert: {
          cost: number;
          created_at?: string;
          operation: Database['public']['Enums']['token_operation_type'];
          updated_at?: string;
        };
        Update: {
          cost?: number;
          created_at?: string;
          operation?: Database['public']['Enums']['token_operation_type'];
          updated_at?: string;
        };
        Relationships: [];
      };
      token_pack_products: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          name: string;
          price_cents: number;
          stripe_lookup_key: string;
          token_amount: number;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name: string;
          price_cents: number;
          stripe_lookup_key: string;
          token_amount: number;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name?: string;
          price_cents?: number;
          stripe_lookup_key?: string;
          token_amount?: number;
        };
        Relationships: [];
      };
      token_transactions: {
        Row: {
          amount: number;
          created_at: string;
          id: number;
          operation: Database['public']['Enums']['token_operation_type'];
          purchased_balance_after: number;
          reference_id: string | null;
          source: Database['public']['Enums']['token_source_type'];
          subscription_balance_after: number;
          user_id: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          id?: never;
          operation: Database['public']['Enums']['token_operation_type'];
          purchased_balance_after: number;
          reference_id?: string | null;
          source: Database['public']['Enums']['token_source_type'];
          subscription_balance_after: number;
          user_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          id?: never;
          operation?: Database['public']['Enums']['token_operation_type'];
          purchased_balance_after?: number;
          reference_id?: string | null;
          source?: Database['public']['Enums']['token_source_type'];
          subscription_balance_after?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      trial_users: {
        Row: {
          id: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          user_id: string;
        };
        Update: {
          id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      credit_purchased_tokens: {
        Args: { p_amount: number; p_reference_id?: string; p_user_id: string };
        Returns: Json;
      };
      deduct_tokens: {
        Args: {
          p_operation: Database['public']['Enums']['token_operation_type'];
          p_reference_id?: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      get_subscription_token_limit: {
        Args: { p_user_id: string };
        Returns: number;
      };
      grant_subscription_tokens: {
        Args: {
          p_expires_at: string;
          p_force?: boolean;
          p_reference_id?: string;
          p_token_amount: number;
          p_user_id: string;
        };
        Returns: Json;
      };
      refund_tokens: {
        Args: {
          p_operation: Database['public']['Enums']['token_operation_type'];
          p_reference_id?: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      reset_free_tier_tokens: { Args: never; Returns: undefined };
      user_extradata: {
        Args: { user_id_input: string };
        Returns: Database['public']['CompositeTypes']['user_data'];
        SetofOptions: {
          from: '*';
          to: 'user_data';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      'conversation-type': 'parametric' | 'creative';
      'generation-status': 'pending' | 'success' | 'failure';
      mesh_file_type: 'glb' | 'stl' | 'obj' | 'fbx';
      mesh_model_type: 'quality' | 'fast';
      privacy_type: 'public' | 'private';
      prompt_type: 'mesh' | 'image' | 'chat';
      'stripe-level': 'pro' | 'standard';
      subscription_level: 'pro' | 'standard' | 'free';
      token_operation_type: 'mesh' | 'parametric' | 'chat' | 'refund';
      token_source_type: 'subscription' | 'purchased';
    };
    CompositeTypes: {
      user_data: {
        hasTrialed: boolean | null;
        sublevel: Database['public']['Enums']['subscription_level'] | null;
        subscriptionTokens: number | null;
        purchasedTokens: number | null;
        totalTokens: number | null;
        subscriptionTokenLimit: number | null;
        subscriptionExpiresAt: string | null;
      };
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      'conversation-type': ['parametric', 'creative'],
      'generation-status': ['pending', 'success', 'failure'],
      mesh_file_type: ['glb', 'stl', 'obj', 'fbx'],
      mesh_model_type: ['quality', 'fast'],
      privacy_type: ['public', 'private'],
      prompt_type: ['mesh', 'image', 'chat'],
      'stripe-level': ['pro', 'standard'],
      subscription_level: ['pro', 'standard', 'free'],
      token_operation_type: ['mesh', 'parametric', 'chat', 'refund'],
      token_source_type: ['subscription', 'purchased'],
    },
  },
} as const;
