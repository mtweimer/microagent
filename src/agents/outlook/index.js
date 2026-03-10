import { executeAction } from "../base/executeAction.js";
import { sendEmailAction } from "./actions/sendEmail.js";
import { searchEmailAction } from "./actions/searchEmail.js";
import { listRecentEmailsAction } from "./actions/listRecentEmails.js";
import { readEmailAction } from "./actions/readEmail.js";
import manifest from "./manifest.json" with { type: "json" };

export class OutlookAgent {
  constructor() {
    this.id = "ms.outlook";
    this.description = "Outlook mail actions";
    this.manifest = manifest;
  }

  async canHandle(envelope) {
    return envelope?.agent === "ms.outlook";
  }

  async execute(envelope, context = {}) {
    return executeAction({
      envelope,
      context,
      handlers: {
        send_email: sendEmailAction,
        search_email: searchEmailAction,
        list_recent_emails: listRecentEmailsAction,
        read_email: readEmailAction
      },
      fallbackErrorMessage: `Unsupported Outlook action '${envelope.action}'`
    });
  }
}

export default function createAgent() {
  return new OutlookAgent();
}
