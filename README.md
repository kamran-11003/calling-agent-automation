## VoiceFlow — Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- Twilio account
- Supabase project
- OpenAI or Anthropic API key
- ElevenLabs or Cartesia API key

---

### 1. Backend Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt

# Copy and fill in .env
cp .env.example .env
```

Run Supabase schema:
- Open your Supabase project → SQL Editor → paste `schema.sql` → Run

Start backend:
```bash
uvicorn main:app --reload --port 8000
```

Expose to internet (for Twilio webhooks) using ngrok:
```bash
ngrok http 8000
```
Copy the ngrok URL → set it as `APP_URL` in `.env` → restart backend.

---

### 2. Twilio Setup

1. Go to Twilio Console → Phone Numbers → Active Numbers
2. Click your number → Voice Configuration
3. Set **"A call comes in"** webhook to: `https://YOUR_NGROK_URL/twilio/inbound`
4. Method: `HTTP POST`

---

### 3. Frontend Setup

```bash
cd frontend
cp .env.local.example .env.local
# Fill in NEXT_PUBLIC_API_URL with your backend URL
npm run dev
```

Open http://localhost:3000

---

### 4. Create Your First Agent

1. Open http://localhost:3000
2. Click Settings (gear icon) → enter your OpenAI API key
3. Type in the Copilot: *"Create a lead generation agent for [your business]"*
4. Watch the form fill automatically
5. Add your LLM API key and TTS API key in the Voice & AI section
6. Enter your Twilio phone number
7. Click **Save Agent**
8. Call your Twilio number — the agent will answer!

---

### 5. View Leads

Go to http://localhost:3000/dashboard to see all calls, transcripts, and extracted lead data.
