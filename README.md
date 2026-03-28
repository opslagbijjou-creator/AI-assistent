# AI Receptionist (Netlify-ready)

Dit project draait zonder n8n en is klaar voor Netlify deploy.

## Structuur

- `public/` frontend
- `netlify/functions/chat-assistent.js` API endpoint
- `server.js` lokale server + gedeelde chatlogica

## 1) Installeren

```bash
cd '/Users/m/Desktop/AI assistent'
npm install
```

## 2) Environment instellen

```bash
cp .env.example .env
```

Minimaal nodig:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
TIMEZONE=Europe/Amsterdam
```

## 3) Lokaal draaien

```bash
npm run dev
```

Open: `http://localhost:3000`

## Netlify deploy

Deze app gebruikt op Netlify:
- `public` als publish dir
- Netlify Function op `/.netlify/functions/chat-assistent`
- Redirect: `/api/chat-assistent` -> function

### Stap voor stap

1. Login op Netlify:
   ```bash
   npx netlify login
   ```
2. Link of maak site:
   ```bash
   npx netlify init
   ```
3. Zet env vars in Netlify dashboard:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL`
   - `TIMEZONE`
   - optioneel: Google/SMTP/Slack vars
4. Deploy productie:
   ```bash
   npm run netlify:deploy
   ```

## GitHub push

`gh` CLI staat hier niet geïnstalleerd, dus automatisch repo aanmaken is niet gelukt. Wel klaar met lokale git-commands:

```bash
cd '/Users/m/Desktop/AI assistent'
git init
git add .
git commit -m "Initial AI receptionist (Netlify ready)"
```

Maak daarna op GitHub een lege repo en koppel remote:

```bash
git branch -M main
git remote add origin https://github.com/<jouw-gebruiker>/<jouw-repo>.git
git push -u origin main
```

## API contract

Request naar `/api/chat-assistent`:

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
