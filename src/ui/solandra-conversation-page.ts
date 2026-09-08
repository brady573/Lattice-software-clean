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
    .send, .stop { flex: 0 0 auto; border-radius: 12px; padding: 10px 14px; cursor: pointer; }
    .send { border: 0; background: #22211c; color: #fff; }
    .stop { border: 1px solid #b8b4a7; background: #fffefa; color: #282722; }
    .send:disabled, .stop:disabled { opacity: .42; cursor: default; }
    .stop[hidden] { display: none; }
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
    @media (max-width: 620px) {
      .shell { padding: 10px 10px 18px; }
      header { padding: 4px 4px 10px; }
      #conversation { min-height: 48px; }
      .turn { max-width: 84vw; }
      #composer { min-height: 330px; border-radius: 20px; padding: 20px 17px; }
      .input-box { border-radius: 16px; flex-wrap: wrap; }
      .input-box textarea { flex-basis: 100%; }
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
        <button id="stopButton" class="stop" type="button" hidden>Stop</button>
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
      const stopButton = document.getElementById("stopButton");
      const composer = document.getElementById("composer");
      const STORAGE = Object.freeze({
        conversation: "lattice.solandra.conversation.v1",
        pendingTurn: "lattice.solandra.pending-turn.v1",
        activeWork: "lattice.solandra.active-work.v1",
        clarification: "lattice.solandra.clarification.v1",
        draft: "lattice.solandra.draft.v1",
      });
      const ACTIVE_RUN_STATUSES = new Set(["CREATED", "UNDERSTANDING", "PLANNING", "INVESTIGATING", "VALIDATING", "DECIDING"]);
      let conversationId = null;
      let pending = false;
      let composing = false;
      let recovering = false;
      let pendingClarification = null;
      let composerHasProductContent = false;
      let activeWork = null;
      let pollGeneration = 0;

      const escapeHtml = (value) => String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
      const normalizedText = (value) => String(value).trim().replace(/\\s+/gu, " ");
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const storageGet = (key) => {
        try { return window.localStorage.getItem(key); } catch { return null; }
      };
      const storageSet = (key, value) => {
        try { window.localStorage.setItem(key, value); } catch {}
      };
      const storageRemove = (key) => {
        try { window.localStorage.removeItem(key); } catch {}
      };
      const readRecord = (key) => {
        const raw = storageGet(key);
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
          storageRemove(key);
          return null;
        }
      };
      const writeRecord = (key, value) => storageSet(key, JSON.stringify(value));

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

      const persistDraft = (value) => {
        if (value.length > 0) storageSet(STORAGE.draft, value);
        else storageRemove(STORAGE.draft);
      };
      const restoreDraft = () => {
        const draft = storageGet(STORAGE.draft);
        if (draft !== null && !input.value) input.value = draft;
      };
      const clearDraftIfSame = (value) => {
        if (input.value === value) input.value = "";
        if (storageGet(STORAGE.draft) === value) storageRemove(STORAGE.draft);
      };

      const setConversation = (id) => {
        conversationId = id;
        if (id) storageSet(STORAGE.conversation, id);
        else storageRemove(STORAGE.conversation);
      };

      const readPendingTurn = () => {
        const record = readRecord(STORAGE.pendingTurn);
        return record
          && typeof record.conversationId === "string"
          && typeof record.turnId === "string"
          && typeof record.message === "string"
          ? record
          : null;
      };
      const storePendingTurn = (record) => writeRecord(STORAGE.pendingTurn, record);
      const clearPendingTurn = (turnId) => {
        const current = readPendingTurn();
        if (!turnId || current?.turnId === turnId) storageRemove(STORAGE.pendingTurn);
      };

      const readActiveWork = () => {
        const record = readRecord(STORAGE.activeWork);
        return record
          && typeof record.conversationId === "string"
          && typeof record.runId === "string"
          && typeof record.message === "string"
          ? record
          : null;
      };
      const setActiveWork = (record, cancellable) => {
        activeWork = record;
        if (record) writeRecord(STORAGE.activeWork, record);
        else storageRemove(STORAGE.activeWork);
        stopButton.hidden = !record || !cancellable;
        stopButton.disabled = !record || !cancellable;
      };
      const clearActiveWork = () => setActiveWork(null, false);

      const readClarification = () => {
        const record = readRecord(STORAGE.clarification);
        return record
          && typeof record.conversationId === "string"
          && typeof record.proposalId === "string"
          ? record
          : null;
      };
      const setClarification = (record) => {
        pendingClarification = record;
        if (record) writeRecord(STORAGE.clarification, record);
        else storageRemove(STORAGE.clarification);
      };

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
        if (!response.ok) throw new Error("I couldn't start a conversation right now. Please try again.");
        const body = await response.json();
        setConversation(body.conversation.id);
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
              const evidenceExcerpt = normalizedText(item.excerpt) === normalizedText(finding.text)
                ? ""
                : '<br>' + escapeHtml(item.excerpt);
              return '<div class="evidence">'
                + escapeHtml(item.admitted ? (item.relation === "CONTRADICTS" ? "Contradicting evidence" : "Supporting evidence") : "Not admitted")
                + (source ? ' · ' + escapeHtml(source.title || source.canonicalUri) : '')
                + evidenceExcerpt
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
        return findings + uncertainties + provenance;
      };

      const renderPreparedResource = (title, body) => {
        composerHasProductContent = true;
        composer.innerHTML = '<div class="resource"><h1>' + escapeHtml(title) + '</h1><p>Review and edit this before using it.</p><textarea aria-label="Prepared resource">' + escapeHtml(body) + '</textarea></div>';
      };

      const renderOutcome = (outcome, presentation, options = {}) => {
        composerHasProductContent = true;
        if (outcome.kind === "KNOWLEDGE") {
          composer.innerHTML = renderKnowledge(outcome);
          const assistantMessage = typeof presentation?.assistantMessage === "string"
            ? presentation.assistantMessage.trim()
            : "";
          if (assistantMessage) appendSolandraTurn(assistantMessage);
          else if (options.recovered) appendSolandraTurn("I restored the latest established Knowledge in the Composer.");
          else throw new Error("Knowledge response presentation is unavailable.");
          return;
        }
        if (outcome.kind === "ACTION_PREPARATION") {
          renderPreparedResource(outcome.resource.title, options.preparedBody ?? outcome.resource.body);
          appendSolandraTurn(options.recovered
            ? "I restored your editable prepared material. Nothing has been sent or executed."
            : "I prepared editable material in the Composer. Nothing has been sent or executed.");
          return;
        }
        composer.innerHTML = renderKnowledge(outcome.knowledge);
        appendSolandraTurn(outcome.explanation || presentation?.assistantMessage || (options.recovered
          ? "I restored the latest established decision support. No selection or action has been authorized."
          : "I’ve put the available decision support in the Composer. No selection or action has been authorized."));
      };

      const productFailureMessage = (status, body) => {
        if (body?.error === "RESOURCE_SCOPE_UNSUPPORTED" && typeof body.message === "string") return body.message;
        if (status === 401 || status === 403 || status === 404) return "I can't recover that conversation for this signed-in user.";
        if (status === 409) return "That work changed before I could finish. I kept the last trustworthy result so you can revise your request and try again.";
        if (status === 422) return "I couldn't complete that request as written. Your draft is still here so you can revise it and try again.";
        return "I couldn't complete that request. Your earlier established result is still available, and you can try again.";
      };

      const responseJson = async (response) => {
        try { return await response.json(); } catch { return {}; }
      };

      const hydrateRecoveredPreparedResource = async (expectedBody) => {
        const presentationResponse = await fetch("/api/v1/conversations/" + encodeURIComponent(conversationId) + "/presentation");
        if (!presentationResponse.ok) throw new Error("I couldn't restore the latest prepared material safely.");
        const snapshot = (await presentationResponse.json()).presentation;
        const descriptor = [...(snapshot.resources || [])].reverse().find((resource) =>
          resource.kind === "generated_artifact"
          && resource.editable === true
          && resource.executionAuthorized === false);
        if (!descriptor) throw new Error("I couldn't restore the latest prepared material safely.");
        const hydratedResponse = await fetch(
          "/api/v1/conversations/" + encodeURIComponent(conversationId)
          + "/presentation/resources/" + encodeURIComponent(descriptor.id)
          + "?presentationRevision=" + encodeURIComponent(snapshot.presentationRevision),
        );
        if (!hydratedResponse.ok) throw new Error("I couldn't restore the latest prepared material safely.");
        const hydrated = (await hydratedResponse.json()).resource;
        if (
          hydrated?.descriptor?.editable !== true
          || hydrated?.descriptor?.executionAuthorized !== false
          || hydrated?.payload?.kind !== "generated_artifact"
          || hydrated.payload.text !== expectedBody
        ) {
          throw new Error("I couldn't restore the latest prepared material safely.");
        }
        return hydrated.payload.text;
      };

      const renderRecoveredRun = async (runId, isLatestRun) => {
        const response = await fetch("/api/v1/runs/" + encodeURIComponent(runId) + "/outcome");
        const body = await responseJson(response);
        if (!response.ok || !body.outcome) return false;
        if (body.outcome.kind === "ACTION_PREPARATION" && isLatestRun) {
          if (
            body.outcome.resource.editable !== true
            || body.outcome.resource.executionAuthorized !== false
            || body.preparationReference?.editable !== true
            || body.preparationReference?.executionAuthorized !== false
          ) {
            throw new Error("I couldn't restore the latest prepared material safely.");
          }
          const hydratedBody = await hydrateRecoveredPreparedResource(body.outcome.resource.body);
          renderOutcome(body.outcome, body.presentation, { recovered: true, preparedBody: hydratedBody });
          return true;
        }
        renderOutcome(body.outcome, body.presentation, { recovered: true });
        return true;
      };

      const restoreLatestUsefulState = async (continuity) => {
        const runs = Array.isArray(continuity?.runs) ? continuity.runs : [];
        const latest = runs.at(-1) ?? null;
        const completed = [...runs].reverse().find((run) => run.status === "COMPLETED" && run.outcomeAvailable === true);
        if (!completed) return false;
        return await renderRecoveredRun(completed.runId, latest?.runId === completed.runId);
      };

      const rebuildConversation = (continuity) => {
        conversation.replaceChildren();
        for (const message of continuity.messages || []) {
          if (message.role === "USER" && typeof message.content === "string") appendUserTurn(message.content);
        }
      };

      const syncCancellationControl = async (work) => {
        const response = await fetch("/api/v1/runs/" + encodeURIComponent(work.runId));
        if (!response.ok) {
          setActiveWork(work, false);
          return null;
        }
        const run = await response.json();
        const cancellable = ACTIVE_RUN_STATUSES.has(run.status);
        setActiveWork(work, cancellable);
        return run;
      };

      const terminalProductMessage = (status) => status === "CANCELLED"
        ? "I stopped that work. Your last trustworthy result is still here."
        : "I couldn't complete that work. I kept the last trustworthy result. Your request is restored so you can revise it and try again.";

      const handleTerminalWork = (status, message, restoreMessage) => {
        clearActiveWork();
        if (status === "FAILED" && restoreMessage) {
          input.value = message;
          persistDraft(message);
        }
        appendSolandraTurn(terminalProductMessage(status));
      };

      const pollOutcome = async (work) => {
        const generation = ++pollGeneration;
        setActiveWork(work, true);
        for (;;) {
          let response;
          try {
            response = await fetch("/api/v1/runs/" + encodeURIComponent(work.runId) + "/outcome");
          } catch {
            if (generation !== pollGeneration) return;
            setActiveWork(work, false);
            appendSolandraTurn("I lost the connection while that work was underway. I’ll resume the same work when the connection is available.");
            const error = new Error("Connection interrupted while work was underway.");
            error.transportUncertain = true;
            error.preserveActiveWork = true;
            throw error;
          }
          const body = await responseJson(response);
          if (generation !== pollGeneration) return;
          if (response.status === 202) {
            await syncCancellationControl(work);
            await sleep(120);
            continue;
          }
          if (response.status === 409 && (body.status === "FAILED" || body.status === "CANCELLED")) {
            handleTerminalWork(body.status, work.message, body.status === "FAILED");
            return;
          }
          if (!response.ok) {
            clearActiveWork();
            input.value = work.message;
            persistDraft(work.message);
            appendSolandraTurn(productFailureMessage(response.status, body));
            return;
          }
          clearDraftIfSame(work.message);
          clearActiveWork();
          renderOutcome(body.outcome, body.presentation);
          return;
        }
      };

      const handleTurnResponse = async (body, record) => {
        if (body.status === "NEEDS_CLARIFICATION") {
          const clarification = body.proposalId ? {
            conversationId: record.conversationId,
            proposalId: body.proposalId,
            question: body.question,
            confirmationExample: body.confirmationExample,
          } : null;
          setClarification(clarification);
          appendSolandraTurn(body.proposalId
            ? body.question + "\\n\\nReply with “" + body.confirmationExample + "” to confirm, or state a correction normally."
            : body.question);
          return;
        }
        setClarification(null);
        if (body.status === "REFERENCE_RESOLVED") {
          renderOutcome(body.knowledge, body.presentation);
          return;
        }
        if (body.status === "RECOMMENDATION_REFERENCE_RESOLVED") {
          const assistantMessage = typeof body.presentation?.assistantMessage === "string"
            ? body.presentation.assistantMessage.trim()
            : "";
          appendSolandraTurn(assistantMessage || "I restored the referenced recommendation without changing its authority.");
          return;
        }
        if (body.status === "NEEDS_NEW_KNOWLEDGE") {
          appendSolandraTurn(body.question || "That needs additional external Knowledge before I can answer it reliably.");
          return;
        }
        if (!body.runId) throw new Error("I couldn't establish the requested work safely.");
        const work = { conversationId: record.conversationId, runId: body.runId, message: record.message };
        setActiveWork(work, true);
        await pollOutcome(work);
      };

      const postTurnRecord = async (record) => {
        const route = record.clarificationProposalId
          ? "/api/v1/conversations/" + encodeURIComponent(record.conversationId) + "/clarifications/" + encodeURIComponent(record.clarificationProposalId) + "/confirm"
          : "/api/v1/conversations/" + encodeURIComponent(record.conversationId) + "/turns";
        let response;
        try {
          response = await fetch(route, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ turnId: record.turnId, message: record.message }),
          });
        } catch {
          const error = new Error("I couldn't confirm whether that request reached Lattice. I'll check that same request before starting anything new. Your draft is restored.");
          error.transportUncertain = true;
          throw error;
        }
        const body = await responseJson(response);
        if (!response.ok) {
          clearPendingTurn(record.turnId);
          const error = new Error(productFailureMessage(response.status, body));
          error.transportUncertain = false;
          throw error;
        }
        clearPendingTurn(record.turnId);
        clearDraftIfSame(record.message);
        await handleTurnResponse(body, record);
      };

      const recoverPendingTurn = async (record) => {
        appendSolandraTurn("I’m checking the request you already sent before starting anything new.");
        await postTurnRecord(record);
      };

      const recoverActiveWork = async (work, continuity) => {
        const response = await fetch("/api/v1/runs/" + encodeURIComponent(work.runId));
        if (response.status === 404) {
          clearActiveWork();
          return false;
        }
        if (!response.ok) throw new Error("I couldn't reconnect to the work already in progress.");
        const run = await response.json();
        if (run.status === "FAILED" || run.status === "CANCELLED") {
          await restoreLatestUsefulState(continuity);
          handleTerminalWork(run.status, work.message, run.status === "FAILED");
          return true;
        }
        appendSolandraTurn(ACTIVE_RUN_STATUSES.has(run.status)
          ? "I’m continuing the work you already started."
          : "I’m restoring the result from the work you already started.");
        setActiveWork(work, ACTIVE_RUN_STATUSES.has(run.status));
        await pollOutcome(work);
        return true;
      };

      const clearStoredConversationState = (id) => {
        if (storageGet(STORAGE.conversation) === id) storageRemove(STORAGE.conversation);
        const pendingTurn = readPendingTurn();
        if (pendingTurn?.conversationId === id) storageRemove(STORAGE.pendingTurn);
        const work = readActiveWork();
        if (work?.conversationId === id) storageRemove(STORAGE.activeWork);
        const clarification = readClarification();
        if (clarification?.conversationId === id) storageRemove(STORAGE.clarification);
        if (conversationId === id) conversationId = null;
      };

      const recoverSession = async () => {
        if (recovering) return;
        recovering = true;
        restoreDraft();
        try {
          const storedId = storageGet(STORAGE.conversation);
          if (!storedId) return;
          let continuityResponse;
          try {
            continuityResponse = await fetch("/api/v1/conversations/" + encodeURIComponent(storedId) + "/continuity");
          } catch {
            appendSolandraTurn("I couldn't reconnect to your saved conversation yet. Your draft is still here, and I won't start duplicate work.");
            return;
          }
          if (continuityResponse.status === 404) {
            clearStoredConversationState(storedId);
            appendSolandraTurn("I couldn't recover that saved conversation for this signed-in user. Your draft is still here.");
            return;
          }
          if (!continuityResponse.ok) {
            appendSolandraTurn("I couldn't reconnect to your saved conversation yet. Your draft is still here, and I won't start duplicate work.");
            return;
          }
          const continuity = await continuityResponse.json();
          setConversation(storedId);
          rebuildConversation(continuity);

          const clarification = readClarification();
          if (clarification?.conversationId === storedId) {
            pendingClarification = clarification;
            if (typeof clarification.question === "string" && clarification.question.trim()) {
              appendSolandraTurn(clarification.question + (clarification.confirmationExample
                ? "\\n\\nReply with “" + clarification.confirmationExample + "” to confirm, or state a correction normally."
                : ""));
            }
          }

          const pendingTurn = readPendingTurn();
          if (pendingTurn?.conversationId === storedId) {
            await restoreLatestUsefulState(continuity);
            await recoverPendingTurn(pendingTurn);
            return;
          }

          const work = readActiveWork();
          if (work?.conversationId === storedId) {
            if (await recoverActiveWork(work, continuity)) return;
          }

          await restoreLatestUsefulState(continuity);
          const latest = Array.isArray(continuity.runs) ? continuity.runs.at(-1) : null;
          if (latest?.status === "CANCELLED" || latest?.status === "FAILED") {
            appendSolandraTurn(terminalProductMessage(latest.status));
          } else if ((continuity.messages || []).length > 0) {
            appendSolandraTurn("I restored this conversation from its saved Product state.");
          }
        } finally {
          recovering = false;
        }
      };

      const stopActiveWork = async () => {
        const work = activeWork;
        if (!work || stopButton.hidden) return;
        stopButton.disabled = true;
        try {
          const response = await fetch("/api/v1/runs/" + encodeURIComponent(work.runId) + "/cancel", { method: "POST" });
          const body = await responseJson(response);
          if (response.status === 202 && body.status === "CANCELLED") {
            pollGeneration += 1;
            clearActiveWork();
            appendSolandraTurn("I stopped that work. Your last trustworthy result is still here.");
            setPending(false);
            input.focus();
            return;
          }
          if (response.status === 409 && body.status === "COMPLETED") {
            setActiveWork(work, false);
            appendSolandraTurn("That work had already finished, so I kept its completed result.");
            return;
          }
          if (response.status === 409 && body.status === "FAILED") {
            pollGeneration += 1;
            handleTerminalWork("FAILED", work.message, true);
            setPending(false);
            input.focus();
            return;
          }
          appendSolandraTurn("I couldn't confirm the stop request, so I’m still watching the existing work rather than starting anything new.");
        } catch {
          appendSolandraTurn("I couldn't confirm the stop request, so I’m still watching the existing work rather than starting anything new.");
        } finally {
          if (!stopButton.hidden) stopButton.disabled = false;
        }
      };

      const submit = async () => {
        if (pending || composing || recovering) return;
        const existingPending = readPendingTurn();
        const existingWork = readActiveWork();
        if (
          (existingPending && (!conversationId || existingPending.conversationId === conversationId))
          || (existingWork && (!conversationId || existingWork.conversationId === conversationId))
        ) {
          setPending(true);
          try { await recoverSession(); }
          catch { appendSolandraTurn("I couldn't reconnect yet. I kept your draft and existing work identity so retry won't become duplicate work."); }
          finally { setPending(false); input.focus(); }
          return;
        }

        const message = input.value;
        if (!message.trim()) return;
        const draft = message;
        setPending(true);
        try {
          const id = await ensureConversation();
          const clarification = pendingClarification;
          const confirmsPending = clarification && isExplicitConfirmation(message);
          const record = {
            conversationId: id,
            turnId: crypto.randomUUID(),
            message,
            ...(confirmsPending ? { clarificationProposalId: clarification.proposalId } : {}),
          };
          storePendingTurn(record);
          appendUserTurn(message);
          if (!composerHasProductContent) composer.replaceChildren();
          input.value = "";
          storageRemove(STORAGE.draft);
          await postTurnRecord(record);
        } catch (error) {
          input.value = draft;
          persistDraft(draft);
          appendSolandraTurn(error instanceof Error
            ? error.message
            : "I couldn't complete that request. Your draft has been restored.");
        } finally {
          setPending(false);
          input.focus();
        }
      };

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void submit();
      });
      stopButton.addEventListener("click", () => { void stopActiveWork(); });
      input.addEventListener("input", () => persistDraft(input.value));
      input.addEventListener("compositionstart", () => { composing = true; });
      input.addEventListener("compositionend", () => { composing = false; });
      input.addEventListener("keydown", (event) => {
        if (event.isComposing || composing) return;
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void submit();
        }
      });

      setPending(true);
      void recoverSession()
        .catch(() => appendSolandraTurn("I couldn't reconnect yet. Your draft is still here, and I won't start duplicate work."))
        .finally(() => {
          setPending(false);
          input.focus();
        });
    })();
  </script>
</body>
</html>`;
}
