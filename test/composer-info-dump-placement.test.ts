import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";

const POINTER = "I’ve put the full answer in the Composer. It’s general knowledge, not verified.";

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
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
  const script = scripts.find((source) => source.includes('body.status === "CONVERSATION_COMPLETED"'));
  assert.ok(script, "Expected the canonical conversation browser script.");
  return script as string;
}

type AuthorityMode = "realistic" | "authoritative" | "absent";

// Realistic authority fields for the conversation path, matching
// src/consultation-intake.ts:951-956: the persisted conversation response carries
// factualAuthority:false and the public cognition reports factualAuthority:false.
// The "authoritative" variant is synthetic (real conversation responses are always
// non-authoritative per conversation-response-store.ts); "absent" is the legacy
// stub shape with no authority fields at all.
function authorityFields(mode: AuthorityMode): Record<string, unknown> {
  if (mode === "absent") return {};
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

function createHarness(assistantMessage: unknown, mode: AuthorityMode = "realistic"): Harness {
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
        json: async () => ({
          status: "CONVERSATION_COMPLETED",
          presentation: { assistantMessage },
          ...authorityFields(mode),
        }),
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

async function runTurn(assistantMessage: unknown, mode: AuthorityMode = "realistic"): Promise<Harness> {
  const harness = createHarness(assistantMessage, mode);
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

function buildLongGuide(): string {
  const steps = [
    "Clean the chain with a stiff brush and a little degreaser, working one section at a time, then wipe it down until the rag comes away mostly clean and no grit remains between the plates.",
    "Check each link for stiff pivots by slowly backpedalling and watching closely for links that skip or hesitate as they travel over the rear teeth under light tension.",
    "Measure chain wear with a gauge on three different spans; replace the chain before it stretches past the marked limit on the tool, since a worn chain quietly damages the cassette.",
    "Apply one drop of lubricant to every roller while turning the cranks backward at a steady pace, keeping oil off the braking surfaces and away from the tire sidewalls.",
    "Let the lubricant soak for several minutes so it can work down into the rollers instead of sitting on the outside plates where it only attracts dust from the road.",
    "Wipe the outside of the chain thoroughly with a clean rag, since excess surface oil only collects grit and turns into grinding paste that wears the drivetrain faster.",
    "Shift through every gear once under gentle load to confirm smooth movement, then recheck the quick link or connecting pin seating before calling the job finished.",
    "Log the date and distance in your maintenance notes so the next inspection happens on schedule, well before wear starts damaging the cassette and chainrings.",
  ];
  const intro = "Here is a full maintenance routine you can follow at home. It takes about half an hour, keeps metal parts <dry>, and avoids the common mistakes that shorten drivetrain life. Work through each part in order and do not skip the final check.";
  return `${intro}\n\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`;
}

test("long ordinary answer moves to the Composer with a one-line pointer in the turn", async () => {
  const message = buildLongGuide();
  assert.ok(message.length > 1500, `long fixture must exceed the info-dump length rule (was ${message.length})`);

  const harness = await runTurn(message);
  const solandra = solandraTurns(harness);

  assert.equal(solandra.length, 1, "the turn must keep a single Solandra message");
  assert.equal(solandra[0]?.text, POINTER);
  assert.ok(!(solandra[0]?.text ?? "").includes("\n"), "the pointer must stay one line");

  assert.equal(harness.composerWrites.length, 1, "the full answer must be written to the Composer once");
  const composer = harness.composerWrites[0] ?? "";
  assert.ok(composer.includes("General knowledge — not verified"), "Composer frame must stay clearly tentative");
  assert.ok(composer.includes("not established fact"), "Composer frame must carry zero authority cues");
  assert.ok(composer.includes("Clean the chain with a stiff brush"), "Composer must carry the full answer text");
  assert.ok(composer.includes("Log the date and distance"), "Composer must carry the closing answer text");
  assert.ok(composer.includes("&lt;dry&gt;"), "Composer answer text must be escaped");
  assert.ok(!composer.includes("<dry>"), "Composer must not inject raw answer markup");
  // Scoped to the prepared-resource evidence vocabulary (the
  // preparedResourceTrustRendering headings named in
  // solandra-authoritative-conversation-page.ts), not the tentative-answer frame.
  assert.doesNotMatch(composer, /Established support|Evidence refutes|Evidence remains conflicted|No external evidence/iu);
  assert.ok(!composer.includes("<textarea"), "ordinary answers are presentation, not editable drafts");
});

test("structured short answer with step-like sections moves to the Composer regardless of topic", async () => {
  const message = "A simple evening tea routine:\n1. Warm the pot with a quick rinse of hot water.\n2. Add one spoon of leaves per cup.\n3. Steep for three minutes, then pour fully so it never overbrews.\n4. Rinse the pot and leave the lid off while it dries.";
  assert.ok(message.length < 1500, "structured fixture must stay below the length rule to isolate the section rule");

  const harness = await runTurn(message);
  const solandra = solandraTurns(harness);

  assert.equal(solandra.length, 1);
  assert.equal(solandra[0]?.text, POINTER);
  assert.equal(harness.composerWrites.length, 1);
  assert.ok((harness.composerWrites[0] ?? "").includes("General knowledge — not verified"));
  assert.ok((harness.composerWrites[0] ?? "").includes("Steep for three minutes"));
});

test("short ordinary answer stays in the turn with the non-authoritative suffix", async () => {
  const message = "Yes — I can help with that.";

  const harness = await runTurn(message);
  const solandra = solandraTurns(harness);

  assert.equal(solandra.length, 1);
  assert.equal(solandra[0]?.text, `${message}\n\nGeneral knowledge — not verified.`);
  assert.equal(harness.composerWrites.length, 0, "short answers must not touch the Composer");
});

test("short two-item list stays in the turn with the non-authoritative suffix", async () => {
  const message = "Two options worth comparing:\n- repair the part\n- replace the part";

  const harness = await runTurn(message);
  const solandra = solandraTurns(harness);

  assert.equal(solandra.length, 1);
  assert.equal(solandra[0]?.text, `${message}\n\nGeneral knowledge — not verified.`);
  assert.equal(harness.composerWrites.length, 0, "below-threshold structure must not touch the Composer");
});

test("empty answer keeps the existing error path", async () => {
  const harness = await runTurn("   ");
  const solandra = solandraTurns(harness);

  assert.equal(solandra.length, 1);
  assert.equal(solandra[0]?.text, "Solandra returned no usable response.");
  assert.equal(harness.composerWrites.length, 0, "the error path must not write to the Composer");
});

test("long non-authoritative answer moves once: frame plus pointer, full text out of the turn", async () => {
  const message = buildLongGuide();

  const harness = await runTurn(message, "realistic");
  const solandra = solandraTurns(harness);

  assert.equal(solandra.length, 1, "the turn must keep a single Solandra message");
  assert.equal(solandra[0]?.text, POINTER);
  assert.ok(!(solandra[0]?.text ?? "").includes("Clean the chain with a stiff brush"), "full answer text must stay out of the turn");
  assert.ok(!(solandra[0]?.text ?? "").includes("Log the date and distance"), "closing answer text must stay out of the turn");

  assert.equal(harness.composerWrites.length, 1, "the full answer must be written to the Composer once");
  const composer = harness.composerWrites[0] ?? "";
  const stemCount = composer.split("General knowledge — not verified").length - 1;
  assert.equal(stemCount, 1, "the stem must mark the Composer frame exactly once");
  const turnStemCount = (solandra[0]?.text ?? "").split("General knowledge — not verified").length - 1;
  assert.equal(turnStemCount, 0, "the pointer turn bypasses the suffix stem");
});

test("long answer with authoritative or absent flags stays in the turn: shape alone never moves it", async () => {
  // Behavior decision: placement changes only for known-non-authoritative content.
  // An authoritative (or authority-absent) long answer keeps legacy placement even
  // when it qualifies on shape alone.
  const message = buildLongGuide();

  for (const mode of ["authoritative", "absent"] as const) {
    const harness = await runTurn(message, mode);
    const solandra = solandraTurns(harness);

    assert.equal(solandra.length, 1, `mode ${mode}: the turn must keep a single Solandra message`);
    assert.equal(solandra[0]?.text, message, `mode ${mode}: shape alone must not move the answer`);
    assert.equal(harness.composerWrites.length, 0, `mode ${mode}: the Composer must stay untouched`);
  }
});
