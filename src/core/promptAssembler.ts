import { composePersonaInstructions, type PersonaContext } from "./personaContext.js";
import type { ComposerMessage, CapabilityPack, ActionEnvelope, AgentExecutionResult } from "./contracts.js";

interface BudgetConfig {
  baseChars?: number;
  workspaceChars?: number;
  dynamicChars?: number;
}

interface AssembleComposerInput {
  input: string;
  actionEnvelope: ActionEnvelope | null;
  executionResult: AgentExecutionResult | { status: string; message: string } | null;
  personaContext?: PersonaContext | null | undefined;
  capabilityPack: CapabilityPack;
  memoryEvidence?: unknown[];
  narrativeEntries?: unknown[];
  budget?: BudgetConfig;
}

interface AssembleChatInput {
  input: string;
  personaContext?: PersonaContext | null | undefined;
  capabilityPack: CapabilityPack;
  memoryEvidence?: unknown[];
  narrativeEntries?: unknown[];
  budget?: BudgetConfig;
}

export function assembleComposerMessages({
  input,
  actionEnvelope,
  executionResult,
  personaContext,
  capabilityPack,
  memoryEvidence = [],
  narrativeEntries = [],
  budget = {}
}: AssembleComposerInput): ComposerMessage[] {
  const baseChars = budget.baseChars ?? 1600;
  const workspaceChars = budget.workspaceChars ?? 1800;
  const dynamicChars = budget.dynamicChars ?? 2800;

  const baseSystem = trimTo(
    [
      "You are a response composer for a personal assistant.",
      "Return strict JSON only. No markdown.",
      "Ground all suggestions in provided evidence.",
      "Do not invent facts not in action result or memory context.",
      "Keep reasoning concise and actionable.",
      "If action is null, treat request as general conversation and answer directly in a helpful style."
    ].join("\n"),
    baseChars
  );

  const workspaceContext = trimTo(composePersonaInstructions(personaContext), workspaceChars);
  const capabilityContext = trimTo(JSON.stringify(capabilityPack ?? {}, null, 2), 900);
  const actionContext = trimTo(
    JSON.stringify(
      {
        request: input,
        action: actionEnvelope ?? null,
        execution: executionResult ?? null,
        memoryEvidence: memoryEvidence.slice(0, 8),
        narrative: narrativeEntries.slice(0, 8)
      },
      null,
      2
    ),
    dynamicChars
  );

  const outputSchema = {
    summary: "string",
    intent: "string",
    reasoning: "string",
    evidence: [
      {
        id: "string",
        type: "string",
        source: "string",
        label: "string",
        details: "object"
      }
    ],
    suggestions: [
      {
        id: "string",
        title: "string",
        why: "string",
        risk: "low|medium|high",
        actionEnvelope: { agent: "string", action: "string", params: "object" },
        evidenceRefs: ["string"]
      }
    ],
    followUpQuestion: "string|null",
    confidence: "number[0..1]"
  };

  return [
    {
      role: "system",
      content:
        `${baseSystem}\n\n` +
        `Capability context:\n${capabilityContext}\n\n` +
        `Workspace context:\n${workspaceContext}\n\n` +
        `Output schema:\n${JSON.stringify(outputSchema, null, 2)}`
    },
    {
      role: "user",
      content: `Compose a conversational assistant response for this execution context:\n${actionContext}`
    }
  ];
}

export function assembleChatMessages({
  input,
  personaContext,
  capabilityPack,
  memoryEvidence = [],
  narrativeEntries = [],
  budget = {}
}: AssembleChatInput): ComposerMessage[] {
  const baseChars = budget.baseChars ?? 1600;
  const workspaceChars = budget.workspaceChars ?? 1800;
  const dynamicChars = budget.dynamicChars ?? 2800;

  const baseSystem = trimTo(
    [
      "You are micro-claw, a conversational personal assistant.",
      "Respond naturally and directly in plain text.",
      "Do not output JSON, code fences, or schema labels.",
      "Ground statements in the provided context and capabilities.",
      "If the user asks for unsupported capabilities, explain what is supported and suggest the nearest valid command.",
      "For ambiguous action requests, ask one short clarifying question."
    ].join("\n"),
    baseChars
  );
  const workspaceContext = trimTo(composePersonaInstructions(personaContext), workspaceChars);
  const capabilityContext = trimTo(JSON.stringify(capabilityPack ?? {}, null, 2), 1100);
  const dynamicContext = trimTo(
    JSON.stringify(
      {
        request: input,
        recentMemory: memoryEvidence.slice(0, 8),
        narrative: narrativeEntries.slice(0, 8)
      },
      null,
      2
    ),
    dynamicChars
  );

  return [
    {
      role: "system",
      content:
        `${baseSystem}\n\n` +
        `Capabilities:\n${capabilityContext}\n\n` +
        `Persona and workspace context:\n${workspaceContext}`
    },
    {
      role: "user",
      content: `User request and context:\n${dynamicContext}\n\nRespond as micro-claw.`
    }
  ];
}

function trimTo(text: string, maxChars: number): string {
  const normalized = String(text ?? "");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}\n...[truncated]`;
}
