import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { solandraPresentationPlacementSchema } from "../src/solandra/cognition.js";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";

const POINTER = "I’ve put the full answer in the Composer. It’s general knowledge, not verified.";
const SUFFIX = "General knowledge — not verified.";

interface Turn {
  role: "user" | "solandra";
  text: string;
}

interface Harness {
  turns: Turn[];
  composerWrites: string[];
  submit: (event: { preventDefault(): void }) => void;
  setInput: (value: string) => void;
}

function createStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
}

function conversationScript(): string {
  const html = renderSolandraAuthoritativeConversationPage();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((match) => match[1] ?? "");
  const script = scripts.find((source) => source.includes('body.status === "CONVERSATION_COMPLETED"'));
  assert.ok(script, "Expected the canonical conversation browser script.");
  return script as string;
}

type AuthorityMode = "realistic" | "authoritative" | "absent";
/** "absent" models a replayed or legacy turn that carries no placement decision. */
type PlacementDecision = "TURN" | "COMPOSER_FULL_ANSWER" | "absent";

// Realistic authority fields for the conversation path, matching
// src/consultation-intake.ts: the persisted conversation response carries
// factualAuthority:false and the public cognition report carries
// factualAuthority:false alongside the turn-scoped presentationPlacement.
// The "authoritative" variant is synthetic (real conversation responses are
// always non-authoritative per conversation-response-store.ts); "absent" is the
// legacy stub shape with no authority fields at all.
function authorityFields(mode: AuthorityMode): Record<string, unknown> {
  if (mode === "absent") return { interpretation: {} };
  const factualAuthority = mode === "realistic" ? false : true;
  return {
    interpretation: {
      authority: "NON_AUTHORITATIVE_CONVERSATION",
      factualAuthority,
      mode: "CONVERSATION",
    },
    conversationResponse: {
      responseId: "resp-test-1",
      sourceMessageId: "msg-test-1",
      origin: "SOLANDRA",
      authority: "NON_AUTHORITATIVE_CONVERSATION",
      factualAuthority,
      createdAt: "2026-09-28T00:00:00.000Z",
    },
  };
}

function turnBody(
  assistantMessage: unknown,
  mode: AuthorityMode,
  placement: PlacementDecision,
): Record<string, unknown> {
  const authority = authorityFields(mode);
  return {
    status: "CONVERSATION_COMPLETED",
    presentation: { assistantMessage },
    ...authority,
    ...(placement === "absent"
      ? {}
      : {
        interpretation: {
          ...(authority.interpretation as Record<string, unknown>),
          presentationPlacement: placement,
        },
      }),
  };
}

function createHarness(
  assistantMessage: unknown,
  mode: AuthorityMode = "realistic",
  placement: PlacementDecision = "absent",
): Harness {
  const turns: Turn[] = [];
  const composerWrites: string[] = [];
  let submitHandler: ((event: { preventDefault(): void }) => void) | null = null;
  let inputValue = "";

  const conversationNode = {
    scrollLeft: 0,
    scrollWidth: 0,
    appendChild(node: { className?: unknown; textContent?: unknown }) {
      const className = String(node.className ?? "");
      turns.push({
        role: className.includes("user") ? "user" : "solandra",
        text: String(node.textContent ?? ""),
      });
      return node;
    },
    replaceChildren() {},
  };
  const composerNode = {
    set innerHTML(value: unknown) {
      composerWrites.push(String(value));
    },
    get innerHTML() {
      return composerWrites.at(-1) ?? "";
    },
    replaceChildren() {},
    setAttribute() {},
  };
  const inputNode = {
    get value() {
      return inputValue;
    },
    set value(next: unknown) {
      inputValue = String(next);
    },
    disabled: false,
    focus() {},
    addEventListener() {},
  };
  const buttonNode = () => ({
    hidden: true,
    disabled: false,
    addEventListener() {},
  });
  const formNode = {
    addEventListener(type: string, handler: (event: { preventDefault(): void }) => void) {
      if (type === "submit") submitHandler = handler;
    },
  };
  const elements = new Map<string, unknown>([
    ["conversation", conversationNode],
    ["conversationForm", formNode],
    ["conversationInput", inputNode],
    ["sendButton", buttonNode()],
    ["stopButton", buttonNode()],
    ["composer", composerNode],
  ]);
  const documentStub = {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: () => ({
      className: "",
      textContent: "",
      setAttribute() {},
    }),
  };
  const fetchStub = async (url: unknown) => {
    const target = String(url);
    if (target === "/api/v1/conversations") {
      return { ok: true, status: 200, json: async () => ({ conversation: { id: "conv-1" } }) };
    }
    if (target === "/api/v1/conversations/conv-1/turns") {
      return {
        ok: true,
        status: 200,
        json: async () => turnBody(assistantMessage, mode, placement),
      };
    }
    throw new Error(`unexpected fetch: ${target}`);
  };
  const windowStub = {
    ownerFetch: fetchStub,
    localStorage: createStorage(),
    sessionStorage: createStorage(),
  };

  vm.runInNewContext(conversationScript(), {
    window: windowStub,
    document: documentStub,
    crypto: { randomUUID: () => "turn-test-1" },
    setTimeout,
    clearTimeout,
  });

  assert.ok(submitHandler, "Expected the conversation submit handler to be registered.");
  return {
    turns,
    composerWrites,
    submit: (event: { preventDefault(): void }) => (submitHandler as (event: { preventDefault(): void }) => void)(event),
    setInput: (value: string) => { inputValue = value; },
  };
}

async function runTurn(
  assistantMessage: unknown,
  mode: AuthorityMode = "realistic",
  placement: PlacementDecision = "absent",
): Promise<Harness> {
  const harness = createHarness(assistantMessage, mode, placement);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  harness.setInput("Please explain this topic.");
  harness.submit({ preventDefault() {} });
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (harness.turns.length >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return harness;
}

const solandraTurns = (harness: Harness): Turn[] => harness.turns.filter((turn) => turn.role === "solandra");

// A short ordinary answer. Nothing about its length or shape qualifies it for
// the Composer, so only an explicit COMPOSER_FULL_ANSWER decision can move it.
const SHORT_ANSWER = "A quieter espresso shot usually wants a finer grind and a slightly cooler basket.";

// A long, heavily structured reference. This is exactly the shape a lexical
// heuristic used to move, so it proves the decision — not the shape — controls
// placement in both directions.
function buildLongChecklist(): string {
  const steps = [
    "Book the van for a morning slot rather than a full day, because loading and unloading together is the part that eats the clock on a two-bedroom move.",
    "Sort everything into keep, donate, and rubbish before the van arrives, and get rid of the rubbish early, because anything still in a box on the day is a box you carry twice.",
    "Label each box by room and by floor rather than by contents, because the people carrying them rarely know what a box marked kitchen things actually holds.",
    "Protect the breakables in the middle of each box with towels or paper, since weight settles downward and the corners are what give way first in a hard stop.",
    "Disassemble the bed frame and the wardrobe if either has a large flat panel, because those pieces are far safer to move flat than trying to walk them through a doorway upright.",
    "Measure the fridge before you move it and again at the new place, since a fridge that will not fit through the hall is the one problem that cannot be solved on the day.",
    "Change the water filter and run the tap for a couple of minutes once the kitchen is connected, because the pipes will taste of everything that has been sitting in them.",
    "Unpack the kitchen and the bathroom first so the first evening in the new place is workable, and leave the books and the decor until the rooms are actually live.",
  ];
  const intro = "Here is a moving routine that usually fits in a single morning. It assumes a two-bedroom flat, a stair on the way out, and no lift on the way in. Work through the parts in order and do not leave the final check until the boxes are unpacked.";
  return `${intro}\n\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`;
}

test("placement is a closed enum", () => {
  assert.equal(solandraPresentationPlacementSchema.options.length, 2);
  assert.equal(solandraPresentationPlacementSchema.parse("TURN"), "TURN");
  assert.equal(solandraPresentationPlacementSchema.parse("COMPOSER_FULL_ANSWER"), "COMPOSER_FULL_ANSWER");
  // Any other decision space, including the lexical shape words the removed
  // heuristic used, is rejected so placement can never be inferred.
  for (const rejected of ["INFO_DUMP", "COMPOSER", "composer_full_answer", "AUTO", ""]) {
    assert.throws(
      () => solandraPresentationPlacementSchema.parse(rejected),
      `placement must reject ${JSON.stringify(rejected)}`,
    );
  }
});

test("the rendered conversation script carries no lexical placement heuristic", () => {
  const script = conversationScript();
  assert.doesNotMatch(script, /isInfoDumpMessage|INFO_DUMP_LENGTH_THRESHOLD|INFO_DUMP_SECTION_THRESHOLD|infoDumpSectionPattern/iu);
});

test("an explicit COMPOSER_FULL_ANSWER decision moves a short answer to the Composer with a one-line pointer in the turn", async () => {
  const harness = await runTurn(SHORT_ANSWER, "realistic", "COMPOSER_FULL_ANSWER");
  const solandra = solandraTurns(harness);

  assert.equal(solandra.length, 1, "the turn must keep a single Solandra message");
  assert.equal(solandra[0]?.text, POINTER);
  assert.ok(!(solandra[0]?.text ?? "").includes("\n"), "the pointer must stay one line");

  assert.equal(harness.composerWrites.length, 1, "the full answer must be written to the Composer once");
  const composer = harness.composerWrites[0] ?? "";
  assert.ok(composer.includes("General knowledge — not verified"), "Composer frame must stay clearly tentative");
  assert.ok(composer.includes("not established fact"), "Composer frame must carry zero authority cues");
  assert.ok(composer.includes("finer grind"), "Composer must carry the full answer text");
  assert.ok(!composer.includes("<textarea"), "ordinary answers are presentation, not editable drafts");
});

test("an explicit COMPOSER_FULL_ANSWER decision moves a long reference with the full answer escaped and framed as tentative", async () => {
  const message = `${buildLongChecklist()}\n\nKeep the fridge upright and avoid <strong>tilting</strong> it on the way.`;

  const harness = await runTurn(message, "realistic", "COMPOSER_FULL_ANSWER");
  const solandra = solandraTurns(harness);

  assert.equal(solandra.length, 1);
  assert.equal(solandra[0]?.text, POINTER);

  assert.equal(harness.composerWrites.length, 1, "the full answer must be written to the Composer once");
  const composer = harness.composerWrites[0] ?? "";
  assert.ok(composer.includes("Book the van for a morning slot"), "Composer must carry the opening answer text");
  assert.ok(composer.includes("leave the books and the decor"), "Composer must carry the closing answer text");
  assert.ok(composer.includes("&lt;strong&gt;"), "Composer answer text must be escaped");
  assert.ok(!composer.includes("<strong>"), "Composer must not inject raw answer markup");
  // Scoped to the prepared-resource evidence vocabulary (the
  // preparedResourceTrustRendering headings named in
  // solandra-authoritative-conversation-page.ts), not the tentative-answer frame.
  assert.doesNotMatch(composer, /Established support|Evidence refutes|Evidence remains conflicted|No external evidence/iu);
});

test("a TURN decision keeps a long structured answer in the turn: shape alone never moves it", async () => {
  const message = buildLongChecklist();
  assert.ok(message.length > 1500, "the long fixture must exceed any length a lexical rule could have used");

  const harness = await runTurn(message, "realistic", "TURN");
  const solandra = solandraTurns(harness);

  assert.equal(solandra.length, 1);
  assert.equal(solandra[0]?.text, `${message}\n\n${SUFFIX}`);
  assert.equal(harness.composerWrites.length, 0, "a TURN decision must leave the Composer untouched");
});

test("a turn carrying no placement decision stays in the turn even when long and structured", async () => {
  // Replayed and legacy turns carry no decision because the decision is
  // turn-scoped and never persisted. They must render exactly as before.
  const message = buildLongChecklist();

  const harness = await runTurn(message, "realistic", "absent");
  const solandra = solandraTurns(harness);

  assert.equal(solandra.length, 1);
  assert.equal(solandra[0]?.text, `${message}\n\n${SUFFIX}`);
  assert.equal(harness.composerWrites.length, 0, "an absent decision must not reach the Composer");
});

test("a TURN decision keeps a short answer in the turn with the non-authoritative suffix", async () => {
  const harness = await runTurn(SHORT_ANSWER, "realistic", "TURN");
  const solandra = solandraTurns(harness);

  assert.equal(solandra.length, 1);
  assert.equal(solandra[0]?.text, `${SHORT_ANSWER}\n\n${SUFFIX}`);
  assert.equal(harness.composerWrites.length, 0, "turn answers must not touch the Composer");
});

test("a COMPOSER_FULL_ANSWER decision never moves an authoritative or authority-absent answer", async () => {
  // Behavior decision: placement changes only for known-non-authoritative
  // content. An authoritative (or authority-absent) answer keeps legacy
  // placement even when Solandra asks for the Composer.
  const message = buildLongChecklist();

  for (const mode of ["authoritative", "absent"] as const) {
    const harness = await runTurn(message, mode, "COMPOSER_FULL_ANSWER");
    const solandra = solandraTurns(harness);

    assert.equal(solandra.length, 1, `mode ${mode}: the turn must keep a single Solandra message`);
    assert.equal(solandra[0]?.text, message, `mode ${mode}: placement alone must not move the answer`);
    assert.equal(harness.composerWrites.length, 0, `mode ${mode}: the Composer must stay untouched`);
  }
});

test("a moved answer is marked once: frame in the Composer, pointer turn without the suffix", async () => {
  const message = buildLongChecklist();

  const harness = await runTurn(message, "realistic", "COMPOSER_FULL_ANSWER");
  const solandra = solandraTurns(harness);

  assert.equal(solandra.length, 1, "the turn must keep a single Solandra message");
  assert.equal(solandra[0]?.text, POINTER);
  assert.ok(!(solandra[0]?.text ?? "").includes("Book the van for a morning slot"), "full answer text must stay out of the turn");
  assert.ok(!(solandra[0]?.text ?? "").includes("leave the books and the decor"), "closing answer text must stay out of the turn");

  assert.equal(harness.composerWrites.length, 1, "the full answer must be written to the Composer once");
  const composer = harness.composerWrites[0] ?? "";
  const stemCount = composer.split("General knowledge — not verified").length - 1;
  assert.equal(stemCount, 1, "the stem must mark the Composer frame exactly once");
  const turnStemCount = (solandra[0]?.text ?? "").split("General knowledge — not verified").length - 1;
  assert.equal(turnStemCount, 0, "the pointer turn bypasses the suffix stem");
  assert.ok(!(solandra[0]?.text ?? "").endsWith(SUFFIX), "the Composer path must bypass the turn suffix");
});

test("empty answer keeps the existing error path", async () => {
  const harness = await runTurn("   ", "realistic", "COMPOSER_FULL_ANSWER");
  const solandra = solandraTurns(harness);

  assert.equal(solandra.length, 1);
  assert.equal(solandra[0]?.text, "Solandra returned no usable response.");
  assert.equal(harness.composerWrites.length, 0, "the error path must not write to the Composer");
});
