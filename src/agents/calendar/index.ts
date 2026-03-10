// @ts-nocheck
import { executeAction } from "../base/executeAction.js";
import { scheduleEventAction } from "./actions/scheduleEvent.js";
import { findEventsAction } from "./actions/findEvents.js";
import manifest from "./manifest.json" with { type: "json" };

export class CalendarAgent {
  constructor() {
    this.id = "ms.calendar";
    this.description = "Calendar actions";
    this.manifest = manifest;
  }

  async canHandle(envelope) {
    return envelope?.agent === "ms.calendar";
  }

  async execute(envelope, context = {}) {
    return executeAction({
      envelope,
      context,
      handlers: {
        schedule_event: scheduleEventAction,
        find_events: findEventsAction
      },
      fallbackErrorMessage: `Unsupported Calendar action '${envelope.action}'`
    });
  }
}

export default function createAgent() {
  return new CalendarAgent();
}
