import {
  asUUID,
  ChannelType,
  type Action,
  type ActionResult,
  type Component,
  type Entity,
  type IAgentRuntime,
  type Memory,
  type Plugin,
  type Route,
  type UUID,
} from "@elizaos/core";

type RouteIntent = "plan" | "reprioritize" | "reminder";

type PlanBlock = {
  id: string;
  label: string;
  minutes: number;
  order: number;
  status: "done" | "active" | "upcoming";
};

type DashboardPayload = {
  generatedAt: number;
  schedule: PlanBlock[];
  priorities: string[];
  productivityInsight: string;
};

type EmailItem = {
  id: string;
  category: "Work" | "Personal" | "Urgent";
  subject: string;
  summary: string;
  suggestedReply: string;
  timestamp: number;
};

type TaskItem = {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
  deadline: string;
  priority: 1 | 2 | 3;
  createdAt: number;
};

type HabitItem = {
  id: string;
  name: string;
  streak: number;
  confidence: number;
  heatmap: number[];
  updatedAt: number;
};

type NoteItem = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  createdAt: number;
};

type FinanceItem = {
  id: string;
  category: string;
  amount: number;
  month: string;
  timestamp: number;
};

type NotificationItem = {
  id: string;
  message: string;
  level: "info" | "warning";
  createdAt: number;
};

type UserContext = {
  userKey: string;
  entityId: UUID;
  roomId: UUID;
  worldId: UUID;
  sourceEntityId: UUID;
};

type QueryObj = Record<string, unknown> | undefined;

type ModuleSnapshot = {
  dashboard: DashboardPayload;
  emails: { items: EmailItem[]; generatedAt: number };
  tasks: { items: TaskItem[]; generatedAt: number };
  habits: { items: HabitItem[]; generatedAt: number };
  knowledge: { items: NoteItem[]; generatedAt: number };
  finance: { items: FinanceItem[]; generatedAt: number };
  notifications: { items: NotificationItem[]; generatedAt: number };
};

const DEFAULT_USER_KEY = "local-demo-user";

const COMPONENT_TYPES = {
  DASHBOARD: "taskforge.dashboard",
  EMAIL: "taskforge.email",
  TASKS: "taskforge.tasks",
  HABITS: "taskforge.habits",
  KNOWLEDGE: "taskforge.knowledge",
  FINANCE: "taskforge.finance",
  NOTIFICATIONS: "taskforge.notifications",
} as const;

const moduleStateByUser = new Map<string, ModuleSnapshot>();

const now = (): number => Date.now();

const hex32 = (seed: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const hashToUuid = (seed: string): UUID => {
  const hex = `${hex32(`${seed}:a`)}${hex32(`${seed}:b`)}${hex32(`${seed}:c`)}${hex32(`${seed}:d`)}`;
  const part1 = hex.slice(0, 8);
  const part2 = hex.slice(8, 12);
  const part3 = `4${hex.slice(13, 16)}`;
  const variantNibble = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  const part4 = `${variantNibble}${hex.slice(17, 20)}`;
  const part5 = hex.slice(20, 32);
  return asUUID(`${part1}-${part2}-${part3}-${part4}-${part5}`);
};

const randomUuid = (): UUID => asUUID(crypto.randomUUID());

const getUserKeyFromRequest = (query: QueryObj, body?: unknown): string => {
  const queryUser = typeof query?.userId === "string" ? query.userId : undefined;
  const bodyObj = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const bodyUser = typeof bodyObj.userId === "string" ? bodyObj.userId : undefined;
  const raw = bodyUser || queryUser || DEFAULT_USER_KEY;
  return raw.trim() || DEFAULT_USER_KEY;
};

const hasContent = (message: Memory): boolean => {
  const text = message?.content?.text;
  return typeof text === "string" && text.trim().length > 0;
};

const getText = (message: Memory): string => {
  return typeof message.content?.text === "string" ? message.content.text : "";
};

const getUserKeyFromMemory = (message: Memory): string => {
  const metadata = (message.metadata ?? {}) as Record<string, unknown>;
  const userId = typeof metadata.userId === "string" ? metadata.userId : undefined;
  return userId?.trim() || DEFAULT_USER_KEY;
};

const normalizeTaskText = (task: string): string => {
  const normalized = task.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Untitled task";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const extractTasks = (text: string): string[] => {
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
    .map((item) => normalizeTaskText(item));

  const unique = Array.from(new Set(parts));
  if (unique.length > 0) {
    return unique.slice(0, 6);
  }

  return ["Primary task", "Secondary task", "Admin follow-up"];
};

const extractTotalMinutes = (text: string): number => {
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hour|hours|hr|hrs|h)\b/i);
  const minuteMatch = text.match(/(\d+)\s*(?:minute|minutes|min|mins|m)\b/i);
  const fromHours = hourMatch ? Math.round(parseFloat(hourMatch[1]) * 60) : 0;
  const fromMinutes = minuteMatch ? parseInt(minuteMatch[1], 10) : 0;
  const total = fromHours + fromMinutes;
  return total >= 30 ? total : 180;
};

const allocateTimeBlocks = (tasks: string[], totalMinutes: number): PlanBlock[] => {
  const blockCount = Math.max(tasks.length, 1);
  const reserve = 15;
  const allocatable = Math.max(totalMinutes - reserve, 45);
  const base = Math.floor(allocatable / blockCount);
  let remainder = allocatable - base * blockCount;

  const blocks = tasks.map((task, index) => {
    const remainderBoost = remainder > 0 ? 5 : 0;
    if (remainder > 0) {
      remainder -= 5;
    }

    return {
      id: hashToUuid(`plan:${task}:${index}`),
      label: task,
      minutes: Math.max(base + (index === 0 ? 10 : 0) + remainderBoost, 20),
      order: index + 1,
      status: index === 0 ? ("active" as const) : ("upcoming" as const),
    };
  });

  blocks.push({
    id: hashToUuid("plan:buffer"),
    label: "Buffer and review",
    minutes: reserve,
    order: blocks.length + 1,
    status: "upcoming",
  });

  return blocks;
};

const routeIntent = (text: string, fallback: RouteIntent): RouteIntent => {
  const lower = text.toLowerCase();
  if (/(remind|reminder|ping me|notify)/.test(lower)) {
    return "reminder";
  }
  if (/(reprioritize|replan|reschedule|moved|shifted|urgent)/.test(lower)) {
    return "reprioritize";
  }
  if (/(plan|schedule|time block|organize my day|today)/.test(lower)) {
    return "plan";
  }
  return fallback;
};

const parseGoal = (text: string): string => {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "Create a realistic day plan";
  }
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
};

const defaultDashboard = (): DashboardPayload => {
  return {
    generatedAt: now(),
    schedule: [],
    priorities: [],
    productivityInsight: "Waiting for your first plan.",
  };
};

const defaultEmails = (): { items: EmailItem[]; generatedAt: number } => ({
  generatedAt: now(),
  items: [],
});

const defaultTasks = (): { items: TaskItem[]; generatedAt: number } => ({
  generatedAt: now(),
  items: [],
});

const defaultHabits = (): { items: HabitItem[]; generatedAt: number } => ({
  generatedAt: now(),
  items: [],
});

const defaultKnowledge = (): { items: NoteItem[]; generatedAt: number } => ({
  generatedAt: now(),
  items: [],
});

const defaultFinance = (): { items: FinanceItem[]; generatedAt: number } => ({
  generatedAt: now(),
  items: [],
});

const defaultNotifications = (): { items: NotificationItem[]; generatedAt: number } => ({
  generatedAt: now(),
  items: [],
});

const createEmptySnapshot = (): ModuleSnapshot => ({
  dashboard: defaultDashboard(),
  emails: defaultEmails(),
  tasks: defaultTasks(),
  habits: defaultHabits(),
  knowledge: defaultKnowledge(),
  finance: defaultFinance(),
  notifications: defaultNotifications(),
});

const mergeWithDefault = <T extends Record<string, unknown>>(value: unknown, defaults: T): T => {
  if (typeof value !== "object" || value === null) {
    return defaults;
  }

  return {
    ...defaults,
    ...(value as Record<string, unknown>),
  } as T;
};

const createSnapshotFromComponents = (components: {
  dashboardComponent: Component;
  emailComponent: Component;
  tasksComponent: Component;
  habitsComponent: Component;
  knowledgeComponent: Component;
  financeComponent: Component;
  notificationsComponent: Component;
}): ModuleSnapshot => {
  return {
    dashboard: mergeWithDefault(components.dashboardComponent.data, defaultDashboard()),
    emails: mergeWithDefault(components.emailComponent.data, defaultEmails()),
    tasks: mergeWithDefault(components.tasksComponent.data, defaultTasks()),
    habits: mergeWithDefault(components.habitsComponent.data, defaultHabits()),
    knowledge: mergeWithDefault(components.knowledgeComponent.data, defaultKnowledge()),
    finance: mergeWithDefault(components.financeComponent.data, defaultFinance()),
    notifications: mergeWithDefault(components.notificationsComponent.data, defaultNotifications()),
  };
};

const getSnapshotForUser = (userKey: string, seed?: ModuleSnapshot): ModuleSnapshot => {
  const existing = moduleStateByUser.get(userKey);
  if (existing) {
    return existing;
  }
  const initial = seed ?? createEmptySnapshot();
  moduleStateByUser.set(userKey, initial);
  return initial;
};

const patchSnapshotForUser = (userKey: string, patch: Partial<ModuleSnapshot>): ModuleSnapshot => {
  const current = getSnapshotForUser(userKey);
  const next: ModuleSnapshot = {
    ...current,
    ...patch,
  };
  moduleStateByUser.set(userKey, next);
  return next;
};

const toPriority = (index: number): 1 | 2 | 3 => {
  if (index <= 0) return 1;
  if (index === 1) return 2;
  return 3;
};

type AssistantCommand =
  | { type: "add_habit"; habitName: string }
  | { type: "add_email_draft"; recipient?: string; subject: string; body: string }
  | { type: "add_notification"; message: string }
  | { type: "clear_schedule" }
  | { type: "none" };

const readEnv = (key: string): string | undefined => {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];
};

const gmailAuthCache: { accessToken?: string; expiresAtMs?: number } = {
  accessToken: readEnv("GMAIL_ACCESS_TOKEN") || readEnv("GOOGLE_ACCESS_TOKEN"),
};

const hasGmailRefreshConfig = (): boolean => {
  return Boolean(readEnv("GMAIL_REFRESH_TOKEN") && readEnv("GOOGLE_CLIENT_ID") && readEnv("GOOGLE_CLIENT_SECRET"));
};

const hasGmailAuthConfigured = (): boolean => {
  return Boolean(gmailAuthCache.accessToken || hasGmailRefreshConfig());
};

const refreshGmailAccessToken = async (): Promise<string> => {
  const refreshToken = readEnv("GMAIL_REFRESH_TOKEN");
  const clientId = readEnv("GOOGLE_CLIENT_ID");
  const clientSecret = readEnv("GOOGLE_CLIENT_SECRET");

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("Gmail refresh configuration is missing (GMAIL_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)");
  }

  const payload = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to refresh Gmail access token (${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!json.access_token) {
    throw new Error("Token refresh response did not include access_token");
  }

  const ttlMs = (typeof json.expires_in === "number" ? json.expires_in : 3600) * 1000;
  gmailAuthCache.accessToken = json.access_token;
  gmailAuthCache.expiresAtMs = Date.now() + ttlMs;

  return json.access_token;
};

const resolveGmailAccessToken = async (): Promise<string> => {
  const cached = gmailAuthCache.accessToken;
  const expiry = gmailAuthCache.expiresAtMs;

  if (cached && (!expiry || Date.now() < expiry - 60_000)) {
    return cached;
  }

  if (hasGmailRefreshConfig()) {
    return refreshGmailAccessToken();
  }

  if (cached) {
    return cached;
  }

  throw new Error("Gmail access is not configured");
};

const getGmailUser = (): string => {
  return readEnv("GMAIL_USER") || "me";
};

const encodeEmailRFC822 = (to: string, subject: string, body: string): string => {
  const raw = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=\"UTF-8\"\r\n\r\n${body}`;
  const bytes = new TextEncoder().encode(raw);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const gmailRequest = async <T>(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown
): Promise<T> => {
  const makeRequest = async (token: string) =>
    fetch(`https://gmail.googleapis.com/gmail/v1/users/${getGmailUser()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  let response = await makeRequest(await resolveGmailAccessToken());

  if (response.status === 401 && hasGmailRefreshConfig()) {
    const refreshed = await refreshGmailAccessToken();
    response = await makeRequest(refreshed);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail API ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
};

const extractEmailAddress = (text: string): string | undefined => {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match?.[0];
};

type GmailHeader = { name?: string; value?: string };

const getHeaderValue = (headers: GmailHeader[] | undefined, name: string): string => {
  if (!Array.isArray(headers)) {
    return "";
  }
  const hit = headers.find((header) => (header.name || "").toLowerCase() === name.toLowerCase());
  return hit?.value || "";
};

type GmailCategory = "Interview" | "Urgent" | "Finance" | "Work" | "Personal" | "Other";

type GmailClassification = {
  category: GmailCategory;
  confidence: number;
  reasons: string[];
};

type UnreadMessageDetail = {
  id?: string;
  threadId?: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  category: GmailCategory;
  confidence: number;
  reasons: string[];
  isInterview: boolean;
  receivedAt?: number;
  hasMeetingSignals: boolean;
};

const getSenderDomain = (from: string): string => {
  const address = extractEmailAddress(from || "");
  if (!address || !address.includes("@")) {
    return "";
  }
  const domain = address.split("@")[1] || "";
  return domain.toLowerCase();
};

const classifyGmailMessage = (subject: string, snippet: string, from: string): GmailClassification => {
  const subjectBlob = (subject || "").toLowerCase();
  const snippetBlob = (snippet || "").toLowerCase();
  const fromBlob = (from || "").toLowerCase();
  const combined = `${subjectBlob} ${snippetBlob} ${fromBlob}`;
  const senderDomain = getSenderDomain(from);

  const scores: Record<Exclude<GmailCategory, "Other">, number> = {
    Interview: 0,
    Urgent: 0,
    Finance: 0,
    Work: 0,
    Personal: 0,
  };

  const reasons: string[] = [];

  const addIfMatch = (
    category: Exclude<GmailCategory, "Other">,
    condition: boolean,
    points: number,
    reason: string
  ): void => {
    if (condition) {
      scores[category] += points;
      reasons.push(reason);
    }
  };

  addIfMatch(
    "Interview",
    /(linkedin\.com|greenhouse\.io|lever\.co|ashbyhq\.com|workday\.com|naukri\.com|indeed\.com)/.test(senderDomain),
    5,
    "sender domain suggests recruiting"
  );
  addIfMatch(
    "Interview",
    /(interview|technical\s+round|hr\s+round|hiring\s+team|job\s+application|application\s+status|assessment|coding\s+challenge|recruiter)/.test(subjectBlob),
    6,
    "subject contains interview keywords"
  );
  addIfMatch(
    "Interview",
    /(job\s+application|position|role|candidate|resume|cv|hiring)/.test(snippetBlob),
    3,
    "snippet contains hiring context"
  );

  addIfMatch(
    "Urgent",
    /(urgent|asap|immediate|today|action\s+required|deadline|expires\s+today)/.test(subjectBlob),
    6,
    "subject contains urgent wording"
  );
  addIfMatch(
    "Urgent",
    /(urgent|asap|immediately|high\s+priority|deadline)/.test(snippetBlob),
    3,
    "snippet contains urgency signals"
  );

  addIfMatch(
    "Finance",
    /(invoice|payment|bank|statement|salary|refund|upi|credit|debit|transaction|subscription\s+renewal|bill)/.test(subjectBlob),
    6,
    "subject contains finance terms"
  );
  addIfMatch(
    "Finance",
    /(stripe|razorpay|paypal|visa|mastercard|hdfc|icici|sbi|axisbank|noreply@bank)/.test(combined),
    4,
    "content references payment providers or bank entities"
  );

  addIfMatch(
    "Work",
    /(project|meeting|sprint|client|release|ticket|task|team|manager|standup|jira|slack)/.test(subjectBlob),
    5,
    "subject contains work planning terms"
  );
  addIfMatch(
    "Work",
    /(roadmap|deliverable|milestone|sync|follow-up)/.test(snippetBlob),
    2,
    "snippet contains delivery coordination"
  );

  addIfMatch(
    "Personal",
    /(family|friend|birthday|travel|personal|home|wedding|vacation)/.test(subjectBlob),
    4,
    "subject contains personal-life terms"
  );
  addIfMatch(
    "Personal",
    /(family|mom|dad|buddy|trip|holiday)/.test(snippetBlob),
    2,
    "snippet contains personal context"
  );

  const ranked = (Object.entries(scores) as Array<[Exclude<GmailCategory, "Other">, number]>).sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }

    const tieBreak: Record<Exclude<GmailCategory, "Other">, number> = {
      Interview: 5,
      Urgent: 4,
      Finance: 3,
      Work: 2,
      Personal: 1,
    };

    return tieBreak[b[0]] - tieBreak[a[0]];
  });

  const [bestCategory, bestScore] = ranked[0];
  const secondBestScore = ranked[1]?.[1] ?? 0;

  if (bestScore < 4) {
    return {
      category: "Other",
      confidence: 30,
      reasons: reasons.slice(0, 2),
    };
  }

  const margin = Math.max(bestScore - secondBestScore, 0);
  const confidence = Math.min(96, 58 + bestScore * 4 + margin * 6);

  return {
    category: bestCategory,
    confidence,
    reasons: reasons.filter((reason) => {
      if (bestCategory === "Interview") return reason.includes("interview") || reason.includes("recruiting") || reason.includes("hiring");
      if (bestCategory === "Urgent") return reason.includes("urgent") || reason.includes("urgency");
      if (bestCategory === "Finance") return reason.includes("finance") || reason.includes("payment") || reason.includes("bank");
      if (bestCategory === "Work") return reason.includes("work") || reason.includes("delivery");
      return reason.includes("personal");
    }).slice(0, 3),
  };
};

const hasMeetingSignals = (subject: string, snippet: string): boolean => {
  const blob = `${subject} ${snippet}`.toLowerCase();
  return /(meeting|sync|call|standup|interview|zoom|google\s+meet|teams|webex|calendar\s+invite|invite|schedule)/.test(blob);
};

const extractMeetingWhenText = (subject: string, snippet: string): string | undefined => {
  const blob = `${subject} ${snippet}`;

  const todayOrTomorrow = blob.match(/\b(today|tomorrow)\b[^\n,.]{0,40}\b(\d{1,2}(?::\d{2})?\s?(?:am|pm))\b/i);
  if (todayOrTomorrow) {
    return `${todayOrTomorrow[1]} at ${todayOrTomorrow[2]}`;
  }

  const weekdayWithTime = blob.match(
    /\b(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b[^\n,.]{0,40}\b(\d{1,2}(?::\d{2})?\s?(?:am|pm))\b/i
  );
  if (weekdayWithTime) {
    return `${weekdayWithTime[1]} at ${weekdayWithTime[2]}`;
  }

  const timeOnly = blob.match(/\b(\d{1,2}(?::\d{2})?\s?(?:am|pm))\b/i);
  if (timeOnly) {
    return `today at ${timeOnly[1]}`;
  }

  return undefined;
};

const cleanupMeetingTitle = (subject: string): string => {
  const normalized = (subject || "Meeting")
    .replace(/^(re|fwd?)\s*:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || "Meeting";
};

const buildQuickAddTextForMeeting = (item: UnreadMessageDetail): string | undefined => {
  const when = extractMeetingWhenText(item.subject, item.snippet);
  if (!when) {
    return undefined;
  }
  const title = cleanupMeetingTitle(item.subject);
  return `${title} ${when}`;
};

const googleApiRequest = async <T>(
  url: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: unknown
): Promise<T> => {
  const makeRequest = async (token: string) =>
    fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  let response = await makeRequest(await resolveGmailAccessToken());

  if (response.status === 401 && hasGmailRefreshConfig()) {
    const refreshed = await refreshGmailAccessToken();
    response = await makeRequest(refreshed);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google API ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
};

const calendarRequest = async <T>(
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: unknown
): Promise<T> => {
  const base = "https://www.googleapis.com/calendar/v3";
  return googleApiRequest<T>(`${base}${path}`, method, body);
};

const fetchUnreadMessageDetails = async (
  maxResults: number
): Promise<{ unreadCountEstimate: number; items: UnreadMessageDetail[] }> => {
  const list = await gmailRequest<{
    resultSizeEstimate?: number;
    messages?: Array<{ id?: string; threadId?: string }>;
  }>(`/messages?q=is:unread&maxResults=${maxResults}`);

  const messageRefs = (list.messages || []).filter((msg) => Boolean(msg.id));

  const items = await Promise.all(
    messageRefs.map(async (msg) => {
      const data = await gmailRequest<{
        id?: string;
        snippet?: string;
        internalDate?: string;
        payload?: { headers?: GmailHeader[] };
      }>(`/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);

      const from = getHeaderValue(data.payload?.headers, "From");
      const subject = getHeaderValue(data.payload?.headers, "Subject") || "(no subject)";
      const date = getHeaderValue(data.payload?.headers, "Date");
      const snippet = data.snippet || "";
      const classification = classifyGmailMessage(subject, snippet, from);

      return {
        id: data.id || msg.id,
        threadId: msg.threadId,
        from,
        subject,
        date,
        snippet,
        category: classification.category,
        confidence: classification.confidence,
        reasons: classification.reasons,
        isInterview: classification.category === "Interview",
        receivedAt: data.internalDate ? Number(data.internalDate) : undefined,
        hasMeetingSignals: hasMeetingSignals(subject, snippet),
      } as UnreadMessageDetail;
    })
  );

  return {
    unreadCountEstimate: list.resultSizeEstimate || 0,
    items,
  };
};

const buildInboxNarrativeSummary = (items: UnreadMessageDetail[]): { summary: string; actionItems: string[] } => {
  if (items.length === 0) {
    return {
      summary: "No unread emails right now.",
      actionItems: ["Inbox is clear. Check again later."],
    };
  }

  const counts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});

  const ordered = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `${category}: ${count}`)
    .join(", ");

  const actionItems: string[] = [];
  const urgentCount = counts.Urgent || 0;
  const interviewCount = counts.Interview || 0;
  const financeCount = counts.Finance || 0;
  const meetingCount = items.filter((item) => item.hasMeetingSignals).length;

  if (urgentCount > 0) {
    actionItems.push(`Respond to ${urgentCount} urgent email${urgentCount > 1 ? "s" : ""} first.`);
  }
  if (interviewCount > 0) {
    actionItems.push(`Review ${interviewCount} interview-related thread${interviewCount > 1 ? "s" : ""}.`);
  }
  if (financeCount > 0) {
    actionItems.push(`Check ${financeCount} finance/payment message${financeCount > 1 ? "s" : ""}.`);
  }
  if (meetingCount > 0) {
    actionItems.push(`There are ${meetingCount} meeting-like email${meetingCount > 1 ? "s" : ""} ready for calendar sync.`);
  }

  if (actionItems.length === 0) {
    actionItems.push("Triage top unread messages by sender and date.");
  }

  return {
    summary: `You have ${items.length} analyzed unread emails. Category mix: ${ordered}.`,
    actionItems,
  };
};

const parseAssistantCommand = (prompt: string): AssistantCommand => {
  const lower = prompt.toLowerCase();

  const clearSchedule = /(clear|cleared|remove|removed|delete|deleted)\s+.*(schedule|calendar)|\b(remove|removed|clear|cleared)\s+(the\s+)?schedule\b/.test(lower);
  if (clearSchedule) {
    return { type: "clear_schedule" };
  }

  const notifyMatch = prompt.match(/(?:notify(?:\s+me)?|add\s+notification)\s+(.+)/i);
  if (notifyMatch?.[1]) {
    const message = notifyMatch[1].trim().replace(/[.!?]+$/g, "");
    if (message.length > 0) {
      return { type: "add_notification", message };
    }
  }

  const draftEmailIntent = /(draft|create|write)\s+.*(email|mail)/i.test(prompt);
  if (draftEmailIntent) {
    const recipient = extractEmailAddress(prompt);
    const subjectMatch = prompt.match(/subject\s*[:\-]\s*(.+)$/i);
    const subject = (subjectMatch?.[1] || "TaskForge follow-up").trim();
    const body =
      "Hi,\n\nQuick update from TaskForge. Sharing current status and next steps.\n\nRegards,";
    return {
      type: "add_email_draft",
      recipient,
      subject,
      body,
    };
  }

  const addHabitMatch = prompt.match(/(?:add|create|new)\s+(?:a\s+|an\s+)?(?:habit|habbit)\s+(.+)/i);
  if (addHabitMatch?.[1]) {
    const habitName = normalizeTaskText(addHabitMatch[1]).replace(/[.!?]+$/g, "").trim();
    if (habitName.length > 0) {
      return { type: "add_habit", habitName };
    }
  }

  return { type: "none" };
};

const taskFromLabel = (label: string, index: number): TaskItem => ({
  id: randomUuid(),
  title: label,
  status: index === 0 ? "doing" : "todo",
  deadline: new Date(Date.now() + (index + 1) * 2 * 60 * 60 * 1000).toISOString(),
  priority: toPriority(index),
  createdAt: now(),
});

const parseJsonBody = (value: unknown): Record<string, unknown> => {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
};

const sendJson = (res: { status: (code: number) => { json: (data: unknown) => void } }, code: number, payload: unknown): void => {
  res.status(code).json(payload);
};

const ensureUserContext = async (runtime: IAgentRuntime, userKey: string): Promise<UserContext> => {
  const entityId = hashToUuid(`entity:${userKey}`);
  const worldId = hashToUuid(`world:${userKey}`);
  const roomId = hashToUuid(`room:${userKey}`);
  const sourceEntityId = runtime.agentId;

  const existingEntity = await runtime.getEntityById(entityId);
  if (!existingEntity) {
    const entity: Entity = {
      id: entityId,
      names: [userKey],
      metadata: {
        externalUserId: userKey,
        createdAt: now(),
      },
      agentId: runtime.agentId,
    };
    await runtime.createEntity(entity);
  }

  const existingWorld = await runtime.getWorld(worldId);
  if (!existingWorld) {
    await runtime.createWorld({
      id: worldId,
      name: `TaskForge World ${userKey}`,
      agentId: runtime.agentId,
      metadata: {
        ownership: { ownerId: entityId },
      },
    });
  }

  const existingRoom = await runtime.getRoom(roomId);
  if (!existingRoom) {
    await runtime.createRoom({
      id: roomId,
      name: `TaskForge Room ${userKey}`,
      source: "taskforge-api",
      type: ChannelType.GROUP,
      worldId,
      agentId: runtime.agentId,
    });
  }

  await runtime.ensureParticipantInRoom(entityId, roomId);

  return {
    userKey,
    entityId,
    roomId,
    worldId,
    sourceEntityId,
  };
};

const getOrCreateComponent = async <TData extends Record<string, unknown>>(
  runtime: IAgentRuntime,
  ctx: UserContext,
  type: string,
  defaults: () => TData
): Promise<Component> => {
  const existing = await runtime.getComponent(ctx.entityId, type, ctx.worldId, ctx.sourceEntityId);
  if (existing) {
    return existing;
  }

  const component: Component = {
    id: hashToUuid(`component:${type}:${ctx.entityId}`),
    entityId: ctx.entityId,
    agentId: runtime.agentId,
    roomId: ctx.roomId,
    worldId: ctx.worldId,
    sourceEntityId: ctx.sourceEntityId,
    type,
    createdAt: now(),
    data: defaults(),
  };

  try {
    await runtime.createComponent(component);
    return component;
  } catch (_error) {
    // Parallel requests can race on deterministic IDs. Re-read and continue.
    const raced = await runtime.getComponent(ctx.entityId, type, ctx.worldId, ctx.sourceEntityId);
    if (raced) {
      return raced;
    }
    throw _error;
  }
};

const updateComponentData = async <TData extends Record<string, unknown>>(
  runtime: IAgentRuntime,
  component: Component,
  data: TData
): Promise<Component> => {
  const updated: Component = {
    ...component,
    data: {
      ...data,
      updatedAt: now(),
    },
  };
  await runtime.updateComponent(updated);
  return updated;
};

const getModuleData = async (runtime: IAgentRuntime, ctx: UserContext) => {
  const dashboardComponent = await getOrCreateComponent(runtime, ctx, COMPONENT_TYPES.DASHBOARD, defaultDashboard);
  const emailComponent = await getOrCreateComponent(runtime, ctx, COMPONENT_TYPES.EMAIL, defaultEmails);
  const tasksComponent = await getOrCreateComponent(runtime, ctx, COMPONENT_TYPES.TASKS, defaultTasks);
  const habitsComponent = await getOrCreateComponent(runtime, ctx, COMPONENT_TYPES.HABITS, defaultHabits);
  const knowledgeComponent = await getOrCreateComponent(runtime, ctx, COMPONENT_TYPES.KNOWLEDGE, defaultKnowledge);
  const financeComponent = await getOrCreateComponent(runtime, ctx, COMPONENT_TYPES.FINANCE, defaultFinance);
  const notificationsComponent = await getOrCreateComponent(runtime, ctx, COMPONENT_TYPES.NOTIFICATIONS, defaultNotifications);

  const snapshot = getSnapshotForUser(
    ctx.userKey,
    createSnapshotFromComponents({
      dashboardComponent,
      emailComponent,
      tasksComponent,
      habitsComponent,
      knowledgeComponent,
      financeComponent,
      notificationsComponent,
    })
  );
  dashboardComponent.data = snapshot.dashboard as unknown as Record<string, unknown>;
  emailComponent.data = snapshot.emails as unknown as Record<string, unknown>;
  tasksComponent.data = snapshot.tasks as unknown as Record<string, unknown>;
  habitsComponent.data = snapshot.habits as unknown as Record<string, unknown>;
  knowledgeComponent.data = snapshot.knowledge as unknown as Record<string, unknown>;
  financeComponent.data = snapshot.finance as unknown as Record<string, unknown>;
  notificationsComponent.data = snapshot.notifications as unknown as Record<string, unknown>;

  return {
    dashboardComponent,
    emailComponent,
    tasksComponent,
    habitsComponent,
    knowledgeComponent,
    financeComponent,
    notificationsComponent,
  };
};

const asDashboard = (component: Component): DashboardPayload => component.data as unknown as DashboardPayload;
const asEmails = (component: Component): { items: EmailItem[]; generatedAt: number } => component.data as unknown as { items: EmailItem[]; generatedAt: number };
const asTasks = (component: Component): { items: TaskItem[]; generatedAt: number } => component.data as unknown as { items: TaskItem[]; generatedAt: number };
const asHabits = (component: Component): { items: HabitItem[]; generatedAt: number } => component.data as unknown as { items: HabitItem[]; generatedAt: number };
const asKnowledge = (component: Component): { items: NoteItem[]; generatedAt: number } => component.data as unknown as { items: NoteItem[]; generatedAt: number };
const asFinance = (component: Component): { items: FinanceItem[]; generatedAt: number } => component.data as unknown as { items: FinanceItem[]; generatedAt: number };
const asNotifications = (component: Component): { items: NotificationItem[]; generatedAt: number } => component.data as unknown as { items: NotificationItem[]; generatedAt: number };

const computePriorityOrder = (tasks: TaskItem[]): string[] => {
  return [...tasks]
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    })
    .slice(0, 3)
    .map((task) => task.title);
};

const getSuggestions = (dashboard: DashboardPayload, tasks: TaskItem[], habits: HabitItem[]): string[] => {
  const suggestions: string[] = [];

  const activeSchedule = dashboard.schedule.find((item) => item.status === "active");
  if (activeSchedule) {
    suggestions.push(`Use current focus block on: ${activeSchedule.label} (${activeSchedule.minutes}m).`);
  }

  const topTask = tasks
    .filter((task) => task.status !== "done")
    .sort((a, b) => a.priority - b.priority)[0];
  if (topTask) {
    suggestions.push(`Next critical task: ${topTask.title} before ${new Date(topTask.deadline).toLocaleTimeString()}.`);
  }

  const fragileHabit = habits.sort((a, b) => a.confidence - b.confidence)[0];
  if (fragileHabit) {
    suggestions.push(`Habit watch: ${fragileHabit.name} has ${fragileHabit.confidence}% confidence tomorrow.`);
  }

  return suggestions;
};

const checkModelStatus = async (): Promise<{ ok: boolean; status: string; detail?: string }> => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const base = env?.OPENAI_BASE_URL;
  const key = env?.OPENAI_API_KEY;
  if (!base || !key) {
    return { ok: false, status: "misconfigured", detail: "OPENAI_BASE_URL or OPENAI_API_KEY missing" };
  }

  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/models`, {
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });

    if (response.ok) {
      return { ok: true, status: "available" };
    }

    const frp = response.headers.get("x-frp-service-state");
    if (frp === "loading") {
      return { ok: false, status: "loading", detail: "Endpoint service is still initializing" };
    }

    return { ok: false, status: `http_${response.status}` };
  } catch (error) {
    return {
      ok: false,
      status: "network_error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
};

const buildPlanResult = (text: string): ActionResult => {
  const tasks = extractTasks(text);
  const totalMinutes = extractTotalMinutes(text);
  const blocks = allocateTimeBlocks(tasks, totalMinutes);

  const lines = blocks.map((block) => `${block.order}. ${block.label} (${block.minutes}m)`);
  return {
    success: true,
    text: [
      `Goal: ${parseGoal(text)}`,
      "Plan:",
      ...lines,
      `Next Action: Start with ${blocks[0]?.label ?? "highest impact task"}.`,
    ].join("\n"),
    values: {
      intent: "plan",
      totalMinutes,
      taskCount: tasks.length,
    },
    data: {
      route: "plan",
      blocks,
    },
  };
};

const buildReprioritizeResult = (text: string): ActionResult => {
  const tasks = extractTasks(text);
  const sorted = [...tasks].sort((a, b) => b.length - a.length).slice(0, 3);

  return {
    success: true,
    text: [
      "Goal: Adjust priorities around the new constraint",
      "Updated Priorities:",
      ...sorted.map((task, idx) => `${idx + 1}. ${task}`),
      `Next Action: Start priority #1 (${sorted[0] ?? "highest impact task"}) for 25 minutes.`,
    ].join("\n"),
    values: {
      intent: "reprioritize",
      updatedCount: sorted.length,
    },
    data: {
      route: "reprioritize",
      updatedPriorities: sorted,
    },
  };
};

const buildReminderResult = (text: string): ActionResult => {
  const tasks = extractTasks(text).slice(0, 2);
  const reminders = tasks.map((task, idx) => `Reminder ${idx + 1}: ${task}. Keep it concise and ship.`);

  return {
    success: true,
    text: [
      "Goal: Produce message-ready reminders",
      ...reminders,
      "Suggested Time: 15 minutes before start time",
      "Next Action: Copy and send one reminder now.",
    ].join("\n"),
    values: {
      intent: "reminder",
      reminderCount: reminders.length,
    },
    data: {
      route: "reminder",
      reminders,
    },
  };
};

const routeAndBuildResult = (text: string, fallback: RouteIntent): ActionResult => {
  const routedIntent = routeIntent(text, fallback);
  if (routedIntent === "reprioritize") return buildReprioritizeResult(text);
  if (routedIntent === "reminder") return buildReminderResult(text);
  return buildPlanResult(text);
};

const buildDailyPlanAction: Action = {
  name: "BUILD_DAILY_PLAN",
  description: "Trigger when the user asks for a day plan, schedule, or time-blocked task breakdown.",
  similes: ["PLAN_DAY", "SCHEDULE_DAY", "TIME_BLOCK_PLAN"],
  validate: async (_runtime, message) => hasContent(message),
  handler: async (_runtime, message) => routeAndBuildResult(getText(message), "plan"),
};

const reprioritizeTasksAction: Action = {
  name: "REPRIORITIZE_TASKS",
  description: "Trigger when deadlines change or the user asks to reorder work by urgency and impact.",
  similes: ["REORDER_TASKS", "REPLAN_DAY", "SHIFT_PRIORITIES"],
  validate: async (_runtime, message) => hasContent(message),
  handler: async (_runtime, message) => routeAndBuildResult(getText(message), "reprioritize"),
};

const draftReminderAction: Action = {
  name: "DRAFT_REMINDER",
  description: "Trigger when the user wants reminder text for follow-ups, meetings, or deadlines.",
  similes: ["MAKE_REMINDER", "WRITE_REMINDER", "REMINDER_TEXT"],
  validate: async (_runtime, message) => hasContent(message),
  handler: async (_runtime, message) => routeAndBuildResult(getText(message), "reminder"),
};

const getTodayDashboardAction: Action = {
  name: "GET_TODAY_DASHBOARD",
  description: "Returns today's schedule, priorities, and productivity insights from persistent data.",
  similes: ["TODAY_OVERVIEW", "DASHBOARD_STATUS"],
  validate: async (_runtime, message) => hasContent(message),
  handler: async (runtime, message) => {
    const userKey = getUserKeyFromMemory(message);
    const ctx = await ensureUserContext(runtime, userKey);
    const { dashboardComponent } = await getModuleData(runtime, ctx);
    const dashboard = asDashboard(dashboardComponent);
    return {
      success: true,
      text: [
        "Today's Dashboard:",
        ...dashboard.schedule.map((item) => `${item.order}. ${item.label} (${item.minutes}m)`),
        `Top Priority: ${dashboard.priorities[0] ?? "N/A"}`,
      ].join("\n"),
      data: dashboard,
    };
  },
};

const generatePrioritiesAction: Action = {
  name: "GENERATE_PRIORITIES",
  description: "Ranks task priorities using urgency and explicit priority metadata.",
  similes: ["PRIORITY_RANK", "TASK_PRIORITY"],
  validate: async (_runtime, message) => hasContent(message),
  handler: async (runtime, message) => {
    const userKey = getUserKeyFromMemory(message);
    const ctx = await ensureUserContext(runtime, userKey);
    const { tasksComponent } = await getModuleData(runtime, ctx);
    const taskData = asTasks(tasksComponent);
    const priorities = computePriorityOrder(taskData.items);

    return {
      success: true,
      text: ["Generated Priorities:", ...priorities.map((p, i) => `${i + 1}. ${p}`)].join("\n"),
      data: { priorities, generatedAt: now() },
    };
  },
};

const suggestNextTaskAction: Action = {
  name: "SUGGEST_NEXT_TASK",
  description: "Recommends the next best task using schedule gaps and deadlines.",
  similes: ["NEXT_TASK", "WHAT_NOW"],
  validate: async (_runtime, message) => hasContent(message),
  handler: async (runtime, message) => {
    const userKey = getUserKeyFromMemory(message);
    const ctx = await ensureUserContext(runtime, userKey);
    const { dashboardComponent, tasksComponent, habitsComponent } = await getModuleData(runtime, ctx);

    const suggestions = getSuggestions(
      asDashboard(dashboardComponent),
      asTasks(tasksComponent).items,
      asHabits(habitsComponent).items
    );

    return {
      success: true,
      text: ["Recommendation:", suggestions[0] ?? "No recommendation available"].join("\n"),
      data: { suggestions },
    };
  },
};

const emailSummarizeAction: Action = {
  name: "EMAIL_SUMMARIZE",
  description: "Summarizes categorized emails and suggested replies.",
  similes: ["EMAIL_BRIEF", "INBOX_SUMMARY"],
  validate: async (_runtime, message) => hasContent(message),
  handler: async (runtime, message) => {
    const userKey = getUserKeyFromMemory(message);
    const ctx = await ensureUserContext(runtime, userKey);
    const { emailComponent } = await getModuleData(runtime, ctx);
    const emails = asEmails(emailComponent).items;

    const grouped = {
      Work: emails.filter((item) => item.category === "Work").length,
      Personal: emails.filter((item) => item.category === "Personal").length,
      Urgent: emails.filter((item) => item.category === "Urgent").length,
    };

    return {
      success: true,
      text: `Inbox Summary -> Work: ${grouped.Work}, Personal: ${grouped.Personal}, Urgent: ${grouped.Urgent}`,
      data: { grouped, emails },
    };
  },
};

const habitPredictAction: Action = {
  name: "HABIT_PREDICT",
  description: "Predicts habit streak continuity and risk.",
  similes: ["HABIT_FORECAST", "STREAK_PREDICT"],
  validate: async (_runtime, message) => hasContent(message),
  handler: async (runtime, message) => {
    const userKey = getUserKeyFromMemory(message);
    const ctx = await ensureUserContext(runtime, userKey);
    const { habitsComponent } = await getModuleData(runtime, ctx);
    const habits = asHabits(habitsComponent).items;

    const risk = [...habits].sort((a, b) => a.confidence - b.confidence)[0];
    return {
      success: true,
      text: `Habit Prediction: ${risk.name} has highest risk at ${risk.confidence}% confidence tomorrow.`,
      data: { habits, atRiskHabit: risk },
    };
  },
};

const routes: Route[] = [
  {
    type: "GET",
    path: "/system-status",
    public: true,
    handler: async (_req, res) => {
      const model = await checkModelStatus();
      sendJson(res, 200, {
        success: true,
        data: {
          model,
          timestamp: now(),
        },
      });
    },
  },
  {
    type: "GET",
    path: "/dashboard",
    name: "TaskForge Dashboard",
    public: true,
    handler: async (req, res, runtime) => {
      const userKey = getUserKeyFromRequest(req.query);
      const ctx = await ensureUserContext(runtime, userKey);
      const { dashboardComponent, notificationsComponent, tasksComponent, habitsComponent } = await getModuleData(runtime, ctx);
      const dashboard = asDashboard(dashboardComponent);
      const tasks = asTasks(tasksComponent).items;
      const habits = asHabits(habitsComponent).items;
      const suggestions = getSuggestions(dashboard, tasks, habits);

      sendJson(res, 200, {
        success: true,
        data: {
          dashboard,
          notifications: asNotifications(notificationsComponent),
          suggestions,
          stableIds: {
            userId: ctx.entityId,
            roomId: ctx.roomId,
            worldId: ctx.worldId,
          },
        },
      });
    },
  },
  {
    type: "GET",
    path: "/email",
    public: true,
    handler: async (req, res, runtime) => {
      const userKey = getUserKeyFromRequest(req.query);
      const ctx = await ensureUserContext(runtime, userKey);
      const { emailComponent } = await getModuleData(runtime, ctx);
      sendJson(res, 200, { success: true, data: asEmails(emailComponent) });
    },
  },
  {
    type: "POST",
    path: "/email",
    public: true,
    handler: async (req, res, runtime) => {
      const body = parseJsonBody(req.body);
      const userKey = getUserKeyFromRequest(req.query, body);

      const categoryRaw = typeof body.category === "string" ? body.category.trim() : "";
      const category = categoryRaw === "Personal" || categoryRaw === "Urgent" ? categoryRaw : "Work";
      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      const summary = typeof body.summary === "string" ? body.summary.trim() : "";
      const suggestedReply = typeof body.suggestedReply === "string" ? body.suggestedReply.trim() : "";

      if (!subject || !summary || !suggestedReply) {
        return sendJson(res, 400, {
          success: false,
          error: "subject, summary and suggestedReply are required",
        });
      }

      const ctx = await ensureUserContext(runtime, userKey);
      const { emailComponent } = await getModuleData(runtime, ctx);
      const emailData = asEmails(emailComponent);

      const newItem: EmailItem = {
        id: randomUuid(),
        category,
        subject,
        summary,
        suggestedReply,
        timestamp: now(),
      };

      const updatedEmailData = {
        generatedAt: now(),
        items: [newItem, ...emailData.items],
      };

      await updateComponentData(runtime, emailComponent, updatedEmailData);
      patchSnapshotForUser(userKey, {
        emails: updatedEmailData,
      });

      sendJson(res, 201, {
        success: true,
        data: updatedEmailData,
        created: newItem,
      });
    },
  },
  {
    type: "GET",
    path: "/gmail/status",
    public: true,
    handler: async (_req, res) => {
      sendJson(res, 200, {
        success: true,
        data: {
          configured: hasGmailAuthConfigured(),
          usingRefreshFlow: hasGmailRefreshConfig(),
          user: getGmailUser(),
          generatedAt: now(),
        },
      });
    },
  },
  {
    type: "GET",
    path: "/gmail/profile",
    public: true,
    handler: async (_req, res) => {
      try {
        const profile = await gmailRequest<{
          emailAddress?: string;
          messagesTotal?: number;
          threadsTotal?: number;
          historyId?: string;
        }>("/profile");

        sendJson(res, 200, {
          success: true,
          data: {
            profile,
            generatedAt: now(),
          },
        });
      } catch (error) {
        sendJson(res, 400, {
          success: false,
          error: error instanceof Error ? error.message : "Unable to fetch Gmail profile",
        });
      }
    },
  },
  {
    type: "GET",
    path: "/gmail/unread",
    public: true,
    handler: async (req, res) => {
      try {
        const max = Number.parseInt(typeof req.query?.maxResults === "string" ? req.query.maxResults : "10", 10);
        const maxResults = Number.isFinite(max) ? Math.min(Math.max(max, 1), 25) : 10;

        const result = await gmailRequest<{
          resultSizeEstimate?: number;
          messages?: Array<{ id?: string; threadId?: string }>;
        }>(`/messages?q=is:unread&maxResults=${maxResults}`);

        sendJson(res, 200, {
          success: true,
          data: {
            unreadCountEstimate: result.resultSizeEstimate || 0,
            messages: result.messages || [],
            generatedAt: now(),
          },
        });
      } catch (error) {
        sendJson(res, 400, {
          success: false,
          error: error instanceof Error ? error.message : "Unable to fetch unread emails",
        });
      }
    },
  },
  {
    type: "GET",
    path: "/gmail/classify-latest",
    public: true,
    handler: async (req, res) => {
      try {
        const max = Number.parseInt(typeof req.query?.maxResults === "string" ? req.query.maxResults : "10", 10);
        const maxResults = Number.isFinite(max) ? Math.min(Math.max(max, 1), 15) : 10;

        const { unreadCountEstimate, items: details } = await fetchUnreadMessageDetails(maxResults);

        const counts = details.reduce<Record<string, number>>((acc, item) => {
          acc[item.category] = (acc[item.category] || 0) + 1;
          return acc;
        }, {});

        sendJson(res, 200, {
          success: true,
          data: {
            unreadCountEstimate,
            categories: counts,
            interviewCount: counts.Interview || 0,
            items: details,
            generatedAt: now(),
          },
        });
      } catch (error) {
        sendJson(res, 400, {
          success: false,
          error: error instanceof Error ? error.message : "Unable to classify latest unread emails",
        });
      }
    },
  },
  {
    type: "GET",
    path: "/gmail/summary",
    public: true,
    handler: async (req, res) => {
      try {
        const max = Number.parseInt(typeof req.query?.maxResults === "string" ? req.query.maxResults : "12", 10);
        const maxResults = Number.isFinite(max) ? Math.min(Math.max(max, 1), 20) : 12;

        const { unreadCountEstimate, items } = await fetchUnreadMessageDetails(maxResults);
        const counts = items.reduce<Record<string, number>>((acc, item) => {
          acc[item.category] = (acc[item.category] || 0) + 1;
          return acc;
        }, {});

        const meetingCandidates = items.filter((item) => item.hasMeetingSignals);
        const summaryData = buildInboxNarrativeSummary(items);

        sendJson(res, 200, {
          success: true,
          data: {
            unreadCountEstimate,
            totalAnalyzed: items.length,
            categoryCounts: counts,
            meetingCandidates: meetingCandidates.length,
            summary: summaryData.summary,
            actionItems: summaryData.actionItems,
            items,
            generatedAt: now(),
          },
        });
      } catch (error) {
        sendJson(res, 400, {
          success: false,
          error: error instanceof Error ? error.message : "Unable to summarize inbox",
        });
      }
    },
  },
  {
    type: "POST",
    path: "/gmail/sync-meetings",
    public: true,
    handler: async (req, res) => {
      try {
        const body = parseJsonBody(req.body);
        const max = Number.parseInt(
          typeof body.maxResults === "number"
            ? String(body.maxResults)
            : typeof req.query?.maxResults === "string"
              ? req.query.maxResults
              : "15",
          10
        );
        const maxResults = Number.isFinite(max) ? Math.min(Math.max(max, 1), 25) : 15;

        const { items } = await fetchUnreadMessageDetails(maxResults);
        const candidates = items.filter((item) => item.hasMeetingSignals);

        const added: Array<{ id: string; subject: string; eventId?: string; eventLink?: string }> = [];
        const skipped: Array<{ id: string; subject: string; reason: string }> = [];
        const failed: Array<{ id: string; subject: string; reason: string }> = [];

        for (const candidate of candidates) {
          const quickAddText = buildQuickAddTextForMeeting(candidate);
          if (!quickAddText) {
            skipped.push({
              id: candidate.id || randomUuid(),
              subject: candidate.subject,
              reason: "No recognizable date/time in email snippet",
            });
            continue;
          }

          try {
            const event = await calendarRequest<{ id?: string; htmlLink?: string }>(
              `/calendars/primary/events/quickAdd?text=${encodeURIComponent(quickAddText)}`,
              "POST"
            );

            if (event.id) {
              await calendarRequest(`/calendars/primary/events/${event.id}`, "PATCH", {
                reminders: {
                  useDefault: false,
                  overrides: [
                    { method: "email", minutes: 30 },
                    { method: "popup", minutes: 10 },
                  ],
                },
              });
            }

            added.push({
              id: candidate.id || randomUuid(),
              subject: candidate.subject,
              eventId: event.id,
              eventLink: event.htmlLink,
            });
          } catch (error) {
            failed.push({
              id: candidate.id || randomUuid(),
              subject: candidate.subject,
              reason: error instanceof Error ? error.message : "Calendar sync failed",
            });
          }
        }

        sendJson(res, 200, {
          success: true,
          data: {
            analyzed: items.length,
            meetingCandidates: candidates.length,
            added,
            skipped,
            failed,
            reminderPolicy: "Email 30m + popup 10m",
            generatedAt: now(),
          },
        });
      } catch (error) {
        sendJson(res, 400, {
          success: false,
          error: error instanceof Error ? error.message : "Unable to sync meetings to Google Calendar",
        });
      }
    },
  },
  {
    type: "POST",
    path: "/gmail/drafts",
    public: true,
    handler: async (req, res, runtime) => {
      const body = parseJsonBody(req.body);
      const userKey = getUserKeyFromRequest(req.query, body);
      const to = typeof body.to === "string" ? body.to.trim() : "";
      const subject = typeof body.subject === "string" ? body.subject.trim() : "TaskForge draft";
      const content = typeof body.body === "string" ? body.body.trim() : "";

      if (!to || !content) {
        return sendJson(res, 400, { success: false, error: "to and body are required" });
      }

      try {
        const draftResponse = await gmailRequest<{ id?: string; message?: { id?: string } }>("/drafts", "POST", {
          message: { raw: encodeEmailRFC822(to, subject, content) },
        });

        const ctx = await ensureUserContext(runtime, userKey);
        const { emailComponent } = await getModuleData(runtime, ctx);
        const emailData = asEmails(emailComponent);

        const emailItem: EmailItem = {
          id: randomUuid(),
          category: "Work",
          subject,
          summary: `Draft prepared for ${to}`,
          suggestedReply: content,
          timestamp: now(),
        };

        const updatedEmailData = {
          generatedAt: now(),
          items: [emailItem, ...emailData.items],
        };

        await updateComponentData(runtime, emailComponent, updatedEmailData);
        patchSnapshotForUser(userKey, { emails: updatedEmailData });

        sendJson(res, 201, {
          success: true,
          data: {
            draftId: draftResponse.id,
            messageId: draftResponse.message?.id,
            email: emailItem,
            generatedAt: now(),
          },
        });
      } catch (error) {
        sendJson(res, 400, {
          success: false,
          error: error instanceof Error ? error.message : "Unable to create Gmail draft",
        });
      }
    },
  },
  {
    type: "POST",
    path: "/gmail/send",
    public: true,
    handler: async (req, res) => {
      const body = parseJsonBody(req.body);
      const to = typeof body.to === "string" ? body.to.trim() : "";
      const subject = typeof body.subject === "string" ? body.subject.trim() : "TaskForge message";
      const content = typeof body.body === "string" ? body.body.trim() : "";

      if (!to || !content) {
        return sendJson(res, 400, { success: false, error: "to and body are required" });
      }

      try {
        const result = await gmailRequest<{ id?: string; threadId?: string }>("/messages/send", "POST", {
          raw: encodeEmailRFC822(to, subject, content),
        });

        sendJson(res, 200, {
          success: true,
          data: {
            sent: true,
            messageId: result.id,
            threadId: result.threadId,
            generatedAt: now(),
          },
        });
      } catch (error) {
        sendJson(res, 400, {
          success: false,
          error: error instanceof Error ? error.message : "Unable to send Gmail message",
        });
      }
    },
  },
  {
    type: "GET",
    path: "/tasks",
    public: true,
    handler: async (req, res, runtime) => {
      const userKey = getUserKeyFromRequest(req.query);
      const ctx = await ensureUserContext(runtime, userKey);
      const { tasksComponent } = await getModuleData(runtime, ctx);
      sendJson(res, 200, { success: true, data: asTasks(tasksComponent) });
    },
  },
  {
    type: "POST",
    path: "/tasks",
    public: true,
    handler: async (req, res, runtime) => {
      const body = parseJsonBody(req.body);
      const userKey = getUserKeyFromRequest(req.query, body);
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        return sendJson(res, 400, { success: false, error: "title is required" });
      }

      const status = body.status === "doing" || body.status === "done" ? body.status : "todo";
      const priority = body.priority === 1 || body.priority === 2 ? body.priority : 3;
      const deadline =
        typeof body.deadline === "string" && body.deadline.trim().length > 0
          ? body.deadline
          : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const ctx = await ensureUserContext(runtime, userKey);
      const { tasksComponent } = await getModuleData(runtime, ctx);
      const tasksData = asTasks(tasksComponent);

      const newTask: TaskItem = {
        id: randomUuid(),
        title,
        status,
        deadline,
        priority,
        createdAt: now(),
      };

      const updatedData = {
        ...tasksData,
        generatedAt: now(),
        items: [newTask, ...tasksData.items],
      };

      const updatedComponent = await updateComponentData(runtime, tasksComponent, updatedData);
      patchSnapshotForUser(userKey, { tasks: updatedData });
      sendJson(res, 201, { success: true, data: asTasks(updatedComponent), created: newTask });
    },
  },
  {
    type: "GET",
    path: "/habits",
    public: true,
    handler: async (req, res, runtime) => {
      const userKey = getUserKeyFromRequest(req.query);
      const ctx = await ensureUserContext(runtime, userKey);
      const { habitsComponent } = await getModuleData(runtime, ctx);
      sendJson(res, 200, { success: true, data: asHabits(habitsComponent) });
    },
  },
  {
    type: "GET",
    path: "/knowledge",
    public: true,
    handler: async (req, res, runtime) => {
      const userKey = getUserKeyFromRequest(req.query);
      const q = typeof req.query?.q === "string" ? req.query.q.trim().toLowerCase() : "";
      const ctx = await ensureUserContext(runtime, userKey);
      const { knowledgeComponent } = await getModuleData(runtime, ctx);
      const data = asKnowledge(knowledgeComponent);
      const items = q
        ? data.items.filter((item) => `${item.title} ${item.summary} ${item.tags.join(" ")}`.toLowerCase().includes(q))
        : data.items;
      sendJson(res, 200, { success: true, data: { ...data, items } });
    },
  },
  {
    type: "GET",
    path: "/finance",
    public: true,
    handler: async (req, res, runtime) => {
      const userKey = getUserKeyFromRequest(req.query);
      const ctx = await ensureUserContext(runtime, userKey);
      const { financeComponent } = await getModuleData(runtime, ctx);
      const data = asFinance(financeComponent);

      const categoryTotals = data.items.reduce<Record<string, number>>((acc, item) => {
        acc[item.category] = (acc[item.category] || 0) + item.amount;
        return acc;
      }, {});

      sendJson(res, 200, {
        success: true,
        data: {
          ...data,
          categoryTotals,
          insight: "Leisure spend is above baseline by 12% this month.",
        },
      });
    },
  },
  {
    type: "GET",
    path: "/notifications",
    public: true,
    handler: async (req, res, runtime) => {
      const userKey = getUserKeyFromRequest(req.query);
      const ctx = await ensureUserContext(runtime, userKey);
      const { notificationsComponent } = await getModuleData(runtime, ctx);
      sendJson(res, 200, { success: true, data: asNotifications(notificationsComponent) });
    },
  },
  {
    type: "POST",
    path: "/assistant",
    public: true,
    handler: async (req, res, runtime) => {
      const body = parseJsonBody(req.body);
      const userKey = getUserKeyFromRequest(req.query, body);
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

      if (!prompt) {
        return sendJson(res, 400, { success: false, error: "prompt is required" });
      }

      const ctx = await ensureUserContext(runtime, userKey);
      const { dashboardComponent, tasksComponent, habitsComponent, notificationsComponent, emailComponent } =
        await getModuleData(runtime, ctx);

      const command = parseAssistantCommand(prompt);

      if (command.type === "add_habit") {
        const currentHabits = asHabits(habitsComponent);
        const alreadyExists = currentHabits.items.some(
          (habit) => habit.name.toLowerCase() === command.habitName.toLowerCase()
        );

        let replyText = "";
        let updatedHabits = currentHabits;

        if (alreadyExists) {
          replyText = `Habit \"${command.habitName}\" already exists. I kept it as-is.`;
        } else {
          const newHabit: HabitItem = {
            id: randomUuid(),
            name: command.habitName,
            streak: 0,
            confidence: 70,
            heatmap: Array.from({ length: 35 }, () => 0),
            updatedAt: now(),
          };

          updatedHabits = {
            generatedAt: now(),
            items: [newHabit, ...currentHabits.items],
          };

          await updateComponentData(runtime, habitsComponent, updatedHabits);
          patchSnapshotForUser(userKey, {
            habits: updatedHabits,
          });

          replyText = `Done. I added the habit \"${command.habitName}\". You can now track it in the Habits tab.`;
        }

        const suggestions = [`Track \"${command.habitName}\" daily to build streak momentum.`];

        return sendJson(res, 200, {
          success: true,
          data: {
            reply: replyText,
            intent: "add_habit",
            suggestions,
            moduleSnapshot: {
              habits: updatedHabits,
            },
            generatedAt: now(),
          },
        });
      }

      if (command.type === "clear_schedule") {
        const currentDashboard = asDashboard(dashboardComponent);
        const updatedDashboard: DashboardPayload = {
          ...currentDashboard,
          generatedAt: now(),
          schedule: [],
          productivityInsight: "Schedule cleared. Ask me to create a new plan anytime.",
        };

        await updateComponentData(runtime, dashboardComponent, updatedDashboard);
        patchSnapshotForUser(userKey, {
          dashboard: updatedDashboard,
        });

        return sendJson(res, 200, {
          success: true,
          data: {
            reply: "Done. I cleared your schedule. Want me to build a fresh plan for today?",
            intent: "clear_schedule",
            suggestions: ["Try: 'Plan 2 hours for coding, email, and workout'."],
            moduleSnapshot: {
              dashboard: updatedDashboard,
            },
            generatedAt: now(),
          },
        });
      }

      if (command.type === "add_notification") {
        const currentNotifications = asNotifications(notificationsComponent);
        const notification: NotificationItem = {
          id: randomUuid(),
          message: command.message,
          level: "info",
          createdAt: now(),
        };

        const updatedNotifications = {
          generatedAt: now(),
          items: [notification, ...currentNotifications.items].slice(0, 12),
        };

        await updateComponentData(runtime, notificationsComponent, updatedNotifications);
        patchSnapshotForUser(userKey, {
          notifications: updatedNotifications,
        });

        return sendJson(res, 200, {
          success: true,
          data: {
            reply: `Done. I added a notification: "${command.message}".`,
            intent: "add_notification",
            suggestions: ["You can also say: remind me 30 minutes before the deadline."],
            moduleSnapshot: {
              notifications: updatedNotifications,
            },
            generatedAt: now(),
          },
        });
      }

      if (command.type === "add_email_draft") {
        const emailData = asEmails(emailComponent);
        const recipient = command.recipient || "recipient@example.com";

        const emailItem: EmailItem = {
          id: randomUuid(),
          category: "Work",
          subject: command.subject,
          summary: `Draft prepared for ${recipient}`,
          suggestedReply: command.body,
          timestamp: now(),
        };

        const updatedEmails = {
          generatedAt: now(),
          items: [emailItem, ...emailData.items],
        };

        await updateComponentData(runtime, emailComponent, updatedEmails);
        patchSnapshotForUser(userKey, {
          emails: updatedEmails,
        });

        let gmailDraftStatus = "Saved to TaskForge Email tab.";
        if (command.recipient && hasGmailAuthConfigured()) {
          try {
            await gmailRequest("/drafts", "POST", {
              message: { raw: encodeEmailRFC822(command.recipient, command.subject, command.body) },
            });
            gmailDraftStatus = "Saved to TaskForge and Gmail drafts.";
          } catch {
            gmailDraftStatus = "Saved to TaskForge; Gmail draft failed, please check token/scopes.";
          }
        }

        return sendJson(res, 200, {
          success: true,
          data: {
            reply: `Draft ready for ${recipient}. ${gmailDraftStatus}`,
            intent: "add_email_draft",
            suggestions: [
              "Include 'subject: ...' in your prompt for custom subject lines.",
              "Add a recipient email in the prompt to push to Gmail draft automatically.",
            ],
            moduleSnapshot: {
              emails: updatedEmails,
            },
            generatedAt: now(),
          },
        });
      }

      const actionResult = routeAndBuildResult(prompt, "plan");
      const intent = actionResult.values?.intent as RouteIntent;

      let nextDashboard = asDashboard(dashboardComponent);
      let nextTasks = asTasks(tasksComponent);
      let nextNotifications = asNotifications(notificationsComponent);

      if (intent === "plan") {
        const blocks = ((actionResult.data as { blocks?: PlanBlock[] } | undefined)?.blocks || []).map((block, index) => ({
          ...block,
          status: index === 0 ? ("active" as const) : ("upcoming" as const),
        }));
        const labels = blocks.filter((block) => !/buffer and review/i.test(block.label)).map((block) => block.label);

        nextDashboard = {
          generatedAt: now(),
          schedule: blocks,
          priorities: labels.slice(0, 3),
          productivityInsight: `Execution plan generated from your latest request at ${new Date().toLocaleTimeString()}.`,
        };

        const generatedTasks = labels.map((label, index) => taskFromLabel(label, index));
        nextTasks = {
          generatedAt: now(),
          items: generatedTasks,
        };

        await Promise.all([
          updateComponentData(runtime, dashboardComponent, nextDashboard),
          updateComponentData(runtime, tasksComponent, nextTasks),
        ]);
        patchSnapshotForUser(userKey, {
          dashboard: nextDashboard,
          tasks: nextTasks,
        });
      }

      if (intent === "reprioritize") {
        const updatedPriorities = ((actionResult.data as { updatedPriorities?: string[] } | undefined)?.updatedPriorities || []).slice(0, 3);
        const current = asTasks(tasksComponent);

        const reprioritized = updatedPriorities.map((title, index) => {
          const existing = current.items.find((item) => item.title.toLowerCase() === title.toLowerCase());
          return {
            ...(existing || taskFromLabel(title, index)),
            title,
            priority: toPriority(index),
            status: index === 0 ? ("doing" as const) : ("todo" as const),
          };
        });

        nextTasks = {
          generatedAt: now(),
          items: reprioritized,
        };

        nextDashboard = {
          ...asDashboard(dashboardComponent),
          generatedAt: now(),
          priorities: updatedPriorities,
          productivityInsight: "Priorities were updated based on your latest constraint change.",
        };

        await Promise.all([
          updateComponentData(runtime, tasksComponent, nextTasks),
          updateComponentData(runtime, dashboardComponent, nextDashboard),
        ]);
        patchSnapshotForUser(userKey, {
          dashboard: nextDashboard,
          tasks: nextTasks,
        });
      }

      if (intent === "reminder") {
        const reminders = ((actionResult.data as { reminders?: string[] } | undefined)?.reminders || []).slice(0, 3);
        const reminderItems: NotificationItem[] = reminders.map((message, index) => ({
          id: randomUuid(),
          message,
          level: index === 0 ? "warning" : "info",
          createdAt: now(),
        }));

        const currentNotifications = asNotifications(notificationsComponent);
        nextNotifications = {
          generatedAt: now(),
          items: [...reminderItems, ...currentNotifications.items].slice(0, 12),
        };

        await updateComponentData(runtime, notificationsComponent, nextNotifications);
        patchSnapshotForUser(userKey, {
          notifications: nextNotifications,
        });
      }

      const suggestionBundle = getSuggestions(
        nextDashboard,
        nextTasks.items,
        asHabits(habitsComponent).items
      );

      sendJson(res, 200, {
        success: true,
        data: {
          reply: actionResult.text,
          intent,
          suggestions: suggestionBundle,
          moduleSnapshot: {
            dashboard: nextDashboard,
            tasks: nextTasks,
            notifications: nextNotifications,
          },
          generatedAt: now(),
        },
      });
    },
  },
  {
    type: "GET",
    path: "/recommendations",
    public: true,
    handler: async (req, res, runtime) => {
      const userKey = getUserKeyFromRequest(req.query);
      const ctx = await ensureUserContext(runtime, userKey);
      const { dashboardComponent, tasksComponent, habitsComponent } = await getModuleData(runtime, ctx);
      const suggestions = getSuggestions(
        asDashboard(dashboardComponent),
        asTasks(tasksComponent).items,
        asHabits(habitsComponent).items
      );
      sendJson(res, 200, { success: true, data: { suggestions, generatedAt: now() } });
    },
  },
];

export const customPlugin: Plugin = {
  name: "taskforge",
  description: "TaskForge APIs, orchestration actions, and planning/reminder skills",
  componentTypes: [
    { name: COMPONENT_TYPES.DASHBOARD, schema: {} },
    { name: COMPONENT_TYPES.EMAIL, schema: {} },
    { name: COMPONENT_TYPES.TASKS, schema: {} },
    { name: COMPONENT_TYPES.HABITS, schema: {} },
    { name: COMPONENT_TYPES.KNOWLEDGE, schema: {} },
    { name: COMPONENT_TYPES.FINANCE, schema: {} },
    { name: COMPONENT_TYPES.NOTIFICATIONS, schema: {} },
  ],
  actions: [
    buildDailyPlanAction,
    reprioritizeTasksAction,
    draftReminderAction,
    getTodayDashboardAction,
    generatePrioritiesAction,
    suggestNextTaskAction,
    emailSummarizeAction,
    habitPredictAction,
  ],
  providers: [],
  evaluators: [],
  routes,
};

export default customPlugin;
