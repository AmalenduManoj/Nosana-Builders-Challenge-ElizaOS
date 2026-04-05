TaskForge is a personal task automation agent built with ElizaOS and deployed on Nosana's decentralized compute network.

It helps users convert messy, real-world intent into practical execution plans. Instead of generic chat responses, TaskForge focuses on three high-value outcomes: (1) priority-aware daily plans, (2) rapid reprioritization when schedules change, and (3) reminder drafting that can be copied directly into messaging apps or calendars.

The assistant is tuned for concise, action-oriented responses and uses a consistent structure: Goal, Plan, and Next Action. This design keeps interactions readable and immediately useful, especially under time pressure.

TaskForge is configured with OpenAI-compatible inference via Nosana-hosted Qwen models and uses persistent storage through SQLite to support context continuity across conversations. The project is containerized with Docker and shipped with a Nosana job definition for reproducible decentralized deployment.

The UX target is simple: a user should get value in under one minute. A judge can test this quickly by giving a constrained time window and multiple tasks, then asking TaskForge to replan after a priority change. The output shows prioritization logic, trade-offs, and practical next steps.

This project demonstrates a practical personal AI use case with clear day-to-day utility while aligning with challenge goals: solid ElizaOS implementation, meaningful Nosana deployment, and straightforward reproducibility for evaluators.
