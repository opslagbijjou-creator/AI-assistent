const STORAGE_KEY = "ai-receptionist-settings";
const DEFAULT_WEBHOOK_URL =
  window.location.origin.startsWith("http")
    ? `${window.location.origin}/api/chat-assistent`
    : "http://localhost:3000/api/chat-assistent";

const chatWindow = document.getElementById("chatWindow");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const webhookUrlInput = document.getElementById("webhookUrl");
const newSessionBtn = document.getElementById("newSessionBtn");
const messageTemplate = document.getElementById("messageTemplate");

const state = {
  webhookUrl: DEFAULT_WEBHOOK_URL,
  sessionId: crypto.randomUUID(),
};

loadSettings();
renderMessage(
  "assistant",
  "Welkom! Je eigen backend staat klaar, we kunnen direct chatten."
);

chatForm.addEventListener("submit", onSubmitMessage);
saveSettingsBtn.addEventListener("click", saveSettings);
newSessionBtn.addEventListener("click", resetSession);

function loadSettings() {
  webhookUrlInput.value = state.webhookUrl;

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const saved = JSON.parse(raw);
    if (typeof saved.webhookUrl === "string") {
      const savedUrl = saved.webhookUrl.trim();
      state.webhookUrl = savedUrl || DEFAULT_WEBHOOK_URL;
      webhookUrlInput.value = state.webhookUrl;
    }
    if (typeof saved.sessionId === "string" && saved.sessionId.trim().length > 0) {
      state.sessionId = saved.sessionId;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  // Diagnose veelvoorkomende migratie-fout: oude n8n webhook nog in localStorage.
  if (state.webhookUrl.includes("n8n.cloud/webhook")) {
    renderMessage(
      "system",
      "Let op: je gebruikt nog een n8n webhook URL. Als je naar Netlify bent gemigreerd, zet API URL op /api/chat-assistent."
    );
  }
}

function saveSettings() {
  state.webhookUrl = webhookUrlInput.value.trim();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ webhookUrl: state.webhookUrl, sessionId: state.sessionId })
  );
  renderMessage("system", "API URL opgeslagen.");
}

function resetSession() {
  state.sessionId = crypto.randomUUID();
  persistState();
  renderMessage("system", "Nieuwe chatsessie gestart.");
}

async function onSubmitMessage(event) {
  event.preventDefault();

  const text = messageInput.value.trim();
  if (!text) {
    return;
  }

  if (!state.webhookUrl) {
    renderMessage("system", "Vul eerst je API URL in.");
    return;
  }

  renderMessage("user", text);
  messageInput.value = "";

  setLoading(true);

  try {
    const payload = {
      message: text,
      sessionId: state.sessionId,
      callId: state.sessionId,
    };

    const response = await fetch(state.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawBody = await response.text();
    const parsed = parseResponseBody(rawBody);

    if (!response.ok) {
      const serverMessage = extractServerError(parsed, rawBody);
      throw new Error(
        `Server antwoordde met status ${response.status}.${serverMessage ? ` ${serverMessage}` : ""}`
      );
    }

    if (!rawBody.trim()) {
      throw new Error(
        `API gaf een lege response (HTTP ${response.status}). Endpoint: ${state.webhookUrl}`
      );
    }

    if (!parsed.ok) {
      throw new Error(
        `API gaf geen geldige JSON terug (HTTP ${response.status}). Eerste data: ${truncate(
          rawBody,
          220
        )}`
      );
    }

    const data = parsed.data;
    const assistantText =
      data?.response || data?.output || data?.message || "Geen antwoord ontvangen.";

    if (typeof data?.sessionId === "string" && data.sessionId.trim().length > 0) {
      state.sessionId = data.sessionId;
      persistState();
    }

    renderMessage("assistant", assistantText);

    if (data?.appointmentBooked) {
      const emailText = data?.customerEmail
        ? `Afspraak bevestigd voor: ${data.customerEmail}`
        : "Afspraak bevestigd.";
      renderMessage("system", emailText);
    }
  } catch (error) {
    renderMessage(
      "system",
      `Fout bij versturen: ${getErrorMessage(
        error
      )}\nControleer je backend logs (en je Google/SMTP/Slack integraties).`
    );
  } finally {
    setLoading(false);
    messageInput.focus();
  }
}

function parseResponseBody(rawBody) {
  try {
    return { ok: true, data: JSON.parse(rawBody) };
  } catch {
    return { ok: false, data: null };
  }
}

function extractServerError(parsed, rawBody) {
  if (parsed.ok) {
    const apiMessage =
      parsed.data?.message || parsed.data?.error || parsed.data?.details || parsed.data?.hint;
    if (typeof apiMessage === "string" && apiMessage.trim()) {
      return apiMessage.trim();
    }
  }

  const trimmed = rawBody.trim();
  if (!trimmed) {
    return "";
  }
  return truncate(trimmed, 200);
}

function truncate(value, max) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function persistState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ webhookUrl: state.webhookUrl, sessionId: state.sessionId })
  );
}

function setLoading(loading) {
  sendBtn.disabled = loading;
  messageInput.disabled = loading;
  sendBtn.textContent = loading ? "Verzenden..." : "Verstuur";
}

function renderMessage(role, text) {
  const fragment = messageTemplate.content.cloneNode(true);
  const node = fragment.querySelector(".message");
  const author = fragment.querySelector(".message-author");
  const content = fragment.querySelector(".message-text");

  const authorByRole = {
    user: "Jij",
    assistant: "AI Receptionist",
    system: "Systeem",
  };

  node.classList.add(`message-${role}`);
  author.textContent = authorByRole[role] ?? "Bericht";
  content.textContent = text;

  chatWindow.appendChild(fragment);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}
