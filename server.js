const crypto = require("crypto");
const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TIMEZONE = process.env.TIMEZONE || "Europe/Amsterdam";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const sessions = new Map();
const services = {
  standaard: 50,
  premium: 100,
  deluxe: 150,
};

let smtpTransporter;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post(["/api/chat-assistent", "/webhook/chat-assistent"], async (req, res) => {
  try {
    const payload = await processChatPayload(req.body || {});
    return res.json(payload);
  } catch (error) {
    console.error("[chat-assistent]", error);
    const status = Number(error?.statusCode || 500);
    return res.status(status).json(normalizeError(error));
  }
});

app.get("/api/health", (_req, res) => {
  res.json(getHealthPayload());
});

app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function startServer() {
  return app.listen(PORT, () => {
    console.log(`AI Receptionist draait op http://localhost:${PORT}`);
    if (!process.env.OPENAI_API_KEY) {
      console.warn("Waarschuwing: OPENAI_API_KEY ontbreekt. Chat endpoint werkt nog niet.");
    }
  });
}

if (require.main === module) {
  startServer();
}

async function processChatPayload(input) {
  const message = String(input?.message || "").trim();
  const sessionId = String(input?.sessionId || input?.callId || "").trim() || crypto.randomUUID();

  if (!message) {
    throw makeHttpError(400, "message is verplicht");
  }

  if (!openai) {
    throw makeHttpError(500, "OPENAI_API_KEY ontbreekt", "Zet OPENAI_API_KEY in je .env bestand");
  }

  const result = await runAssistant({ sessionId, userMessage: message });

  return {
    sessionId,
    response: result.response,
    appointmentBooked: result.appointmentBooked,
    customerEmail: result.customerEmail,
  };
}

function getHealthPayload() {
  return { ok: true, model: OPENAI_MODEL, timezone: TIMEZONE };
}

function makeHttpError(statusCode, message, details = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function normalizeError(error) {
  return {
    error: error instanceof Error ? error.message : "Interne serverfout",
    details: error?.details || (error instanceof Error ? error.message : String(error)),
  };
}

module.exports = {
  processChatPayload,
  getHealthPayload,
  normalizeError,
};


async function runAssistant({ sessionId, userMessage }) {
  const session = getSession(sessionId);
  session.lastBooking = null;
  session.messages.push({ role: "user", content: userMessage });
  trimHistory(session);

  const systemMessage = {
    role: "system",
    content: buildSystemPrompt(),
  };

  for (let i = 0; i < 8; i += 1) {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.3,
      messages: [systemMessage, ...session.messages],
      tools: TOOL_DEFINITIONS,
      tool_choice: "auto",
    });

    const assistantMessage = completion.choices?.[0]?.message;
    if (!assistantMessage) {
      throw new Error("Geen assistant-antwoord ontvangen van OpenAI.");
    }

    if (assistantMessage.tool_calls?.length) {
      session.messages.push({
        role: "assistant",
        content: assistantMessage.content || "",
        tool_calls: assistantMessage.tool_calls,
      });

      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function?.name;
        const toolArgs = safeJsonParse(toolCall.function?.arguments || "{}");
        const toolResult = await runTool({ session, toolName, toolArgs });

        session.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }

      trimHistory(session);
      continue;
    }

    const responseText = normalizeAssistantContent(assistantMessage.content);
    session.messages.push({ role: "assistant", content: responseText });
    trimHistory(session);

    return {
      response: responseText,
      appointmentBooked: Boolean(session.lastBooking?.appointmentBooked),
      customerEmail: session.lastBooking?.customerEmail || "",
    };
  }

  throw new Error("Maximale tool-iteraties bereikt zonder definitief antwoord.");
}

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      messages: [],
      lastBooking: null,
    });
  }
  return sessions.get(sessionId);
}

function trimHistory(session) {
  const MAX_MESSAGES = 24;
  if (session.messages.length > MAX_MESSAGES) {
    session.messages = session.messages.slice(-MAX_MESSAGES);
  }
}

function buildSystemPrompt() {
  const now = new Date().toLocaleString("nl-NL", { timeZone: TIMEZONE });
  return [
    "Je bent een professionele receptionist-assistent.",
    `Huidige lokale tijd (${TIMEZONE}): ${now}.`,
    "Taken:",
    "1) Beantwoord klantvragen vriendelijk en duidelijk.",
    "2) Gebruik get_pricing voor prijsvragen.",
    "3) Gebruik check_availability alleen met ISO 8601 tijden.",
    "4) Gebruik book_appointment alleen nadat klant expliciet bevestigt.",
    "5) Vraag altijd e-mail op voor definitieve boeking.",
    "6) Gebruik send_confirmation_email na succesvolle boeking.",
    "Belangrijk: als details ontbreken (datum, duur, e-mail, reden), stel eerst gerichte vragen.",
    "Gebruik Nederlands tenzij klant iets anders vraagt.",
  ].join("\n");
}

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "get_pricing",
      description: "Geef prijsinformatie over diensten.",
      parameters: {
        type: "object",
        properties: {
          service: {
            type: "string",
            description: "Dienstnaam, bijv. standaard, premium, deluxe",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Controleert of een tijdslot beschikbaar is.",
      parameters: {
        type: "object",
        properties: {
          startTime: {
            type: "string",
            description: "Starttijd in ISO 8601, bijv 2026-03-29T13:00:00+02:00",
          },
          endTime: {
            type: "string",
            description: "Eindtijd in ISO 8601, bijv 2026-03-29T14:00:00+02:00",
          },
        },
        required: ["startTime", "endTime"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_appointment",
      description: "Plant een afspraak in de agenda.",
      parameters: {
        type: "object",
        properties: {
          startTime: {
            type: "string",
            description: "Starttijd in ISO 8601",
          },
          endTime: {
            type: "string",
            description: "Eindtijd in ISO 8601",
          },
          attendeeEmail: {
            type: "string",
            description: "E-mail van de klant",
          },
          title: {
            type: "string",
            description: "Titel voor de afspraak",
          },
          description: {
            type: "string",
            description: "Beschrijving van de afspraak",
          },
        },
        required: ["startTime", "endTime", "attendeeEmail", "title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_confirmation_email",
      description: "Verstuur bevestigingsmail naar klant.",
      parameters: {
        type: "object",
        properties: {
          customerEmail: {
            type: "string",
            description: "Ontvanger e-mail",
          },
          subject: {
            type: "string",
            description: "Onderwerp",
          },
          body: {
            type: "string",
            description: "Mailinhoud",
          },
        },
        required: ["customerEmail", "subject", "body"],
        additionalProperties: false,
      },
    },
  },
];

async function runTool({ session, toolName, toolArgs }) {
  switch (toolName) {
    case "get_pricing":
      return handleGetPricing(toolArgs);
    case "check_availability":
      return handleCheckAvailability(toolArgs);
    case "book_appointment":
      return handleBookAppointment({ session, toolArgs });
    case "send_confirmation_email":
      return handleSendConfirmationEmail(toolArgs);
    default:
      return { ok: false, error: `Onbekende tool: ${toolName}` };
  }
}

function handleGetPricing({ service }) {
  const key = typeof service === "string" ? service.trim().toLowerCase() : "";

  if (key && services[key] != null) {
    return {
      ok: true,
      service: key,
      price: services[key],
      currency: "EUR",
      text: `${capitalize(key)} dienst - €${services[key]}`,
    };
  }

  return {
    ok: true,
    services: Object.entries(services).map(([name, price]) => ({ name, price, currency: "EUR" })),
    text: "Beschikbare diensten: Standaard (€50), Premium (€100), Deluxe (€150)",
  };
}

async function handleCheckAvailability({ startTime, endTime }) {
  const startIso = validateIsoDate(startTime, "startTime");
  const endIso = validateIsoDate(endTime, "endTime");
  ensureValidRange(startIso, endIso);

  const calendar = getGoogleCalendarClient();
  if (!calendar) {
    return {
      ok: true,
      available: true,
      mode: "simulated",
      startTime: startIso,
      endTime: endIso,
      text: "Geen Google Calendar credentials gevonden, beschikbaarheid is gesimuleerd als beschikbaar.",
    };
  }

  const listResult = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
    timeMin: startIso,
    timeMax: endIso,
    singleEvents: true,
    maxResults: 3,
    orderBy: "startTime",
  });

  const conflicts = (listResult.data.items || []).map((event) => ({
    id: event.id,
    summary: event.summary || "Bezet",
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
  }));

  return {
    ok: true,
    available: conflicts.length === 0,
    mode: "google_calendar",
    startTime: startIso,
    endTime: endIso,
    conflicts,
  };
}

async function handleBookAppointment({ session, toolArgs }) {
  const startIso = validateIsoDate(toolArgs.startTime, "startTime");
  const endIso = validateIsoDate(toolArgs.endTime, "endTime");
  ensureValidRange(startIso, endIso);
  const attendeeEmail = validateEmail(toolArgs.attendeeEmail);
  const title = String(toolArgs.title || "Afspraak").trim();
  const description = String(toolArgs.description || "").trim();

  const calendar = getGoogleCalendarClient();

  let booking;
  if (!calendar) {
    booking = {
      ok: true,
      appointmentBooked: true,
      mode: "simulated",
      eventId: `sim-${crypto.randomUUID()}`,
      startTime: startIso,
      endTime: endIso,
      attendeeEmail,
      title,
    };
  } else {
    const created = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
      requestBody: {
        summary: title,
        description,
        start: { dateTime: startIso },
        end: { dateTime: endIso },
        attendees: [{ email: attendeeEmail }],
      },
    });

    booking = {
      ok: true,
      appointmentBooked: true,
      mode: "google_calendar",
      eventId: created.data.id,
      eventLink: created.data.htmlLink || "",
      startTime: startIso,
      endTime: endIso,
      attendeeEmail,
      title,
    };
  }

  session.lastBooking = {
    appointmentBooked: true,
    customerEmail: attendeeEmail,
  };

  await sendSlackNotification({
    session,
    title,
    attendeeEmail,
    startIso,
    endIso,
  });

  return booking;
}

async function handleSendConfirmationEmail({ customerEmail, subject, body }) {
  const to = validateEmail(customerEmail);
  const safeSubject = String(subject || "Bevestiging afspraak").trim();
  const safeBody = String(body || "Uw afspraak is bevestigd.").trim();

  const transporter = getSmtpTransporter();
  if (!transporter) {
    return {
      ok: true,
      sent: false,
      mode: "simulated",
      to,
      subject: safeSubject,
      text: "Geen SMTP ingesteld, mail is gesimuleerd.",
    };
  }

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: safeSubject,
    text: safeBody,
  });

  return {
    ok: true,
    sent: true,
    mode: "smtp",
    messageId: info.messageId,
    to,
  };
}

function getGoogleCalendarClient() {
  const hasGoogleCreds =
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN;

  if (!hasGoogleCreds) {
    return null;
  }

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  return google.calendar({ version: "v3", auth });
}

function getSmtpTransporter() {
  if (smtpTransporter) {
    return smtpTransporter;
  }

  const hasSmtpCreds =
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS;

  if (!hasSmtpCreds) {
    return null;
  }

  smtpTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return smtpTransporter;
}

async function sendSlackNotification({ session, title, attendeeEmail, startIso, endIso }) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    return;
  }

  const text = [
    "Nieuwe afspraak bevestigd",
    `Sessie: ${findSessionId(session)}`,
    `Klant: ${attendeeEmail}`,
    `Titel: ${title}`,
    `Start: ${startIso}`,
    `Eind: ${endIso}`,
  ].join("\n");

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (error) {
    console.warn("Slack notificatie mislukt:", error instanceof Error ? error.message : error);
  }
}

function findSessionId(session) {
  for (const [id, candidate] of sessions.entries()) {
    if (candidate === session) {
      return id;
    }
  }
  return "onbekend";
}

function validateIsoDate(value, fieldName) {
  const raw = String(value || "").trim();
  const parsed = new Date(raw);

  if (!raw || Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} moet een geldige ISO 8601 datum/tijd zijn.`);
  }

  return parsed.toISOString();
}

function validateEmail(value) {
  const email = String(value || "").trim();
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  if (!regex.test(email)) {
    throw new Error("Ongeldig e-mailadres ontvangen.");
  }

  return email;
}

function ensureValidRange(startIso, endIso) {
  if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
    throw new Error("endTime moet later zijn dan startTime.");
  }
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalizeAssistantContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part?.type === "text") {
          return part.text || "";
        }
        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function capitalize(value) {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}
