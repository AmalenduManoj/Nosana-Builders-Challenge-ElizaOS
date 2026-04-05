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
const NAV_ITEMS = ["Dashboard", "Tasks", "Habits", "Email", "Knowledge", "Finance", "AI Assistant"] as const;
type NavItem = (typeof NAV_ITEMS)[number];

const QUICK_PROMPTS = [
  "I have 2 hours: coding bugfixes + release notes. Build my plan.",
  "I have 45 minutes free before dinner. What should I finish first?",
  "Draft reminder messages for bills, workout, and tomorrow planning.",
];

const TODAY_SCHEDULE = [
  { time: "09:00", label: "Inbox triage", status: "done" },
  { time: "11:00", label: "Deep work: release prep", status: "active" },
  { time: "14:30", label: "Workout + recovery", status: "upcoming" },
  { time: "17:00", label: "Budget review", status: "upcoming" },
];

const PRIORITIES = [
  "Finalize release notes and push build",
  "Reply to urgent personal email threads",
  "Log today's expenses before 8 PM",
];

const NOTIFICATIONS = [
  "You have a 52-minute gap before your next meeting. Suggested task: finish release notes.",
  "Habit risk detected: hydration streak may break today. Add a quick reminder.",
  "Two urgent emails are unanswered for over 4 hours.",
];

const KANBAN = {
  todo: ["Plan weekly groceries", "Upload tax receipts"],
  doing: ["Ship bugfix patch", "Prepare tomorrow's top 3"],
  done: ["Morning journal", "Invoice follow-up"],
};

const HABIT_CARDS = [
  { label: "Workout", streak: 8, confidence: 86 },
  { label: "Reading", streak: 14, confidence: 91 },
  { label: "No-spend day", streak: 3, confidence: 63 },
];

const EMAIL_GROUPS = [
  {
    title: "Work",
    count: 11,
    summary: "Most threads are status requests. Suggested batch-reply window: 4:30 PM.",
  },
  {
    title: "Personal",
    count: 7,
    summary: "Family planning thread pending reply and one travel confirmation.",
  },
  {
    title: "Urgent",
    count: 2,
    summary: "One payment issue and one same-day document request.",
  },
];

const KNOWLEDGE_NOTES = [
  { title: "Apartment move checklist", summary: "17 actionable items, 3 blocked by paperwork." },
  { title: "Q2 goals", summary: "Focus areas: health consistency, shipping side project milestones." },
  { title: "Travel packing template", summary: "Optimized list with weather-based variants." },
];

const FINANCE_BARS = [
  { label: "Food", value: 62 },
  { label: "Transport", value: 37 },
  { label: "Subscriptions", value: 24 },
  { label: "Leisure", value: 41 },
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
  const normalized = text
    .replace(/\?+/g, "")
    .replace(/\b(build|create|make)\s+(my\s+)?(plan|schedule|timeline)\b/gi, "")
    .replace(/\bi\s+have\s+\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\s*:?/gi, "")
    .replace(/\b(i\s+need\s+to|need\s+to)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const parts = normalized
    .split(/\+|,|\band\b|\bthen\b/gi)
    .map((item) => item.replace(/[.;:]+$/g, "").trim())
    .filter((item) => item.length > 2)
    .filter((item) => !/^(my|the|a)$/i.test(item))
    .slice(0, 5);

  if (parts.length > 0) {
    return parts;
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

const getHeatValue = (index: number): number => {
  const wave = Math.sin(index / 3.2) * 0.5 + 0.5;
  return Number((0.2 + wave * 0.8).toFixed(2));
};

export function App() {
  const [activeTab, setActiveTab] = useState<NavItem>("Dashboard");
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
  const [searchNote, setSearchNote] = useState("");

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
      { label: "Productivity", value: "84% focus score" },
      { label: "Open Loops", value: "17 active" },
      { label: "API", value: API_BASE.replace(/^https?:\/\//, "") },
    ],
    [agent]
  );

  const filteredNotes = useMemo(() => {
    if (!searchNote.trim()) {
      return KNOWLEDGE_NOTES;
    }
    return KNOWLEDGE_NOTES.filter((note) =>
      `${note.title} ${note.summary}`.toLowerCase().includes(searchNote.toLowerCase())
    );
  }, [searchNote]);

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

  const renderDashboard = () => {
    return (
      <section className="grid two-col">
        <article className="card">
          <h3>Today's Schedule</h3>
          <div className="timeline">
            {TODAY_SCHEDULE.map((slot) => (
              <div key={slot.time} className={`timeline-row ${slot.status}`}>
                <span>{slot.time}</span>
                <p>{slot.label}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <h3>AI Priorities</h3>
          <ul className="plain-list">
            {PRIORITIES.map((item, index) => (
              <li key={item}>
                <strong>P{index + 1}</strong>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="mini-progress">
            <p>Productivity Insight: High focus window from 11:00-13:00.</p>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: "78%" }} />
            </div>
          </div>
        </article>
      </section>
    );
  };

  const renderTasks = () => {
    return (
      <section className="grid three-col">
        {([
          ["To Do", KANBAN.todo],
          ["In Progress", KANBAN.doing],
          ["Done", KANBAN.done],
        ] as const).map(([title, items]) => (
          <article key={title} className="card kanban-col">
            <h3>{title}</h3>
            {items.map((task) => (
              <div key={task} className="task-chip">
                <p>{task}</p>
                <small>AI Priority: {Math.floor(Math.random() * 3) + 1}</small>
              </div>
            ))}
          </article>
        ))}
      </section>
    );
  };

  const renderHabits = () => {
    return (
      <section className="grid two-col">
        <article className="card">
          <h3>Streaks and Predictive Insights</h3>
          <div className="habit-cards">
            {HABIT_CARDS.map((habit) => (
              <div key={habit.label} className="habit-card">
                <strong>{habit.label}</strong>
                <span>{habit.streak} day streak</span>
                <div className="progress-track">
                  <div className="progress-fill alt" style={{ width: `${habit.confidence}%` }} />
                </div>
                <small>{habit.confidence}% likelihood of keeping streak tomorrow</small>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <h3>Consistency Heatmap</h3>
          <div className="heatmap">
            {Array.from({ length: 35 }).map((_, index) => (
              <span
                key={index}
                style={{ opacity: getHeatValue(index) }}
                title={`Day ${index + 1}`}
              />
            ))}
          </div>
        </article>
      </section>
    );
  };

  const renderEmail = () => {
    return (
      <section className="grid two-col">
        <article className="card">
          <h3>Categorized Inbox</h3>
          <div className="email-categories">
            {EMAIL_GROUPS.map((group) => (
              <div key={group.title} className="email-card">
                <header>
                  <strong>{group.title}</strong>
                  <span>{group.count}</span>
                </header>
                <p>{group.summary}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <h3>Suggested Replies</h3>
          <div className="plain-list replies">
            <li>
              <strong>Work</strong>
              <span>"Shipping by EOD. I'll share final notes and blockers at 5 PM."</span>
            </li>
            <li>
              <strong>Personal</strong>
              <span>"Confirmed for Sunday. I'll bring the documents and call ahead."</span>
            </li>
            <li>
              <strong>Urgent</strong>
              <span>"Received. Reviewing now and will respond within 20 minutes."</span>
            </li>
          </div>
        </article>
      </section>
    );
  };

  const renderKnowledge = () => {
    return (
      <section className="grid two-col">
        <article className="card">
          <h3>Personal Knowledge Base</h3>
          <input
            className="search-input"
            placeholder="Semantic search notes..."
            value={searchNote}
            onChange={(event) => setSearchNote(event.target.value)}
          />
          <div className="notes-list">
            {filteredNotes.map((note) => (
              <div key={note.title} className="note-item">
                <strong>{note.title}</strong>
                <p>{note.summary}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <h3>AI Summary Lens</h3>
          <p>
            Most notes indicate scheduling friction around admin tasks. Suggested strategy: reserve a
            daily 25-minute admin sprint before the evening shutdown routine.
          </p>
        </article>
      </section>
    );
  };

  const renderFinance = () => {
    return (
      <section className="grid two-col">
        <article className="card">
          <h3>Expense Categories</h3>
          <div className="bar-chart">
            {FINANCE_BARS.map((bar) => (
              <div key={bar.label} className="bar-row">
                <span>{bar.label}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${bar.value}%` }} />
                </div>
                <strong>{bar.value}%</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <h3>Spending Insight</h3>
          <div className="spend-donut" />
          <p>
            Leisure spend is trending 12% above your monthly baseline. AI recommendation: cap weekend
            discretionary budget and auto-tag subscriptions for review.
          </p>
        </article>
      </section>
    );
  };

  const renderAssistant = () => {
    return (
      <section className="grid single-col">
        <article className="card">
          <h3>AI Decision Assistant</h3>
          <p>
            Based on your calendar and deadlines: finish release notes now, then process urgent email,
            then do a short habit checkpoint before evening.
          </p>
        </article>

        <article className="card chat-panel">
          <div className="panel-header">
            <h3>Live Agent Chat</h3>
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
              placeholder="Ask TaskForge to optimize your life workflow..."
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
        </article>
      </section>
    );
  };

  const renderMainContent = () => {
    switch (activeTab) {
      case "Dashboard":
        return renderDashboard();
      case "Tasks":
        return renderTasks();
      case "Habits":
        return renderHabits();
      case "Email":
        return renderEmail();
      case "Knowledge":
        return renderKnowledge();
      case "Finance":
        return renderFinance();
      case "AI Assistant":
        return renderAssistant();
      default:
        return renderDashboard();
    }
  };

  return (
    <div className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <main className="layout shell-grid">
        <aside className="sidebar">
          <p className="eyebrow">Personal AI Stack</p>
          <h2>TaskForge OS</h2>
          <nav>
            {NAV_ITEMS.map((item) => (
              <button
                key={item}
                className={`side-link ${activeTab === item ? "active" : ""}`}
                onClick={() => setActiveTab(item)}
              >
                {item}
              </button>
            ))}
          </nav>
        </aside>

        <section className="content">
        <motion.header
          className="hero"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
        >
          <div>
            <p className="eyebrow">Nosana x ElizaOS</p>
            <h1>Personal Life Automation</h1>
            <p className="subtext">
              Manage schedule, tasks, habits, email, finance, and decisions through one AI-native
              command center.
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

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
          >
            {renderMainContent()}
          </motion.div>
        </AnimatePresence>
        </section>

        <aside className="right-rail card">
          <h3>Context Notifications</h3>
          <ul className="plain-list notifications">
            {NOTIFICATIONS.map((item) => (
              <li key={item}>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </aside>
      </main>
    </div>
  );
}
