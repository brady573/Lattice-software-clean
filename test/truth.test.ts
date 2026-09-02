import assert from "node:assert/strict";
import test from "node:test";
import proofContractArtifact from "../docs/specifications/V36-Truth-Layer/claim-proof-contracts.json" with { type: "json" };
import { adjudicateClaim } from "../src/truth/adjudication.js";
import { proofContracts, requiredProofObligations } from "../src/truth/contracts.js";
import type { ClaimEvidence, ClaimType, CompiledClaim, ProofCheck, ProofObligation } from "../src/truth/types.js";

const runId = "00000000-0000-4000-8000-000000000036";
function makeCase(claimType:ClaimType, options:{statuses?:Partial<Record<string,"PASSED"|"FAILED"|"UNRESOLVED">>;evidence?:Array<{relation:"SUPPORTS"|"CONTRADICTS";component:string|null;primary?:boolean;verification?:"VERIFIED"|"UNVERIFIED"|"REJECTED"}>;materiallyMisleading?:boolean;evidenceRisk?:"ORDINARY"|"HIGH";extraChecks?:Array<{kind:string;status:"PASSED"|"FAILED"|"UNRESOLVED"}>}={}) {
  const claim:CompiledClaim={id:`claim-${claimType}`,runId,text:`claim ${claimType}`,claimType,scope:null,effectiveAt:null,jurisdiction:null,unit:null,denominator:null,baseline:null,period:null,causalRelation:claimType==="CAUSAL"?"causes":null,authenticityTarget:claimType==="AUTHENTICITY"?"artifact":null,comparisonClass:null,quotedContext:null,qualifiers:[],evidenceRisk:options.evidenceRisk??"ORDINARY"};
  const obligations:ProofObligation[]=requiredProofObligations(claimType).map((kind,index)=>({id:`ob-${index}`,runId,claimId:claim.id,kind,required:true}));
  const checks:ProofCheck[]=obligations.map((obligation,index)=>({id:`check-${index}`,runId,obligationId:obligation.id,kind:obligation.kind,status:options.statuses?.[obligation.kind]??"PASSED",evidenceIds:[],explanation:null}));
  for(const [index,extra] of (options.extraChecks??[]).entries()){const obligation:ProofObligation={id:`extra-ob-${index}`,runId,claimId:claim.id,kind:extra.kind,required:false};obligations.push(obligation);checks.push({id:`extra-check-${index}`,runId,obligationId:obligation.id,kind:extra.kind,status:extra.status,evidenceIds:[],explanation:null});}
  const evidence:ClaimEvidence[]=(options.evidence??[{relation:"SUPPORTS" as const,component:"origin-a",primary:true}]).map((item,index)=>({id:`ce-${index}`,runId,claimId:claim.id,artifactId:`artifact-${index}`,externalEvidenceId:`e-${index}`,relation:item.relation,specificEvidence:`evidence ${index}`,provenanceComponentKey:item.component,provenanceConfidence:item.component?"HIGH":"UNKNOWN",authoritativePrimary:item.primary??false,researchQuestionId:null,verification:item.verification??"VERIFIED",admitted:item.verification!=="REJECTED",rejectionReason:item.verification==="REJECTED"?"rejected":null}));
  return {claim,obligations,checks,evidence};
}

test("V36 runtime proof contracts are loaded from the canonical machine-readable artifact",()=>{assert.deepEqual(proofContracts,proofContractArtifact);});
test("unsupported positive becomes UNVERIFIED instead of FALSE",()=>{const subject=makeCase("FACTUAL",{statuses:{SOURCE_PROVENANCE:"UNRESOLVED"}});assert.equal(adjudicateClaim({assessmentId:"a",...subject}).verdict,"UNVERIFIED");});
test("ordinary strong authoritative primary evidence may satisfy positive burden",()=>assert.equal(adjudicateClaim({assessmentId:"a",...makeCase("FACTUAL")}).verdict,"TRUE"));
test("causal positive requires materially independent corroboration",()=>{assert.equal(adjudicateClaim({assessmentId:"a",...makeCase("CAUSAL",{evidence:[{relation:"SUPPORTS",component:"origin-a"},{relation:"SUPPORTS",component:"origin-a"}]})}).verdict,"UNVERIFIED");assert.equal(adjudicateClaim({assessmentId:"b",...makeCase("CAUSAL",{evidence:[{relation:"SUPPORTS",component:"origin-a"},{relation:"SUPPORTS",component:"origin-b"}]})}).verdict,"TRUE");});
test("verified conflict surfaces MIXED before positive burden",()=>assert.equal(adjudicateClaim({assessmentId:"a",...makeCase("CAUSAL",{evidence:[{relation:"SUPPORTS",component:"origin-a"},{relation:"CONTRADICTS",component:"origin-b"}]})}).verdict,"MIXED"));
test("unverified contradiction cannot block valid TRUE",()=>assert.equal(adjudicateClaim({assessmentId:"a",...makeCase("FACTUAL",{evidence:[{relation:"SUPPORTS",component:"origin-a",primary:true},{relation:"CONTRADICTS",component:"origin-b",verification:"UNVERIFIED"}]})}).verdict,"TRUE"));
test("current-state temporal failure becomes OUTDATED",()=>assert.equal(adjudicateClaim({assessmentId:"a",...makeCase("CURRENT_STATE",{extraChecks:[{kind:"TEMPORAL_APPLICABILITY",status:"FAILED"}]})}).verdict,"OUTDATED"));
test("opinion is not forced into TRUE/FALSE",()=>assert.equal(adjudicateClaim({assessmentId:"a",...makeCase("OPINION")}).verdict,"OPINION"));
test("material context omission yields MISLEADING",()=>{const subject=makeCase("INTERPRETIVE");assert.equal(adjudicateClaim({assessmentId:"a",...subject,materiallyMisleading:true}).verdict,"MISLEADING");});
