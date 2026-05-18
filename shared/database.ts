export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
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
          conversation_id: string;
          content: Json | null;
          created_at: string;
          id: string;
          metadata: Json;
          parent_message_id: string | null;
          parts: Json;
          rating: number;
          role: string;
        };
        Insert: {
          conversation_id: string;
          content?: Json | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          parent_message_id?: string | null;
          parts?: Json;
          rating?: number;
          role: string;
        };
        Update: {
          conversation_id?: string;
          content?: Json | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          parent_message_id?: string | null;
          parts?: Json;
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      'conversation-type': 'parametric' | 'creative';
      'generation-status': 'pending' | 'success' | 'failure';
      mesh_file_type: 'glb' | 'stl' | 'obj' | 'fbx';
      mesh_model_type: 'quality' | 'fast';
      privacy_type: 'public' | 'private';
      prompt_type: 'mesh' | 'image' | 'chat';
    };
    CompositeTypes: {
      [_ in never]: never;
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      'conversation-type': ['parametric', 'creative'],
      'generation-status': ['pending', 'success', 'failure'],
      mesh_file_type: ['glb', 'stl', 'obj', 'fbx'],
      mesh_model_type: ['quality', 'fast'],
      privacy_type: ['public', 'private'],
      prompt_type: ['mesh', 'image', 'chat'],
    },
  },
} as const;
