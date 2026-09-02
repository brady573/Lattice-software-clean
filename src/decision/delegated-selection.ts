import { z } from "zod";
import type { MaterialDominanceFrontier } from "./material-dominance-frontier.js";

export const finalChoiceDelegationAuthorizationSchema = z.object({
  delegationId: z.string().trim().min(1).max(200),
  intentScopeId: z.string().trim().min(1).max(200),
  intentVersionId: z.string().trim().min(1).max(200),
  decisionStateId: z.string().trim().min(1).max(200),
  frontierFingerprint: z.string().trim().min(1).max(500),
  provenance: z.enum(["EXPLICIT_USER", "USER_CONFIRMED"]),
  status: z.enum(["ACTIVE", "REVOKED"]),
  authority: z.literal("FINAL_CHOICE"),
}).strict();

export const delegatedSelectionProposalSchema = z.object({
  intentScopeId: z.string().trim().min(1).max(200),
  intentVersionId: z.string().trim().min(1).max(200),
  decisionStateId: z.string().trim().min(1).max(200),
  frontierFingerprint: z.string().trim().min(1).max(500),
  selectedAlternativeId: z.string().trim().min(1).max(200),
  reasonCriterionIds: z.array(z.string().trim().min(1).max(200)).min(1),
  acknowledgedTradeOffCriterionIds: z.array(z.string().trim().min(1).max(200)),
  issuedBy: z.literal("LATTICE_DECISION_ENGINE"),
}).strict();

export type FinalChoiceDelegationAuthorization = Readonly<
  z.infer<typeof finalChoiceDelegationAuthorizationSchema>
>;
export type DelegatedSelectionProposal = Readonly<
  z.infer<typeof delegatedSelectionProposalSchema>
>;

export interface DelegatedSelection {
  readonly delegationId: string;
  readonly intentScopeId: string;
  readonly intentVersionId: string;
  readonly decisionStateId: string;
  readonly frontierFingerprint: string;
  readonly selectedAlternativeId: string;
  readonly intactFrontierAlternativeIds: readonly string[];
  readonly reasonCriterionIds: readonly string[];
  readonly acknowledgedTradeOffCriterionIds: readonly string[];
  readonly judgmentAuthority: "LATTICE_DECISION_ENGINE";
  readonly externalActionAuthorized: false;
}

function assertExactBinding(
  authorization: FinalChoiceDelegationAuthorization,
  proposal: DelegatedSelectionProposal,
): void {
  const bindings = [
    ["intentScopeId", authorization.intentScopeId, proposal.intentScopeId],
    ["intentVersionId", authorization.intentVersionId, proposal.intentVersionId],
    ["decisionStateId", authorization.decisionStateId, proposal.decisionStateId],
    ["frontierFingerprint", authorization.frontierFingerprint, proposal.frontierFingerprint],
  ] as const;

  for (const [name, authorized, proposed] of bindings) {
    if (authorized !== proposed) {
      throw new Error(`Delegated selection ${name} does not match exact authorization binding.`);
    }
  }
}

/**
 * Produces an authoritative Decision Engine selection only under exact USER authority.
 *
 * Intent Authority remains the owner of the authorization record. The proposal is
 * explicitly Decision-Engine-authored. The valid frontier is preserved verbatim,
 * and this contract never grants external action, purchase, or transaction authority.
 */
export function authorizeDelegatedSelection(
  frontier: MaterialDominanceFrontier,
  authorizationValue: FinalChoiceDelegationAuthorization,
  proposalValue: DelegatedSelectionProposal,
): DelegatedSelection {
  const authorization = finalChoiceDelegationAuthorizationSchema.parse(authorizationValue);
  const proposal = delegatedSelectionProposalSchema.parse(proposalValue);

  if (authorization.status !== "ACTIVE") {
    throw new Error("Final-choice delegation is not active.");
  }
  if (frontier.frontierAlternativeIds.length === 0) {
    throw new Error("Delegated selection requires a non-empty valid frontier.");
  }
  if (frontier.forcedWinnerAlternativeId !== null) {
    throw new Error("Delegated selection requires an intact non-forced frontier.");
  }

  assertExactBinding(authorization, proposal);

  if (!frontier.frontierAlternativeIds.includes(proposal.selectedAlternativeId)) {
    throw new Error("Delegated selection must choose an alternative from the valid frontier.");
  }

  return Object.freeze({
    delegationId: authorization.delegationId,
    intentScopeId: authorization.intentScopeId,
    intentVersionId: authorization.intentVersionId,
    decisionStateId: authorization.decisionStateId,
    frontierFingerprint: authorization.frontierFingerprint,
    selectedAlternativeId: proposal.selectedAlternativeId,
    intactFrontierAlternativeIds: Object.freeze([...frontier.frontierAlternativeIds]),
    reasonCriterionIds: Object.freeze([...proposal.reasonCriterionIds]),
    acknowledgedTradeOffCriterionIds: Object.freeze([
      ...proposal.acknowledgedTradeOffCriterionIds,
    ]),
    judgmentAuthority: "LATTICE_DECISION_ENGINE",
    externalActionAuthorized: false,
  });
}
