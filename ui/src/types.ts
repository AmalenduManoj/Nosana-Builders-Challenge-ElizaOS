export type Agent = {
  id: string;
  name: string;
  characterName?: string;
  status?: string;
  bio?: string;
};

export type AgentApiResponse = {
  success: boolean;
  data?: {
    agents?: Agent[];
  };
};

export type ServerApiResponse = {
  success: boolean;
  data?: {
    messageServerId?: string;
  };
};

export type MessageRole = "user" | "agent" | "system";

export type ChatMessage = {
  id: string;
  role: MessageRole;
  text: string;
  timestamp: number;
};

export type ChannelSubmitResponse = {
  success: boolean;
  error?: string;
  agentResponse?: {
    text?: string;
    thought?: string;
    actions?: string[];
  };
};
