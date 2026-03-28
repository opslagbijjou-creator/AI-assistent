const SESSION_STORAGE_KEY = "ai-receptionist-session";
const FIXED_WEBHOOK_URL =
  "https://hamzaautopilot.app.n8n.cloud/webhook/fed39b97-d19a-41c1-b924-f9a6856ef1e4";

const chatWindow = document.getElementById("chatWindow");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const newSessionBtn = document.getElementById("newSessionBtn");
const messageTemplate = document.getElementById("messageTemplate");

const state = {
  sessionId: crypto.randomUUID(),
};
let typingMessageNode = null;

loadSession();
renderMessage(
  "assistant",
  "Welkom! De chat gebruikt nu altijd jouw vaste webhook."
);

chatForm.addEventListener("submit", onSubmitMessage);
newSessionBtn.addEventListener("click", resetSession);

function loadSession() {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const saved = JSON.parse(raw);
    if (typeof saved.sessionId === "string" && saved.sessionId.trim().length > 0) {
      state.sessionId = saved.sessionId;
    }
  } catch {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

function resetSession() {
  state.sessionId = crypto.randomUUID();
  persistSession();
  renderMessage("system", "Nieuwe chatsessie gestart.");
}

async function onSubmitMessage(event) {
  event.preventDefault();

  const text = messageInput.value.trim();
  if (!text) {
    return;
  }

  renderMessage("user", text);
  messageInput.value = "";

  setLoading(true);
  showTypingIndicator();

  try {
    const payload = {
      chatInput: text,
      message: text,
      sessionId: state.sessionId,
      callId: state.sessionId,
    };

    const response = await fetch(FIXED_WEBHOOK_URL, {
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
        `API gaf een lege response (HTTP ${response.status}). Endpoint: ${FIXED_WEBHOOK_URL}`
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
      data?.output || data?.response || data?.message || "Geen antwoord ontvangen.";
    const normalizedAssistantText = normalizeAssistantText(assistantText, data);

    if (typeof data?.sessionId === "string" && data.sessionId.trim().length > 0) {
      state.sessionId = data.sessionId;
      persistSession();
    }

    hideTypingIndicator();
    renderMessage("assistant", normalizedAssistantText);

    if (data?.appointmentBooked) {
      const emailText = data?.customerEmail
        ? `Afspraak bevestigd voor: ${data.customerEmail}`
        : "Afspraak bevestigd.";
      renderMessage("system", emailText);
    }
  } catch (error) {
    hideTypingIndicator();
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

function normalizeAssistantText(text, data) {
  const safeText = typeof text === "string" ? text.trim() : "";

  if (safeText === "firstEntryJson") {
    return "De n8n chat-trigger heeft nog geen vervolgstappen. Verbind de trigger met een AI node (bijv. AI Agent + OpenAI Model).";
  }

  if (!safeText && data && typeof data === "object" && Object.keys(data).length === 0) {
    return "Leeg antwoord van n8n. Controleer of je workflow na de trigger nog nodes heeft.";
  }

  return safeText || "Geen antwoord ontvangen.";
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function persistSession() {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ sessionId: state.sessionId })
  );
}

function setLoading(loading) {
  sendBtn.disabled = loading;
  messageInput.disabled = loading;
  sendBtn.textContent = loading ? "Verzenden..." : "Verstuur";
}

function renderMessage(role, text, options = {}) {
  const fragment = messageTemplate.content.cloneNode(true);
  const node = fragment.querySelector(".message");
  const author = fragment.querySelector(".message-author");
  const content = fragment.querySelector(".message-text");
  const time = fragment.querySelector(".message-time");

  const authorByRole = {
    user: "Jij",
    assistant: "AI Receptionist",
    system: "Systeem",
  };

  node.classList.add(`message-${role}`);
  if (options.typing) {
    node.classList.add("message-typing");
  }
  author.textContent = authorByRole[role] ?? "Bericht";
  content.textContent = text;
  time.textContent = options.typing ? "Nu" : formatTime(new Date());

  chatWindow.appendChild(fragment);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return node;
}

function showTypingIndicator() {
  hideTypingIndicator();
  typingMessageNode = renderMessage("assistant", "AI typt...", { typing: true });
}

function hideTypingIndicator() {
  if (!typingMessageNode) {
    return;
  }
  typingMessageNode.remove();
  typingMessageNode = null;
}

function formatTime(date) {
  return date.toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
