import { execFileSync } from "node:child_process";
import { buildRuntime } from "../cli/runtime.js";
import { validateTrace } from "../trace/traceSchema.js";
import { validateProfile } from "./profile.js";

export interface SystemCheckResult {
  profile: string;
  profileValidation: ReturnType<typeof validateProfile>;
  schemaCheck: { ok: boolean; output: string };
  traceValidation: ReturnType<typeof validateTrace>;
  probe: {
    status: string;
    requestId: string;
    agent: string;
    translationSource: string;
  };
}

export async function runSystemCheck(profileName = "default"): Promise<SystemCheckResult> {
  const runtime = await buildRuntime(profileName);

  const profileValidation = validateProfile(runtime.profile);

  let schemaCheck: { ok: boolean; output: string } = { ok: true, output: "" };
  try {
    const out = execFileSync("npx", ["tsx", "scripts/schema-check.ts"], { encoding: "utf8" });
    schemaCheck = { ok: true, output: out.trim() };
  } catch (error) {
    const execError = error as { stdout?: string; message?: string };
    schemaCheck = {
      ok: false,
      output: String(execError.stdout || execError.message || error)
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
