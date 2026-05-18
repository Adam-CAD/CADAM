import { Conversation, MeshFileType, Model } from '@shared/types';

// Type for conversations with messages (used in HistoryView)
export type HistoryConversation = Omit<
  Conversation,
  'created_at' | 'updated_at'
> & {
  created_at: string;
  updated_at: string;
  first_message: {
    text: string;
    images: string[];
  };
  message_count: number;
};

export interface ModelConfig {
  id: Model;
  name: string;
  description: string;
  disabled?: boolean;
  timeEstimate?: string;
  provider?: string;
  supportsTools?: boolean;
  supportsThinking?: boolean;
  supportsVision?: boolean;
}

export interface MessageItem {
  id: string;
  isUploading?: boolean;
  url?: string;
  source: 'upload' | 'selection';
  fileType?: MeshFileType;
}
