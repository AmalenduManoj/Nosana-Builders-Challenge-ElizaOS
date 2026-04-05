import { FormEvent, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type {
  Agent,
  AgentApiResponse,
  AssistantResponse,
  ChatMessage,
  ServerApiResponse,
} from "./types";

const API_BASE = (import.meta.env.VITE_TASKFORGE_API_BASE as string | undefined)?.trim() || "http://127.0.0.1:3003";
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

type ModuleState = {
  dashboard: {
    schedule: Array<{ id: string; label: string; minutes: number; order: number; status: string }>;
    priorities: string[];
    productivityInsight: string;
  };
  tasks: Array<{ id: string; title: string; status: "todo" | "doing" | "done"; priority: 1 | 2 | 3 }>;
  habits: Array<{ id: string; name: string; streak: number; confidence: number; heatmap: number[] }>;
  emails: Array<{ id: string; category: "Work" | "Personal" | "Urgent"; summary: string; suggestedReply: string }>;
  knowledge: Array<{ id: string; title: string; summary: string }>;
  financeBars: Array<{ label: string; value: number }>;
  financeInsight: string;
  notifications: string[];
  suggestions: string[];
};

const getHeatValue = (index: number): number => {
  const wave = Math.sin(index / 3.2) * 0.5 + 0.5;
  return Number((0.2 + wave * 0.8).toFixed(2));
};

const DEFAULT_MODULE_STATE: ModuleState = {
  dashboard: {
    schedule: [],
    priorities: [],
    productivityInsight: "",
  },
  tasks: [],
  habits: [],
  emails: [],
  knowledge: [],
  financeBars: [],
  financeInsight: "",
  notifications: [],
  suggestions: [],
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

const hydrateModuleState = async (apiBase: string, userId: string): Promise<ModuleState | null> => {
  const userParam = encodeURIComponent(userId);
  const [dashboardRes, emailRes, tasksRes, habitsRes, knowledgeRes, financeRes, notifRes] =
    await Promise.all([
      fetch(`${apiBase}/api/taskforge/dashboard?userId=${userParam}`),
      fetch(`${apiBase}/api/taskforge/email?userId=${userParam}`),
      fetch(`${apiBase}/api/taskforge/tasks?userId=${userParam}`),
      fetch(`${apiBase}/api/taskforge/habits?userId=${userParam}`),
      fetch(`${apiBase}/api/taskforge/knowledge?userId=${userParam}`),
      fetch(`${apiBase}/api/taskforge/finance?userId=${userParam}`),
      fetch(`${apiBase}/api/taskforge/notifications?userId=${userParam}`),
    ]);

  const [dashboardJson, emailJson, tasksJson, habitsJson, knowledgeJson, financeJson, notifJson] = await Promise.all([
    dashboardRes.json(),
    emailRes.json(),
    tasksRes.json(),
    habitsRes.json(),
    knowledgeRes.json(),
    financeRes.json(),
    notifRes.json(),
  ]);

  const financeTotals = financeJson?.data?.categoryTotals || {};
  const financeBars = Object.entries(financeTotals)
    .map(([label, amount]) => ({ label, amount: Number(amount) || 0 }))
    .sort((a, b) => b.amount - a.amount);
  const maxAmount = financeBars[0]?.amount || 1;

  return {
    dashboard: dashboardJson?.data?.dashboard || DEFAULT_MODULE_STATE.dashboard,
    tasks: tasksJson?.data?.items || DEFAULT_MODULE_STATE.tasks,
    habits: habitsJson?.data?.items || DEFAULT_MODULE_STATE.habits,
    emails: emailJson?.data?.items || DEFAULT_MODULE_STATE.emails,
    knowledge: knowledgeJson?.data?.items || DEFAULT_MODULE_STATE.knowledge,
    financeBars:
      financeBars.length > 0
        ? financeBars.map((item) => ({
            label: item.label,
            value: Math.round((item.amount / maxAmount) * 100),
          }))
        : DEFAULT_MODULE_STATE.financeBars,
    financeInsight: financeJson?.data?.insight || DEFAULT_MODULE_STATE.financeInsight,
    notifications: (notifJson?.data?.items || []).map((item: { message: string }) => item.message),
    suggestions: dashboardJson?.data?.suggestions || DEFAULT_MODULE_STATE.suggestions,
  };
};

export function App() {
  const [activeTab, setActiveTab] = useState<NavItem>("Dashboard");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [serverId, setServerId] = useState<string>("00000000-0000-0000-0000-000000000000");
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
  const [modelStatus, setModelStatus] = useState("unknown");
  const [moduleState, setModuleState] = useState<ModuleState>(DEFAULT_MODULE_STATE);
  const [searchNote, setSearchNote] = useState("");
  const [gmailTo, setGmailTo] = useState("test@example.com");
  const [gmailSubject, setGmailSubject] = useState("TaskForge follow-up");
  const [gmailBody, setGmailBody] = useState("Hi,\n\nQuick update from TaskForge.\n\nRegards,");
  const [gmailStatusText, setGmailStatusText] = useState("No Gmail action yet.");
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailClassified, setGmailClassified] = useState<
    Array<{ id: string; from: string; subject: string; category: string; snippet: string }>
  >([]);

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
            text: "Unable to reach the TaskForge API. Ensure `pnpm start` is running.",
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

  useEffect(() => {
    let isMounted = true;

    const loadModuleData = async () => {
      try {
        const [nextModuleState, statusRes] = await Promise.all([
          hydrateModuleState(API_BASE, userId),
          fetch(`${API_BASE}/api/taskforge/system-status`),
        ]);
        const statusJson = await statusRes.json();

        if (!isMounted) {
          return;
        }

        if (nextModuleState) {
          setModuleState(nextModuleState);
        }

        const status = statusJson?.data?.model?.status || "unknown";
        setModelStatus(status);
      } catch {
        if (!isMounted) {
          return;
        }
        setModelStatus("offline");
      }
    };

    void loadModuleData();
    const interval = setInterval(() => {
      void loadModuleData();
    }, 15000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [userId]);

  const stats = useMemo(
    () => [
      { label: "Agent", value: agent?.name || "Not Connected" },
      { label: "Productivity", value: `${Math.min(moduleState.dashboard.priorities.length * 18 + 46, 95)}% focus score` },
      { label: "Open Loops", value: `${moduleState.tasks.filter((task) => task.status !== "done").length} active` },
      { label: "Model", value: modelStatus },
      { label: "API", value: API_BASE.replace(/^https?:\/\//, "") },
    ],
    [agent, modelStatus, moduleState.dashboard.priorities.length, moduleState.tasks]
  );

  const filteredNotes = useMemo(() => {
    if (!searchNote.trim()) {
      return moduleState.knowledge;
    }
    return moduleState.knowledge.filter((note) =>
      `${note.title} ${note.summary}`.toLowerCase().includes(searchNote.toLowerCase())
    );
  }, [moduleState.knowledge, searchNote]);

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

  const appendAgentReply = (agentText: string, role: "agent" | "system" = "agent") => {
    const message: ChatMessage = {
      id: generateId(),
      role,
      text: agentText,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, message]);
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    appendUserMessage(trimmed);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/taskforge/assistant`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          prompt: trimmed,
        }),
      });

      if (!response.ok) {
        throw new Error(`Assistant request failed (${response.status})`);
      }

      const json = (await response.json()) as AssistantResponse;
      const reply = json.data?.reply?.trim();

      if (reply) {
        appendAgentReply(reply, "agent");
      } else if (json.error) {
        appendAgentReply(json.error, "system");
      } else {
        appendAgentReply("Assistant returned no reply.", "system");
      }

      if (Array.isArray(json.data?.suggestions) && json.data.suggestions.length > 0) {
        setModuleState((prev) => ({
          ...prev,
          suggestions: json.data?.suggestions || prev.suggestions,
        }));
      }

      const nextModuleState = await hydrateModuleState(API_BASE, userId);
      if (nextModuleState) {
        setModuleState(nextModuleState);
      }

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
            {moduleState.dashboard.schedule.length === 0 && <p>No schedule data yet.</p>}
            {moduleState.dashboard.schedule.map((slot) => (
              <div key={slot.id} className={`timeline-row ${slot.status}`}>
                <span>{slot.minutes}m</span>
                <p>{slot.label}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <h3>AI Priorities</h3>
          <ul className="plain-list">
            {moduleState.dashboard.priorities.length === 0 && <li><span>No priorities yet.</span></li>}
            {moduleState.dashboard.priorities.map((item, index) => (
              <li key={item}>
                <strong>P{index + 1}</strong>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="mini-progress">
            <p>Productivity Insight: {moduleState.dashboard.productivityInsight || "Waiting for insight..."}</p>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: "78%" }} />
            </div>
          </div>
        </article>
      </section>
    );
  };

  const renderTasks = () => {
    const todo = moduleState.tasks.filter((task) => task.status === "todo");
    const doing = moduleState.tasks.filter((task) => task.status === "doing");
    const done = moduleState.tasks.filter((task) => task.status === "done");

    return (
      <section className="grid three-col">
        {([
          ["To Do", todo],
          ["In Progress", doing],
          ["Done", done],
        ] as const).map(([title, items]) => (
          <article key={title} className="card kanban-col">
            <h3>{title}</h3>
            {items.map((task) => (
              <div key={task.id} className="task-chip">
                <p>{task.title}</p>
                <small>AI Priority: {task.priority}</small>
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
            {moduleState.habits.map((habit) => (
              <div key={habit.id} className="habit-card">
                <strong>{habit.name}</strong>
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
            {(moduleState.habits[0]?.heatmap || []).map((value, index) => (
              <span
                key={index}
                style={{ opacity: value }}
                title={`Day ${index + 1}`}
              />
            ))}
            {moduleState.habits.length === 0 && <p>No habit heatmap data yet.</p>}
          </div>
        </article>
      </section>
    );
  };

  const renderEmail = () => {
    const grouped = ["Work", "Personal", "Urgent"].map((category) => {
      const items = moduleState.emails.filter((item) => item.category === category);
      return {
        title: category,
        count: items.length,
        summary: items[0]?.summary || "No messages in this category.",
      };
    });

    return (
      <section className="grid two-col">
        <article className="card">
          <h3>Categorized Inbox</h3>
          <div className="email-categories">
            {grouped.map((group) => (
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
          <h3>Gmail Quick Actions</h3>
          <div className="gmail-actions">
            <button
              type="button"
              className="gmail-action-btn"
              disabled={gmailBusy}
              onClick={async () => {
                setGmailBusy(true);
                try {
                  const response = await fetch(`${API_BASE}/api/taskforge/gmail/status`);
                  const json = await response.json();
                  if (!response.ok) {
                    throw new Error(json?.error || "Unable to check Gmail status");
                  }
                  setGmailStatusText(
                    `Check Gmail status: configured=${String(Boolean(json?.data?.configured))}, user=${json?.data?.user || "me"}`
                  );
                } catch (error) {
                  setGmailStatusText(error instanceof Error ? error.message : "Gmail status failed");
                } finally {
                  setGmailBusy(false);
                }
              }}
            >
              Check Gmail status
            </button>

            <button
              type="button"
              className="gmail-action-btn"
              disabled={gmailBusy}
              onClick={async () => {
                setGmailBusy(true);
                try {
                  const response = await fetch(`${API_BASE}/api/taskforge/gmail/unread?maxResults=10`);
                  const json = await response.json();
                  if (!response.ok) {
                    throw new Error(json?.error || "Unable to fetch unread emails");
                  }
                  const count = Number(json?.data?.unreadCountEstimate || 0);
                  setGmailStatusText(`Fetch unread: ${count} unread (estimate).`);
                } catch (error) {
                  setGmailStatusText(error instanceof Error ? error.message : "Fetch unread failed");
                } finally {
                  setGmailBusy(false);
                }
              }}
            >
              Fetch unread
            </button>

            <button
              type="button"
              className="gmail-action-btn"
              disabled={gmailBusy}
              onClick={async () => {
                setGmailBusy(true);
                try {
                  const response = await fetch(`${API_BASE}/api/taskforge/gmail/classify-latest?maxResults=10`);
                  const json = await response.json();
                  if (!response.ok) {
                    throw new Error(json?.error || "Unable to classify latest emails");
                  }
                  const items = Array.isArray(json?.data?.items) ? json.data.items : [];
                  setGmailClassified(items);
                  const interviewCount = Number(json?.data?.interviewCount || 0);
                  const unreadEstimate = Number(json?.data?.unreadCountEstimate || 0);
                  setGmailStatusText(
                    `Latest classified: ${items.length} analyzed, ${interviewCount} interview mails, ${unreadEstimate} unread (estimate).`
                  );
                } catch (error) {
                  setGmailStatusText(error instanceof Error ? error.message : "Classification failed");
                } finally {
                  setGmailBusy(false);
                }
              }}
            >
              Classify latest mail
            </button>
          </div>

          <div className="gmail-form">
            <input
              value={gmailTo}
              onChange={(event) => setGmailTo(event.target.value)}
              placeholder="Recipient email"
              aria-label="Gmail recipient"
            />
            <input
              value={gmailSubject}
              onChange={(event) => setGmailSubject(event.target.value)}
              placeholder="Subject"
              aria-label="Gmail subject"
            />
            <textarea
              value={gmailBody}
              onChange={(event) => setGmailBody(event.target.value)}
              placeholder="Message body"
              aria-label="Gmail body"
              rows={4}
            />
          </div>

          <div className="gmail-actions">
            <button
              type="button"
              className="gmail-action-btn"
              disabled={gmailBusy}
              onClick={async () => {
                setGmailBusy(true);
                try {
                  const response = await fetch(`${API_BASE}/api/taskforge/gmail/drafts`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      userId,
                      to: gmailTo,
                      subject: gmailSubject,
                      body: gmailBody,
                    }),
                  });
                  const json = await response.json();
                  if (!response.ok) {
                    throw new Error(json?.error || "Unable to create Gmail draft");
                  }
                  setGmailStatusText(`Create Gmail draft: success (draftId=${json?.data?.draftId || "n/a"}).`);
                  const nextModuleState = await hydrateModuleState(API_BASE, userId);
                  if (nextModuleState) {
                    setModuleState(nextModuleState);
                  }
                } catch (error) {
                  setGmailStatusText(error instanceof Error ? error.message : "Create draft failed");
                } finally {
                  setGmailBusy(false);
                }
              }}
            >
              Create Gmail draft
            </button>

            <button
              type="button"
              className="gmail-action-btn"
              disabled={gmailBusy}
              onClick={async () => {
                setGmailBusy(true);
                try {
                  const response = await fetch(`${API_BASE}/api/taskforge/gmail/send`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      to: gmailTo,
                      subject: gmailSubject,
                      body: gmailBody,
                    }),
                  });
                  const json = await response.json();
                  if (!response.ok) {
                    throw new Error(json?.error || "Unable to send Gmail message");
                  }
                  setGmailStatusText(`Send Gmail message: success (messageId=${json?.data?.messageId || "n/a"}).`);
                } catch (error) {
                  setGmailStatusText(error instanceof Error ? error.message : "Send message failed");
                } finally {
                  setGmailBusy(false);
                }
              }}
            >
              Send Gmail message
            </button>
          </div>

          <p className="gmail-status">{gmailStatusText}</p>

          <div className="gmail-classified-list">
            {gmailClassified.slice(0, 6).map((item) => (
              <div key={item.id} className="gmail-classified-item">
                <header>
                  <strong>{item.category}</strong>
                  <span>{item.from || "Unknown sender"}</span>
                </header>
                <p>{item.subject}</p>
              </div>
            ))}
          </div>

          <h3>Suggested Replies</h3>
          <div className="plain-list replies">
            {moduleState.emails.length === 0 && <li><span>No email suggestions yet.</span></li>}
            {moduleState.emails.map((item) => (
              <li key={item.id}>
                <strong>{item.category}</strong>
                <span>"{item.suggestedReply}"</span>
              </li>
            ))}
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
            {moduleState.suggestions[0] || "Semantic insight will appear after your module data is loaded."}
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
            {moduleState.financeBars.map((bar) => (
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
          <p>{moduleState.financeInsight || "No spending insight yet."}</p>
        </article>
      </section>
    );
  };

  const renderAssistant = () => {
    return (
      <section className="grid single-col">
        <article className="card">
          <h3>AI Decision Assistant</h3>
          <p>{moduleState.suggestions[0] || "No recommendation available"}</p>
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
          <p className="eyebrow">Model Status: {modelStatus}</p>
          <ul className="plain-list notifications">
            {moduleState.notifications.map((item) => (
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
