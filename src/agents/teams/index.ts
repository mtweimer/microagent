// @ts-nocheck
import { executeAction } from "../base/executeAction.js";
import { searchMessagesAction } from "./actions/searchMessages.js";
import { reviewMyDayAction } from "./actions/reviewMyDay.js";
import { searchMentionsAction } from "./actions/searchMentions.js";
import { readMessageAction } from "./actions/readMessage.js";
import manifest from "./manifest.json" with { type: "json" };

export class TeamsAgent {
  constructor() {
    this.id = "ms.teams";
    this.description = "Teams actions (scaffold)";
    this.manifest = manifest;
  }

  async canHandle(envelope) {
    return envelope?.agent === "ms.teams";
  }

  async execute(envelope, context = {}) {
    return executeAction({
      envelope,
      context,
      handlers: {
        review_my_day: reviewMyDayAction,
        search_mentions: searchMentionsAction,
        search_messages: searchMessagesAction,
        read_message: readMessageAction
      },
      fallbackErrorMessage: `Unsupported Teams action '${envelope.action}'`
    });
  }
}

export default function createAgent() {
  return new TeamsAgent();
}
