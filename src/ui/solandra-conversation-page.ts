export function renderSolandraConversationPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lattice</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f4ef;
      color: #171713;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #f5f4ef; }
    button, textarea { font: inherit; }
    .shell { width: min(920px, 100%); min-height: 100vh; margin: 0 auto; display: flex; flex-direction: column; padding: 18px 18px 28px; }
    header { padding: 4px 2px 14px; }
    .brand { font-weight: 760; letter-spacing: -0.03em; font-size: 1.15rem; }
    #conversation { min-height: 54px; display: flex; gap: 10px; align-items: center; overflow-x: auto; padding: 4px 2px 10px; scrollbar-width: thin; }
    .turn { flex: 0 0 auto; max-width: min(76vw, 620px); padding: 9px 12px; border: 1px solid #d9d6ca; border-radius: 16px; background: #fffefa; line-height: 1.35; font-size: .92rem; white-space: pre-wrap; }
    .turn.user { border-color: #b8b4a7; }
    .turn.solandra { border-color: transparent; background: transparent; padding-left: 2px; }
    .input-wrap { position: sticky; top: 0; z-index: 2; padding: 0 0 14px; background: linear-gradient(#f5f4ef 80%, rgba(245,244,239,0)); }
    .input-box { display: flex; gap: 9px; align-items: flex-end; border: 1px solid #c8c4b8; border-radius: 18px; background: #fffefa; padding: 10px; box-shadow: 0 8px 24px rgba(30,29,24,.05); }
    textarea { width: 100%; min-height: 48px; max-height: 180px; resize: vertical; border: 0; outline: 0; background: transparent; color: inherit; line-height: 1.42; padding: 4px 5px; }
    textarea::placeholder { color: #8a877d; }
    .send { flex: 0 0 auto; border: 0; border-radius: 12px; background: #22211c; color: #fff; padding: 10px 14px; cursor: pointer; }
    .send:disabled { opacity: .42; cursor: default; }
    #composer { flex: 1; min-height: 390px; border: 1px solid #d9d6ca; border-radius: 24px; background: #fffefa; padding: clamp(18px, 4vw, 34px); box-shadow: 0 14px 42px rgba(30,29,24,.045); }
    #composer h1 { margin: 0 0 8px; font-size: clamp(1.35rem, 4vw, 2rem); letter-spacing: -0.035em; }
    #composer h2 { margin: 26px 0 9px; font-size: 1rem; }
    #composer p { line-height: 1.58; margin: 8px 0; }
    #composer ul { margin: 8px 0 0; padding-left: 20px; }
    #composer li { margin: 7px 0; line-height: 1.48; }
    .muted { color: #6b6960; }
    .finding { padding: 12px 0; border-bottom: 1px solid #ece9df; }
    .finding:last-child { border-bottom: 0; }
    .finding-status { display: inline-block; margin-bottom: 4px; color: #6b6960; font-size: .77rem; letter-spacing: .035em; }
    .evidence { margin: 8px 0 0; padding-left: 14px; border-left: 2px solid #e2ded2; color: #55534c; font-size: .88rem; }
    .source-list { display: grid; gap: 9px; padding: 0; list-style: none; }
    .source-list li { margin: 0; padding: 11px 12px; border: 1px solid #e2ded2; border-radius: 12px; }
    .source-list a { color: #282722; text-underline-offset: 3px; }
    .source-meta { color: #6b6960; font-size: .8rem; margin-top: 4px; }
    .resource { margin-top: 24px; padding: 17px; border: 1px solid #cbc7ba; border-radius: 17px; background: #f8f7f2; }
    .resource textarea { min-height: 170px; margin-top: 9px; border: 1px solid #d9d6ca; border-radius: 12px; background: #fffefa; padding: 12px; }
    .error { color: #7d271f; }
    @media (max-width: 620px) {
      .shell { padding: 10px 10px 18px; }
      header { padding: 4px 4px 10px; }
      #conversation { min-height: 48px; }
      .turn { max-width: 84vw; }
      #composer { min-height: 330px; border-radius: 20px; padding: 20px 17px; }
      .input-box { border-radius: 16px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div class="brand">Solandra</div>
    </header>
    <section id="conversation" aria-label="Conversation" aria-live="polite"></section>
    <form id="conversationForm" class="input-wrap">
      <div class="input-box">
        <textarea id="conversationInput" aria-label="Conversation input" placeholder="What do you need to figure out?" rows="2"></textarea>
        <button id="sendButton" class="send" type="submit">Send</button>
      </div>
    </form>
    <section id="composer" aria-live="polite">
      <h1>What do you need to figure out?</h1>
      <p class="muted">Describe the question, objective, situation, or thing you want prepared. Lattice will keep decision support optional rather than forcing every consultation into a comparison.</p>
    </section>
  </main>
  <script>
    (() => {
      const conversation = document.getElementById("conversation");
      const form = document.getElementById("conversationForm");
      const input = document.getElementById("conversationInput");
      const sendButton = document.getElementById("sendButton");
      const composer = document.getElementById("composer");
      let conversationId = null;
      let pending = false;
      let composing = false;
      let pendingClarification = null;
      let composerHasProductContent = false;

      const escapeHtml = (value) => String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

      const appendTurn = (text, role) => {
        const node = document.createElement("div");
        node.className = "turn " + role;
        node.setAttribute("aria-label", role === "user" ? "You" : "Solandra");
        node.textContent = text;
        conversation.appendChild(node);
        conversation.scrollLeft = conversation.scrollWidth;
      };

      const appendUserTurn = (text) => appendTurn(text, "user");
      const appendSolandraTurn = (text) => appendTurn(text, "solandra");

      const setPending = (value) => {
        pending = value;
        input.disabled = value;
        sendButton.disabled = value;
        composer.setAttribute("aria-busy", String(value));
      };

      const isExplicitConfirmation = (message) => /^(?:yes|yes please|yes,? (?:that'?s|that is) (?:right|correct)|confirmed|confirm|that'?s right|that'?s correct|correct|apply it|use that)\\.?$/iu
        .test(message.trim().replace(/\\s+/g, " "));

      const ensureConversation = async () => {
        if (conversationId) return conversationId;
        const response = await fetch("/api/v1/conversations", { method: "POST" });
        if (!response.ok) throw new Error("Could not start the conversation.");
        const body = await response.json();
        conversationId = body.conversation.id;
        return conversationId;
      };

      const renderKnowledge = (knowledge) => {
        const sources = new Map((knowledge.provenance || []).map((source) => [source.sourceId, source]));
        const findings = knowledge.findings.length
          ? knowledge.findings.map((finding) => '<div class="finding">'
            + '<div class="finding-status">' + escapeHtml(finding.status)
            + (finding.basis === "SOURCE_REPORT" ? ' SOURCE REPORT' : '')
            + ' · ' + escapeHtml(finding.confidence) + ' confidence</div>'
            + '<div>' + escapeHtml(finding.text) + '</div>'
            + (knowledge.evidence || []).filter((item) => item.claimId === finding.claimId).map((item) => {
              const source = sources.get(item.sourceId);
              return '<div class="evidence">'
                + escapeHtml(item.admitted ? (item.relation === "CONTRADICTS" ? "Contradicting evidence" : "Supporting evidence") : "Not admitted")
                + (source ? ' · ' + escapeHtml(source.title || source.canonicalUri) : '')
                + '<br>' + escapeHtml(item.excerpt)
                + (!item.admitted && item.rejectionReason ? '<br>' + escapeHtml(item.rejectionReason) : '')
                + '</div>';
            }).join("")
            + '</div>').join("")
          : "";
        const uncertainties = knowledge.uncertainties.length
          ? '<h2>What remains uncertain</h2><ul>' + knowledge.uncertainties.map((item) => '<li>' + escapeHtml(item) + '</li>').join("") + '</ul>'
          : "";
        const provenance = (knowledge.provenance || []).length
          ? '<h2>Sources</h2><ul class="source-list">' + knowledge.provenance.map((source) => '<li>'
            + '<a href="' + escapeHtml(source.canonicalUri) + '" target="_blank" rel="noreferrer">' + escapeHtml(source.title || source.canonicalUri) + '</a>'
            + '<div class="source-meta">' + escapeHtml(source.publisher || "Publisher not established")
            + ' · retrieved ' + escapeHtml(source.retrievedAt) + '</div></li>').join("") + '</ul>'
          : "";
        return '<h1>' + escapeHtml(knowledge.acceptedUnderstanding) + '</h1>' + findings + uncertainties + provenance;
      };

      const renderOutcome = (outcome) => {
        composerHasProductContent = true;
        if (outcome.kind === "KNOWLEDGE") {
          composer.innerHTML = renderKnowledge(outcome);
          const supported = outcome.findings.filter((finding) => finding.status === "SUPPORTED").length;
          appendSolandraTurn(supported > 0
            ? "I found " + supported + " supported source report" + (supported === 1 ? "" : "s")
              + " and kept the evidence, sources, and uncertainty visible in the Composer."
            : "I couldn’t establish supported knowledge from the available sources. The Composer shows what remains unresolved.");
          return;
        }
        if (outcome.kind === "ACTION_PREPARATION") {
          composer.innerHTML = '<div class="resource"><h1>' + escapeHtml(outcome.resource.title) + '</h1><p>Review and edit this before using it.</p><textarea aria-label="Prepared resource">' + escapeHtml(outcome.resource.body) + '</textarea></div>';
          appendSolandraTurn("I prepared editable material in the Composer. Nothing has been sent or executed.");
          return;
        }
        composer.innerHTML = renderKnowledge(outcome.knowledge);
        appendSolandraTurn(outcome.explanation || "I’ve put the available decision support in the Composer. No selection or action has been authorized.");
      };

      const pollOutcome = async (runId) => {
        for (;;) {
          const response = await fetch("/api/v1/runs/" + encodeURIComponent(runId) + "/outcome");
          const body = await response.json();
          if (response.status === 202) {
            await new Promise((resolve) => setTimeout(resolve, 120));
            continue;
          }
          if (!response.ok) throw new Error(body.message || body.error || "Consultation failed.");
          renderOutcome(body.outcome);
          return;
        }
      };

      const submit = async () => {
        if (pending || composing) return;
        const message = input.value;
        if (!message.trim()) return;
        const draft = message;
        setPending(true);
        appendUserTurn(message);
        if (!composerHasProductContent) composer.replaceChildren();
        input.value = "";
        try {
          const id = await ensureConversation();
          const clarification = pendingClarification;
          const confirmsPending = clarification && isExplicitConfirmation(message);
          const response = await fetch(confirmsPending
            ? "/api/v1/conversations/" + encodeURIComponent(id) + "/clarifications/" + encodeURIComponent(clarification.proposalId) + "/confirm"
            : "/api/v1/conversations/" + encodeURIComponent(id) + "/turns", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ turnId: crypto.randomUUID(), message }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.message || body.error || "Consultation intake failed.");
          if (body.status === "NEEDS_CLARIFICATION") {
            pendingClarification = body.proposalId ? { proposalId: body.proposalId } : null;
            appendSolandraTurn(body.proposalId
              ? body.question + "\\n\\nReply with “" + body.confirmationExample + "” to confirm, or state a correction normally."
              : body.question);
            return;
          }
          pendingClarification = null;
          await pollOutcome(body.runId);
        } catch (error) {
          input.value = draft;
          appendSolandraTurn("I couldn’t complete that turn. "
            + (error instanceof Error ? error.message : "Unknown error")
            + " Your draft has been restored.");
        } finally {
          setPending(false);
          input.focus();
        }
      };

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void submit();
      });
      input.addEventListener("compositionstart", () => { composing = true; });
      input.addEventListener("compositionend", () => { composing = false; });
      input.addEventListener("keydown", (event) => {
        if (event.isComposing || composing) return;
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void submit();
        }
      });
      input.focus();
    })();
  </script>
</body>
</html>`;
}
