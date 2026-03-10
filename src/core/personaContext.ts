// @ts-nocheck
import fs from "node:fs";
import path from "node:path";

function readTextIfExists(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) return "";
  return fs.readFileSync(resolved, "utf8").trim();
}

export function loadPersonaContext(profileName = "default", options = {}) {
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

export function composePersonaInstructions(personaContext) {
  const sections = [];
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
