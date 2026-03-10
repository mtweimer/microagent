import {
  ACTION_REGISTRY_VERSION,
  getActionConfig,
  getAllActionEntries
} from "../contracts/actionRegistry.js";

function validateType(value, expected) {
  if (expected === "array") return Array.isArray(value);
  return typeof value === expected;
}

export function validateActionEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") {
    return { ok: false, errors: ["Envelope must be an object"] };
  }

  const errors = [];
  if (!envelope.agent) errors.push("Missing envelope.agent");
  if (!envelope.action) errors.push("Missing envelope.action");
  if (!envelope.requestId) errors.push("Missing envelope.requestId");
  if (!envelope.schemaVersion) errors.push("Missing envelope.schemaVersion");
  if (typeof envelope.params !== "object" || envelope.params === null) {
    errors.push("Missing envelope.params object");
  }

  if (errors.length > 0) return { ok: false, errors };

  const actionCfg = getActionConfig(envelope.agent, envelope.action);
  if (!actionCfg) {
    return {
      ok: false,
      errors: [`Unknown action '${envelope.agent}.${envelope.action}'`]
    };
  }

  if (envelope.schemaVersion !== actionCfg.schemaVersion) {
    errors.push(
      `Schema version mismatch for '${envelope.agent}.${envelope.action}': expected ${actionCfg.schemaVersion}, got ${envelope.schemaVersion}`
    );
  }

  const schema = actionCfg.inputSchema;
  const params = envelope.params ?? {};

  for (const key of schema.required) {
    if (params[key] === undefined) {
      errors.push(`Missing required param '${key}'`);
    }
  }

  for (const [prop, expectedType] of Object.entries(schema.properties)) {
    if (params[prop] !== undefined && !validateType(params[prop], expectedType)) {
      errors.push(`Param '${prop}' must be ${expectedType}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function getKnownActionSchemas() {
  return getAllActionEntries().map((x) => ({
    agent: x.agentId,
    action: x.actionName,
    schemaVersion: x.schemaVersion,
    inputSchema: x.inputSchema
  }));
}

export function getRegistryVersion() {
  return ACTION_REGISTRY_VERSION;
}
