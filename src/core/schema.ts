import {
  ACTION_REGISTRY_VERSION,
  getActionConfig,
  getAllActionEntries
} from "../contracts/actionRegistry.js";
import type { ActionEnvelope, JsonTypeName, ValidationResult } from "./contracts.js";

function validateType(value: unknown, expected: JsonTypeName): boolean {
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return typeof value === expected;
}

export function validateActionEnvelope(envelope: unknown): ValidationResult {
  if (!envelope || typeof envelope !== "object") {
    return { ok: false, errors: ["Envelope must be an object"] };
  }

  const typedEnvelope = envelope as Partial<ActionEnvelope>;
  const errors: string[] = [];
  if (!typedEnvelope.agent) errors.push("Missing envelope.agent");
  if (!typedEnvelope.action) errors.push("Missing envelope.action");
  if (!typedEnvelope.requestId) errors.push("Missing envelope.requestId");
  if (!typedEnvelope.schemaVersion) errors.push("Missing envelope.schemaVersion");
  if (typeof typedEnvelope.params !== "object" || typedEnvelope.params === null) {
    errors.push("Missing envelope.params object");
  }

  if (errors.length > 0) return { ok: false, errors };

  const actionCfg = getActionConfig(String(typedEnvelope.agent), String(typedEnvelope.action));
  if (!actionCfg) {
    return {
      ok: false,
      errors: [`Unknown action '${typedEnvelope.agent}.${typedEnvelope.action}'`]
    };
  }

  if (typedEnvelope.schemaVersion !== actionCfg.schemaVersion) {
    errors.push(
      `Schema version mismatch for '${typedEnvelope.agent}.${typedEnvelope.action}': expected ${actionCfg.schemaVersion}, got ${typedEnvelope.schemaVersion}`
    );
  }

  const params = typedEnvelope.params ?? {};
  for (const key of actionCfg.inputSchema.required) {
    if ((params as Record<string, unknown>)[key] === undefined) {
      errors.push(`Missing required param '${key}'`);
    }
  }

  for (const [prop, expectedType] of Object.entries(actionCfg.inputSchema.properties)) {
    const value = (params as Record<string, unknown>)[prop];
    if (value !== undefined && !validateType(value, expectedType)) {
      errors.push(`Param '${prop}' must be ${expectedType}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function getKnownActionSchemas() {
  return getAllActionEntries().map((entry) => ({
    agent: entry.agentId,
    action: entry.actionName,
    schemaVersion: entry.schemaVersion,
    inputSchema: entry.inputSchema
  }));
}

export function getRegistryVersion(): string {
  return ACTION_REGISTRY_VERSION;
}
