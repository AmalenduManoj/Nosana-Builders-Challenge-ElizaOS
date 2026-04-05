/**
 * Custom Plugin Entry Point
 *
 * This file is where you can define custom actions, providers, and evaluators
 * for your ElizaOS agent. Add your logic here and reference this plugin in
 * your character file.
 *
 * ElizaOS Plugin Docs: https://elizaos.github.io/eliza/docs/core/plugins
 */

import { type Plugin } from "@elizaos/core";

type AgentMessage = { content?: { text?: string } };

const hasContent = (message: AgentMessage): boolean => {
  const text = message?.content?.text;
  return typeof text === "string" && text.trim().length > 0;
};

const buildDailyPlanAction = {
  name: "BUILD_DAILY_PLAN",
  description:
    "Trigger when the user asks for a day plan, schedule, or time-blocked task breakdown.",
  similes: ["PLAN_DAY", "SCHEDULE_DAY", "TIME_BLOCK_PLAN"],
  validate: async (_runtime: unknown, message: AgentMessage) => hasContent(message),
  handler: async (_runtime: unknown, message: AgentMessage) => {
    const text = message.content?.text ?? "";
    console.log("BUILD_DAILY_PLAN input:", text);
    return true;
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "I have 3 hours and need to finish slides, send invoices, and prep tomorrow's standup.",
        },
      },
    ],
  ],
};

const reprioritizeTasksAction = {
  name: "REPRIORITIZE_TASKS",
  description:
    "Trigger when deadlines change or the user asks to reorder work by urgency and impact.",
  similes: ["REORDER_TASKS", "REPLAN_DAY", "SHIFT_PRIORITIES"],
  validate: async (_runtime: unknown, message: AgentMessage) => hasContent(message),
  handler: async (_runtime: unknown, message: AgentMessage) => {
    const text = message.content?.text ?? "";
    console.log("REPRIORITIZE_TASKS input:", text);
    return true;
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "My 4pm call moved to 1pm. Reprioritize the rest of my tasks.",
        },
      },
    ],
  ],
};

const draftReminderAction = {
  name: "DRAFT_REMINDER",
  description:
    "Trigger when the user wants reminder text for follow-ups, meetings, or deadlines.",
  similes: ["MAKE_REMINDER", "WRITE_REMINDER", "REMINDER_TEXT"],
  validate: async (_runtime: unknown, message: AgentMessage) => hasContent(message),
  handler: async (_runtime: unknown, message: AgentMessage) => {
    const text = message.content?.text ?? "";
    console.log("DRAFT_REMINDER input:", text);
    return true;
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Draft a reminder message so I review my resume at 7:30pm.",
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
