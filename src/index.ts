/**
 * Custom Plugin Entry Point
 *
 * This file is where you can define custom actions, providers, and evaluators
 * for your ElizaOS agent. Add your logic here and reference this plugin in
 * your character file.
 *
 * ElizaOS Plugin Docs: https://elizaos.github.io/eliza/docs/core/plugins
 */

import type { Action, ActionResult, Memory, Plugin } from "@elizaos/core";

type RouteIntent = "plan" | "reprioritize" | "reminder";

type PlanBlock = {
  label: string;
  minutes: number;
  order: number;
};

type PlanPayload = {
  goal: string;
  blocks: PlanBlock[];
  nextAction: string;
};

type ReprioritizePayload = {
  changeSummary: string;
  updatedPriorities: string[];
  deferredTask?: string;
  nextAction: string;
};

type ReminderPayload = {
  messages: string[];
  suggestedTime: string;
  nextAction: string;
};

const hasContent = (message: Memory): boolean => {
  const text = message?.content?.text;
  return typeof text === "string" && text.trim().length > 0;
};

const getText = (message: Memory): string => {
  return typeof message.content?.text === "string" ? message.content.text : "";
};

const normalizeTaskText = (task: string): string => {
  const normalized = task.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Untitled task";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const extractTasks = (text: string): string[] => {
  const cleaned = text
    .replace(/\?/g, "")
    .replace(/\b(build|create|make|draft|please|quickly|today|now)\b/gi, "")
    .trim();

  const candidate = cleaned
    .replace(/\b(i have|i need to|need to|reprioritize|my day|my tasks|for me)\b/gi, "")
    .trim();

  const parts = candidate
    .split(/,|\band\b|\bthen\b/gi)
    .map((item) => normalizeTaskText(item));

  const unique = Array.from(new Set(parts.filter((item) => item.length >= 4)));
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

  if (total >= 30) {
    return total;
  }

  return 180;
};

const allocateTimeBlocks = (tasks: string[], totalMinutes: number): PlanBlock[] => {
  const blockCount = Math.max(tasks.length, 1);
  const reserve = 15;
  const allocatable = Math.max(totalMinutes - reserve, 45);
  const base = Math.floor(allocatable / blockCount);
  let remainder = allocatable - base * blockCount;

  const blocks: PlanBlock[] = tasks.map((task, index) => {
    const priorityBoost = index === 0 ? 10 : 0;
    const remainderBoost = remainder > 0 ? 5 : 0;
    if (remainder > 0) {
      remainder -= 5;
    }

    return {
      label: task,
      minutes: Math.max(base + priorityBoost + remainderBoost, 20),
      order: index + 1,
    };
  });

  blocks.push({
    label: "Buffer and review",
    minutes: reserve,
    order: blocks.length + 1,
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

const RESPONSE_TEMPLATES = {
  plan: (payload: PlanPayload): string => {
    const lines = payload.blocks.map(
      (block) => `${block.order}. ${block.label} (${block.minutes}m)`
    );
    return [
      `Goal: ${payload.goal}`,
      "Plan:",
      ...lines,
      `Next Action: ${payload.nextAction}`,
    ].join("\n");
  },
  reprioritize: (payload: ReprioritizePayload): string => {
    const priorityLines = payload.updatedPriorities.map((task, idx) => `${idx + 1}. ${task}`);
    const deferred = payload.deferredTask ? `Deferred: ${payload.deferredTask}` : "";
    return [
      `Goal: ${payload.changeSummary}`,
      "Updated Priorities:",
      ...priorityLines,
      deferred,
      `Next Action: ${payload.nextAction}`,
    ]
      .filter(Boolean)
      .join("\n");
  },
  reminder: (payload: ReminderPayload): string => {
    const reminderLines = payload.messages.map((message, idx) => `Reminder ${idx + 1}: ${message}`);
    return [
      "Goal: Produce message-ready reminders",
      ...reminderLines,
      `Suggested Time: ${payload.suggestedTime}`,
      `Next Action: ${payload.nextAction}`,
    ].join("\n");
  },
};

const parseGoal = (text: string): string => {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "Create a realistic day plan";
  }

  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
};

const buildPlanResult = (text: string): ActionResult => {
  const tasks = extractTasks(text);
  const totalMinutes = extractTotalMinutes(text);
  const blocks = allocateTimeBlocks(tasks, totalMinutes);
  const payload: PlanPayload = {
    goal: parseGoal(text),
    blocks,
    nextAction: `Start with: ${blocks[0]?.label ?? "highest impact task"}`,
  };

  return {
    success: true,
    text: RESPONSE_TEMPLATES.plan(payload),
    values: {
      intent: "plan",
      totalMinutes,
      taskCount: tasks.length,
    },
    data: {
      route: "plan",
      payload,
    },
  };
};

const buildReprioritizeResult = (text: string): ActionResult => {
  const tasks = extractTasks(text);
  const sorted = [...tasks].sort((a, b) => b.length - a.length);
  const top = sorted.slice(0, 3);
  const deferred = sorted.length > 3 ? sorted[sorted.length - 1] : undefined;

  const payload: ReprioritizePayload = {
    changeSummary: "Adjust priorities around the new constraint",
    updatedPriorities: top,
    deferredTask: deferred,
    nextAction: `Confirm priority #1 is still ${top[0] ?? "your highest-impact task"}.`,
  };

  return {
    success: true,
    text: RESPONSE_TEMPLATES.reprioritize(payload),
    values: {
      intent: "reprioritize",
      updatedCount: top.length,
    },
    data: {
      route: "reprioritize",
      payload,
    },
  };
};

const buildReminderResult = (text: string): ActionResult => {
  const tasks = extractTasks(text).slice(0, 2);
  const fallbackTasks = tasks.length > 0 ? tasks : ["Key task", "Secondary task"];

  const messages = fallbackTasks.map(
    (task) => `Reminder: ${task}. Keep it concise and ship the first complete draft.`
  );

  const payload: ReminderPayload = {
    messages,
    suggestedTime: "15 minutes before start time",
    nextAction: "Copy one reminder and send it to your preferred channel.",
  };

  return {
    success: true,
    text: RESPONSE_TEMPLATES.reminder(payload),
    values: {
      intent: "reminder",
      reminderCount: messages.length,
    },
    data: {
      route: "reminder",
      payload,
    },
  };
};

const routeAndBuildResult = (text: string, fallback: RouteIntent): ActionResult => {
  const routedIntent = routeIntent(text, fallback);
  switch (routedIntent) {
    case "plan":
      return buildPlanResult(text);
    case "reprioritize":
      return buildReprioritizeResult(text);
    case "reminder":
      return buildReminderResult(text);
    default:
      return buildPlanResult(text);
  }
};

const buildDailyPlanAction: Action = {
  name: "BUILD_DAILY_PLAN",
  description:
    "Trigger when the user asks for a day plan, schedule, or time-blocked task breakdown.",
  similes: ["PLAN_DAY", "SCHEDULE_DAY", "TIME_BLOCK_PLAN"],
  validate: async (_runtime, message) => hasContent(message),
  handler: async (_runtime, message) => {
    return routeAndBuildResult(getText(message), "plan");
  },
  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "I have 2 hours and need to prep a client update, clear urgent email, and plan tomorrow.",
        },
      },
      {
        name: "TaskForge",
        content: {
          text: "Goal: Build a focused plan. Plan: 1) client update, 2) urgent email, 3) tomorrow planning, 4) buffer. Next Action: Start with the client update.",
        },
      },
    ],
  ],
};

const reprioritizeTasksAction: Action = {
  name: "REPRIORITIZE_TASKS",
  description:
    "Trigger when deadlines change or the user asks to reorder work by urgency and impact.",
  similes: ["REORDER_TASKS", "REPLAN_DAY", "SHIFT_PRIORITIES"],
  validate: async (_runtime, message) => hasContent(message),
  handler: async (_runtime, message) => {
    return routeAndBuildResult(getText(message), "reprioritize");
  },
  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "My 3pm meeting moved to noon. Reprioritize my remaining tasks.",
        },
      },
      {
        name: "TaskForge",
        content: {
          text: "Goal: Adjust priorities around the new constraint. Updated priorities: meeting prep first, core task second, admin last.",
        },
      },
    ],
  ],
};

const draftReminderAction: Action = {
  name: "DRAFT_REMINDER",
  description:
    "Trigger when the user wants reminder text for follow-ups, meetings, or deadlines.",
  similes: ["MAKE_REMINDER", "WRITE_REMINDER", "REMINDER_TEXT"],
  validate: async (_runtime, message) => hasContent(message),
  handler: async (_runtime, message) => {
    return routeAndBuildResult(getText(message), "reminder");
  },
  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "Draft reminders for invoice submission and interview prep tonight.",
        },
      },
      {
        name: "TaskForge",
        content: {
          text: "Goal: Produce message-ready reminders. Reminder 1: invoice submission. Reminder 2: interview prep.",
        },
      },
    ],
  ],
};

/**
 * Your custom plugin.
 * Add this plugin's name to the `plugins` array in your character file
 * to activate it.
 */
export const customPlugin: Plugin = {
  name: "taskforge-custom-plugin",
  description: "Task automation actions for planning, reprioritization, and reminders",
  actions: [buildDailyPlanAction, reprioritizeTasksAction, draftReminderAction],
  providers: [],
  evaluators: [],
};

export default customPlugin;
