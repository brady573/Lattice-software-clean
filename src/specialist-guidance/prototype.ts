import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CanonicalModelMessage } from "../model/types.js";

export const PROTOTYPE_INTENT_FIXTURE_SOURCE = "specialist-guidance-prototype-fixture-v1" as const;
export const BUDGETING_GUIDANCE_PROFILE_ID = "budgeting-guidance" as const;
export const BUDGETING_GUIDANCE_PROFILE_VERSION = 1 as const;
export const SPECIALIST_GUIDANCE_HASH_ALGORITHM = "sha256" as const;
export const SPECIALIST_GUIDANCE_CANONICALIZATION = "lattice-json-v1" as const;

export interface SpecialistGuidanceProfile {
  readonly profileId: string;
  readonly version: number;
  readonly userFacingLabel: string;
  readonly domain: string;
  readonly purpose: string;
  readonly activationScope: readonly string[];
  readonly procedure: readonly string[];
  readonly clarificationGuidance: readonly string[];
  readonly excludedScopes: readonly string[];
  readonly presentationGuidance: readonly string[];
  readonly authorityBoundary: readonly string[];
  readonly securityBoundary: readonly string[];
  readonly evaluationCorpusId: string;
}

export interface PrototypeIntentVersionFixture {
  readonly fixtureSource: typeof PROTOTYPE_INTENT_FIXTURE_SOURCE;
  readonly intentVersionId: string;
  readonly status: "confirmed";
  readonly primaryDomain: string | null;
  readonly candidateDomains: readonly string[];
  readonly specialistGuidanceEnabled: boolean;
}

export type SpecialistGuidanceResolutionReason =
  | "matched_primary_domain"
  | "specialist_guidance_disabled"
  | "ambiguous_or_unresolved_domain"
  | "unrelated_domain"
  | "profile_unavailable";

export interface SpecialistGuidanceBinding {
  readonly intentVersionId: string;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly profileHash: string;
  readonly resolutionReasonCode: "matched_primary_domain";
}

export type SpecialistGuidanceResolution =
  | {
      readonly selected: true;
      readonly reason: "matched_primary_domain";
      readonly binding: SpecialistGuidanceBinding;
      readonly profile: SpecialistGuidanceProfile;
    }
  | {
      readonly selected: false;
      readonly reason: Exclude<SpecialistGuidanceResolutionReason, "matched_primary_domain">;
      readonly binding: null;
      readonly profile: null;
    };

export interface SpecialistGuidanceAudit {
  readonly prototypeFixture: true;
  readonly selected: boolean;
  readonly intentVersionId: string | null;
  readonly profileId: string | null;
  readonly profileVersion: number | null;
  readonly profileHash: string | null;
  readonly resolutionReasonCode: SpecialistGuidanceResolutionReason | "fixture_not_supplied";
}

const PROFILE_KEYS = [
  "profileId", "version", "userFacingLabel", "domain", "purpose", "activationScope",
  "procedure", "clarificationGuidance", "excludedScopes", "presentationGuidance",
  "authorityBoundary", "securityBoundary", "evaluationCorpusId",
] as const;

const INTENT_FIXTURE_KEYS = [
  "fixtureSource", "intentVersionId", "status", "primaryDomain", "candidateDomains",
  "specialistGuidanceEnabled",
] as const;

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length > 0) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}.`);
}

function requireString(value: unknown, label: string, max = 4_000): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  if (value.length > max) throw new Error(`${label} exceeds ${max} characters.`);
  return value;
}

function requireStringArray(
  value: unknown,
  label: string,
  options: { min?: number; max?: number } = {},
): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const min = options.min ?? 0;
  const max = options.max ?? 64;
  if (value.length < min || value.length > max) {
    throw new Error(`${label} must contain between ${min} and ${max} entries.`);
  }
  return Object.freeze(value.map((item, index) => requireString(item, `${label}[${index}]`, 1_000)));
}

export function parseSpecialistGuidanceProfile(raw: unknown): SpecialistGuidanceProfile {
  const value = asObject(raw, "Specialist Guidance Profile");
  rejectUnknownKeys(value, PROFILE_KEYS, "Specialist Guidance Profile");
  const profileId = requireString(value.profileId, "profileId", 128);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profileId)) throw new Error("profileId must use lowercase kebab-case.");
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1) {
    throw new Error("version must be a positive safe integer.");
  }
  return Object.freeze({
    profileId,
    version: value.version as number,
    userFacingLabel: requireString(value.userFacingLabel, "userFacingLabel", 160),
    domain: requireString(value.domain, "domain", 128),
    purpose: requireString(value.purpose, "purpose"),
    activationScope: requireStringArray(value.activationScope, "activationScope", { min: 1 }),
    procedure: requireStringArray(value.procedure, "procedure", { min: 1 }),
    clarificationGuidance: requireStringArray(value.clarificationGuidance, "clarificationGuidance"),
    excludedScopes: requireStringArray(value.excludedScopes, "excludedScopes"),
    presentationGuidance: requireStringArray(value.presentationGuidance, "presentationGuidance"),
    authorityBoundary: requireStringArray(value.authorityBoundary, "authorityBoundary", { min: 1 }),
    securityBoundary: requireStringArray(value.securityBoundary, "securityBoundary", { min: 1 }),
    evaluationCorpusId: requireString(value.evaluationCorpusId, "evaluationCorpusId", 256),
  });
}

export function parsePrototypeIntentVersionFixture(raw: unknown): PrototypeIntentVersionFixture {
  const value = asObject(raw, "Prototype IntentVersion fixture");
  rejectUnknownKeys(value, INTENT_FIXTURE_KEYS, "Prototype IntentVersion fixture");
  if (value.fixtureSource !== PROTOTYPE_INTENT_FIXTURE_SOURCE) throw new Error("Prototype IntentVersion fixture source is not recognized.");
  if (value.status !== "confirmed") throw new Error("Prototype IntentVersion fixture must be confirmed.");
  const intentVersionId = requireString(value.intentVersionId, "intentVersionId", 128);
  const primaryDomain = value.primaryDomain === null ? null : requireString(value.primaryDomain, "primaryDomain", 128);
  const candidateDomains = requireStringArray(value.candidateDomains, "candidateDomains", { max: 8 });
  const uniqueDomains = new Set(candidateDomains);
  if (uniqueDomains.size !== candidateDomains.length) throw new Error("candidateDomains must not contain duplicates.");
  if (primaryDomain !== null && !uniqueDomains.has(primaryDomain)) throw new Error("primaryDomain must be present in candidateDomains.");
  if (typeof value.specialistGuidanceEnabled !== "boolean") throw new Error("specialistGuidanceEnabled must be boolean.");
  return Object.freeze({
    fixtureSource: PROTOTYPE_INTENT_FIXTURE_SOURCE,
    intentVersionId,
    status: "confirmed",
    primaryDomain,
    candidateDomains: Object.freeze([...candidateDomains]),
    specialistGuidanceEnabled: value.specialistGuidanceEnabled,
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot encode non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  throw new Error("Canonical JSON contains an unsupported value.");
}

export function hashSpecialistGuidanceProfile(profile: SpecialistGuidanceProfile): string {
  const canonical = canonicalJson(profile);
  return `${SPECIALIST_GUIDANCE_HASH_ALGORITHM}:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export class PrototypeSpecialistGuidanceRegistry {
  private readonly profiles = new Map<string, SpecialistGuidanceProfile>();
  constructor(profiles: readonly SpecialistGuidanceProfile[]) {
    for (const profile of profiles) {
      const key = `${profile.profileId}@${profile.version}`;
      if (this.profiles.has(key)) throw new Error(`Duplicate Specialist Guidance Profile: ${key}.`);
      this.profiles.set(key, profile);
    }
  }
  get(profileId: string, version: number): SpecialistGuidanceProfile | undefined {
    return this.profiles.get(`${profileId}@${version}`);
  }
}

const DEFAULT_PROFILE_PATH = resolve(process.cwd(), "src/specialist-guidance/resources/budgeting-guidance.v1.json");

export function loadDefaultPrototypeSpecialistGuidanceRegistry(): PrototypeSpecialistGuidanceRegistry {
  const raw = JSON.parse(readFileSync(DEFAULT_PROFILE_PATH, "utf8")) as unknown;
  const profile = parseSpecialistGuidanceProfile(raw);
  if (profile.profileId !== BUDGETING_GUIDANCE_PROFILE_ID || profile.version !== BUDGETING_GUIDANCE_PROFILE_VERSION) {
    throw new Error("Trusted budgeting profile identity/version does not match the prototype registry contract.");
  }
  return new PrototypeSpecialistGuidanceRegistry([profile]);
}

export function resolvePrototypeSpecialistGuidance(
  intent: PrototypeIntentVersionFixture,
  registry: PrototypeSpecialistGuidanceRegistry,
): SpecialistGuidanceResolution {
  if (!intent.specialistGuidanceEnabled) return Object.freeze({ selected: false, reason: "specialist_guidance_disabled", binding: null, profile: null });
  if (intent.primaryDomain === null) return Object.freeze({ selected: false, reason: "ambiguous_or_unresolved_domain", binding: null, profile: null });
  if (intent.primaryDomain !== "personal_budgeting") return Object.freeze({ selected: false, reason: "unrelated_domain", binding: null, profile: null });
  const profile = registry.get(BUDGETING_GUIDANCE_PROFILE_ID, BUDGETING_GUIDANCE_PROFILE_VERSION);
  if (profile === undefined) return Object.freeze({ selected: false, reason: "profile_unavailable", binding: null, profile: null });
  const binding: SpecialistGuidanceBinding = Object.freeze({
    intentVersionId: intent.intentVersionId,
    profileId: profile.profileId,
    profileVersion: profile.version,
    profileHash: hashSpecialistGuidanceProfile(profile),
    resolutionReasonCode: "matched_primary_domain",
  });
  return Object.freeze({ selected: true, reason: "matched_primary_domain", binding, profile });
}

function renderList(title: string, items: readonly string[]): readonly string[] {
  return items.length === 0 ? [] : [title, ...items.map((item) => `- ${item}`)];
}

export function compileSpecialistGuidanceControl(profile: SpecialistGuidanceProfile): CanonicalModelMessage {
  const content = [
    "LATTICE SPECIALIST GUIDANCE — TRUSTED PROTOTYPE CONTROL",
    "This is Product-owned prototype guidance. It is not canonical Intent Authority state and it does not acquire V36 Truth Core, Lattice Decision Engine, tool, permission, or production authority.",
    `Guidance profile: ${profile.profileId}@${profile.version}`,
    `User-facing label: ${profile.userFacingLabel}`,
    `Domain: ${profile.domain}`,
    `Purpose: ${profile.purpose}`,
    ...renderList("Procedure:", profile.procedure),
    ...renderList("Clarification guidance:", profile.clarificationGuidance),
    ...renderList("Excluded scopes:", profile.excludedScopes),
    ...renderList("Presentation guidance:", profile.presentationGuidance),
    ...renderList("Authority boundary:", profile.authorityBoundary),
    ...renderList("Security boundary:", profile.securityBoundary),
  ].join("\n");
  return Object.freeze({ role: "system", content });
}

export function specialistGuidanceAudit(
  intent: PrototypeIntentVersionFixture | undefined,
  resolution: SpecialistGuidanceResolution | undefined,
): SpecialistGuidanceAudit {
  if (intent === undefined || resolution === undefined) return Object.freeze({
    prototypeFixture: true,
    selected: false,
    intentVersionId: null,
    profileId: null,
    profileVersion: null,
    profileHash: null,
    resolutionReasonCode: "fixture_not_supplied",
  });
  if (!resolution.selected) return Object.freeze({
    prototypeFixture: true,
    selected: false,
    intentVersionId: intent.intentVersionId,
    profileId: null,
    profileVersion: null,
    profileHash: null,
    resolutionReasonCode: resolution.reason,
  });
  return Object.freeze({
    prototypeFixture: true,
    selected: true,
    intentVersionId: resolution.binding.intentVersionId,
    profileId: resolution.binding.profileId,
    profileVersion: resolution.binding.profileVersion,
    profileHash: resolution.binding.profileHash,
    resolutionReasonCode: resolution.binding.resolutionReasonCode,
  });
}
