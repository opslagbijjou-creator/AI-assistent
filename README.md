# AI Receptionist (zonder n8n)

Dit project draait volledig zelfstandig:
- Frontend chat UI
- Eigen Node.js backend
- OpenAI agent met tools (prijzen, beschikbaarheid, boeken, bevestigingsmail)

## 1) Installeren

```bash
cd '/Users/m/Desktop/AI assistent'
npm install
```

## 2) Environment instellen

```bash
cp .env.example .env
```

Zet minimaal dit in `.env`:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
PORT=3000
TIMEZONE=Europe/Amsterdam
```

## 3) Starten

```bash
npm run dev
```

Open daarna:

```text
http://localhost:3000
```

## API endpoint

De frontend praat standaard met:

```text
POST /api/chat-assistent
```

Payload:

```json
{
  "message": "Ik wil morgen om 13:00 boeken",
  "sessionId": "uuid",
  "callId": "uuid"
}
```

Response:

```json
{
  "sessionId": "uuid",
  "response": "...",
  "appointmentBooked": false,
  "customerEmail": ""
}
```

## Optionele integraties

### Google Calendar (echte beschikbaarheid + boeken)

Vul in `.env`:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_CALENDAR_ID=primary
```

Zonder deze waarden gebruikt de app een veilige simulatie voor agenda-acties.

### SMTP (bevestigingsmail)

Vul in `.env`:

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

Zonder deze waarden simuleert de app het versturen van e-mail.

### Slack notificaties

Vul in `.env`:

```env
SLACK_WEBHOOK_URL=
```

## Troubleshooting

- `OPENAI_API_KEY ontbreekt`: zet je key in `.env` en herstart de server.
- Geen echte agenda of mail: controleer of je Google/SMTP env vars gevuld zijn.
- Poort al in gebruik: pas `PORT` aan in `.env`.

