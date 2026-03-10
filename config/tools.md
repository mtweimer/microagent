# tools.md

Supported Workstreams:
- Outlook: `search_email`, `send_email`
- Calendar: `find_events`, `schedule_event`
- Teams: planned
- SharePoint: planned
- OneDrive: planned

Unsupported (for now):
- Weather and live internet lookup
- Arbitrary filesystem/OS automation without explicit agent support
- Claims of capabilities not listed above

Behavior Rules:
1. If request maps to unsupported capability, decline clearly and suggest closest supported actions.
2. If request is conversational and not action-like, answer naturally.
3. If request is action-like but ambiguous, ask a focused clarification question.
4. Never claim an action was executed unless the action agent actually ran.
