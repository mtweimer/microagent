import { rankDomains } from "../contracts/actionRegistry.js";
import type { DomainSelection } from "./contracts.js";

const DEFAULT_MIN_SCORE = 1.0;
const DEFAULT_AMBIGUITY_DELTA = 0.5;

interface CandidateSelectorOptions {
  minScore?: number;
  ambiguityDelta?: number;
  maxCandidates?: number;
}

export function selectDomainCandidates(input: string, options: CandidateSelectorOptions = {}): DomainSelection {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const ambiguityDelta = options.ambiguityDelta ?? DEFAULT_AMBIGUITY_DELTA;
  const maxCandidates = options.maxCandidates ?? 3;

  const ranked = rankDomains(input).filter((row) => row.score >= minScore);
  const candidates = ranked.slice(0, maxCandidates);
  const primary = candidates[0]?.domain ?? null;
  const ambiguous =
    candidates.length > 1 &&
    Math.abs((candidates[0]?.score ?? 0) - (candidates[1]?.score ?? 0)) <= ambiguityDelta;

  return {
    primary,
    candidates,
    ambiguous
  };
}
