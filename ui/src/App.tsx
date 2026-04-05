import { FormEvent, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type {
  Agent,
  AgentApiResponse,
  ChannelSubmitResponse,
  ChatMessage,
  ServerApiResponse,
} from "./types";

const API_BASE = (import.meta.env.VITE_TASKFORGE_API_BASE as string | undefined)?.trim() || "http://127.0.0.1:3000";
const QUICK_PROMPTS = [
  "I have 2 hours: coding bugfixes + release notes. Build my plan.",
  "My review call moved earlier. Reprioritize everything.",
  "Draft two reminders: one for deploy checklist, one for PR follow-up.",
];

const parseMinutes = (text: string): number => {
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(hour|hours|hr|hrs|h)\b/i);
  const minuteMatch = text.match(/(\d+)\s*(minute|minutes|min|mins|m)\b/i);
  const fromHours = hourMatch ? Math.round(Number.parseFloat(hourMatch[1]) * 60) : 0;
  const fromMinutes = minuteMatch ? Number.parseInt(minuteMatch[1], 10) : 0;
  const total = fromHours + fromMinutes;
  return total >= 30 ? total : 120;
};

const extractItems = (text: string): string[] => {
  const cleaned = text
    .replace(/\?/g, "")
    .replace(/\b(build|plan|please|today|now|need to|i have)\b/gi, "")
    .split(/,|\+|\band\b|\bthen\b/gi)
    .map((item) => item.trim())
    .filter((item) => item.length > 2)
    .slice(0, 5);

  if (cleaned.length > 0) {
    return cleaned;
  }

  return ["Primary task", "Secondary task", "Review and wrap-up"];
};

const localFallbackResponse = (text: string): string => {
  const lower = text.toLowerCase();
  const tasks = extractItems(text);

  if (/(remind|reminder|ping me|notify)/.test(lower)) {
    return [
      "Goal: Produce message-ready reminders",
      `Reminder 1: ${tasks[0] || "Key task"}. Keep it short and send it now.`,
      `Reminder 2: ${tasks[1] || "Second task"}. Set a 15-minute warning.`,
      "Next Action: Copy and send the reminder to your preferred channel.",
    ].join("\n");
  }

  if (/(reprioritize|replan|reschedule|moved|shifted|urgent)/.test(lower)) {
    const prioritized = [...tasks].sort((a, b) => b.length - a.length).slice(0, 3);
    return [
      "Goal: Adjust priorities around the new constraint",
      "Updated Priorities:",
      ...prioritized.map((item, index) => `${index + 1}. ${item}`),
      "Next Action: Start priority #1 for a 25-minute focused sprint.",
    ].join("\n");
  }

  const totalMinutes = parseMinutes(text);
  const reserve = 15;
  const perTask = Math.max(Math.floor((totalMinutes - reserve) / Math.max(tasks.length, 1)), 20);

  const lines = tasks.map((task, index) => `${index + 1}. ${task} (${perTask}m)`);
  lines.push(`${lines.length + 1}. Buffer and review (${reserve}m)`);

  return [
    "Goal: Build a focused execution plan",
    "Plan:",
    ...lines,
    `Next Action: Start with ${tasks[0] || "the top task"}.`,
  ].join("\n");
};

const generateId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getPersistentId = (key: string): string => {
  const existing = localStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const value = generateId();
  localStorage.setItem(key, value);
  return value;
};

const formatTime = (timestamp: number): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));

const bubbleIntro = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export function App() {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [serverId, setServerId] = useState<string>("00000000-0000-0000-0000-000000000000");
  const [channelId] = useState<string>(() => getPersistentId("taskforge_channel_id"));
  const [userId] = useState<string>(() => getPersistentId("taskforge_user_id"));
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: generateId(),
      role: "system",
      text: "TaskForge is online. Ask for a plan, reprioritization, or reminder drafts.",
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState("Booting...");

  const canSend = input.trim().length > 0 && !isLoading;

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      try {
        setStatusText("Connecting to TaskForge API...");
        const [agentsRes, serverRes] = await Promise.all([
          fetch(`${API_BASE}/api/agents`),
          fetch(`${API_BASE}/api/messaging/message-server/current`),
        ]);

        if (!agentsRes.ok) {
          throw new Error("Unable to fetch agents");
        }

        const agentsJson = (await agentsRes.json()) as AgentApiResponse;
        const firstAgent = agentsJson.data?.agents?.[0] ?? null;

        if (!firstAgent) {
          throw new Error("No active agent found");
        }

        if (!isMounted) {
          return;
        }

        setAgent(firstAgent);

        if (serverRes.ok) {
          const serverJson = (await serverRes.json()) as ServerApiResponse;
          setServerId(serverJson.data?.messageServerId || serverId);
        }

        setStatusText(`Connected to ${firstAgent.name}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Connection failed";
        if (!isMounted) {
          return;
        }
        setStatusText(`Offline: ${message}`);
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: "system",
            text: "Unable to reach the agent API. Ensure `pnpm start` is running on port 3000.",
            timestamp: Date.now(),
          },
        ]);
      }
    };

    initialize();

    return () => {
      isMounted = false;
    };
  }, [serverId]);

  const stats = useMemo(
    () => [
      { label: "Agent", value: agent?.name || "Not Connected" },
      { label: "Mode", value: "Execution-first" },
      { label: "API", value: API_BASE.replace(/^https?:\/\//, "") },
    ],
    [agent]
  );

  const appendUserMessage = (text: string): ChatMessage => {
    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    return userMessage;
  };

  const appendAgentOrError = (response: ChannelSubmitResponse, sourceText: string) => {
    const agentText = response.agentResponse?.text?.trim();
    const needsFallback =
      !agentText &&
      typeof response.error === "string" &&
      /failed to process message in http transport|service unavailable/i.test(response.error);

    const message: ChatMessage = {
      id: generateId(),
      role: agentText || needsFallback ? "agent" : "system",
      text:
        agentText ||
        (needsFallback
          ? `${localFallbackResponse(sourceText)}\n\n(Served in local fallback mode while model endpoint is unavailable.)`
          : undefined) ||
        response.error ||
        "The agent did not return text. Check backend logs for model endpoint status.",
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, message]);
  };

  const sendMessage = async (text: string) => {
    if (!agent) {
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "system",
          text: "Agent is not connected yet.",
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    appendUserMessage(trimmed);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/messaging/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          author_id: userId,
          content: trimmed,
          message_server_id: serverId,
          transport: "http",
          metadata: {
            user_display_name: "TaskForge UI",
            targetAgentId: agent.id,
            channelType: "GROUP",
          },
        }),
      });

      const json = (await response.json()) as ChannelSubmitResponse;
      appendAgentOrError(json, trimmed);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "system",
          text: error instanceof Error ? error.message : "Network error while contacting TaskForge",
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(input);
  };

  return (
    <div className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <main className="layout">
        <motion.header
          className="hero"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
        >
          <div>
            <p className="eyebrow">Nosana x ElizaOS</p>
            <h1>TaskForge Console</h1>
            <p className="subtext">
              A focused command center for daily plans, fast reprioritization, and reminder drafts.
            </p>
          </div>
          <motion.div className="status-pill" whileHover={{ y: -2 }}>
            <span className="dot" />
            {statusText}
          </motion.div>
        </motion.header>

        <section className="stats-grid">
          {stats.map((item, idx) => (
            <motion.article
              key={item.label}
              className="stat-card"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06, duration: 0.4 }}
            >
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </motion.article>
          ))}
        </section>

        <section className="chat-panel">
          <div className="panel-header">
            <h2>Live Agent Chat</h2>
            <div className="prompt-row">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="prompt-chip"
                  onClick={() => setInput(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="messages" role="log" aria-live="polite">
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <motion.article
                  key={message.id}
                  className={`bubble ${message.role}`}
                  variants={bubbleIntro}
                  initial="hidden"
                  animate="visible"
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3 }}
                >
                  <header>
                    <span>
                      {message.role === "user"
                        ? "You"
                        : message.role === "agent"
                        ? agent?.name || "TaskForge"
                        : "System"}
                    </span>
                    <time>{formatTime(message.timestamp)}</time>
                  </header>
                  <p>{message.text}</p>
                </motion.article>
              ))}
            </AnimatePresence>

            {isLoading && (
              <motion.div
                className="typing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <span />
                <span />
                <span />
              </motion.div>
            )}
          </div>

          <form className="composer" onSubmit={onSubmit}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask TaskForge to build a plan..."
              aria-label="Message TaskForge"
            />
            <motion.button
              whileTap={{ scale: 0.97 }}
              whileHover={{ y: -1 }}
              type="submit"
              disabled={!canSend}
            >
              {isLoading ? "Working..." : "Send"}
            </motion.button>
          </form>
        </section>
      </main>
    </div>
  );
}
