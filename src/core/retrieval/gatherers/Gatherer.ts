import type { RetrievalPlan, RetrievedEvidence } from "../../contracts.js";

export interface Gatherer {
  name: string;
  supports(plan: RetrievalPlan): boolean;
  gather(plan: RetrievalPlan): Promise<RetrievedEvidence[]>;
}
