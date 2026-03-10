import fs from "node:fs";
import path from "node:path";

export interface PersonaContext {
  soul: string;
  agent: string;
  tools: string;
  overlays: {
    userContext: string;
    interactionStyle: string;
  };
}

interface PersonaLoadOptions {
  soulPath?: string;
  agentPath?: string;
  toolsPath?: string;
  overlayRoot?: string;
  userContextPath?: string;
  interactionStylePath?: string;
}

function readTextIfExists(filePath: string): string {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) return "";
  return fs.readFileSync(resolved, "utf8").trim();
}

export function loadPersonaContext(profileName = "default", options: PersonaLoadOptions = {}): PersonaContext {
  const baseSoul = options.soulPath ?? "config/soul.md";
  const baseAgent = options.agentPath ?? "config/agent.md";
  const baseTools = options.toolsPath ?? "config/tools.md";
  const overlayRoot = options.overlayRoot ?? `data/persona/${profileName}`;
  const userContextPath = options.userContextPath ?? `${overlayRoot}/user_context.generated.md`;
  const interactionStylePath =
    options.interactionStylePath ?? `${overlayRoot}/interaction_style.generated.md`;

  return {
    soul: readTextIfExists(baseSoul),
    agent: readTextIfExists(baseAgent),
    tools: readTextIfExists(baseTools),
    overlays: {
      userContext: readTextIfExists(userContextPath),
      interactionStyle: readTextIfExists(interactionStylePath)
    }
  };
}

export function composePersonaInstructions(personaContext: PersonaContext | null | undefined): string {
  const sections: string[] = [];
  if (personaContext?.agent) sections.push(`Agent baseline:\n${personaContext.agent}`);
  if (personaContext?.soul) sections.push(`Voice and style:\n${personaContext.soul}`);
  if (personaContext?.tools) sections.push(`Tool guidelines:\n${personaContext.tools}`);
  if (personaContext?.overlays?.userContext) {
    sections.push(`User context overlay:\n${personaContext.overlays.userContext}`);
  }
  if (personaContext?.overlays?.interactionStyle) {
    sections.push(`Interaction overlay:\n${personaContext.overlays.interactionStyle}`);
  }
  return sections.join("\n\n").trim();
}
