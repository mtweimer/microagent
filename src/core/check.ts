// @ts-nocheck
import { buildRuntime } from "../cli/runtime.js";
import { validateTrace } from "../trace/traceSchema.js";
import { validateProfile } from "./profile.js";
import { execFileSync } from "node:child_process";

export async function runSystemCheck(profileName = "default") {
  const runtime = await buildRuntime(profileName);

  const profileValidation = validateProfile(runtime.profile);

  let schemaCheck = { ok: true, output: "" };
  try {
    const out = execFileSync("npx", ["tsx", "scripts/schema-check.ts"], { encoding: "utf8" });
    schemaCheck = { ok: true, output: out.trim() };
  } catch (error) {
    schemaCheck = {
      ok: false,
      output: String(error.stdout || error.message || error)
    };
  }

  const probe = await runtime.dispatcher.route("schedule a team sync tomorrow");
  const traceValidation = validateTrace(probe.trace);

  return {
    profile: profileName,
    profileValidation,
    schemaCheck,
    traceValidation,
    probe: {
      status: probe.status,
      requestId: probe.requestId,
      agent: probe.trace?.agent,
      translationSource: probe.trace?.translationSource
    }
  };
}
