# DoStudy Buddy v0.1

First working AI-tutor foundation for DoStudy.

## Current scope
Rwanda Coding Academy Year 1 → Applied Physics I → Basic Measurements → Dimensional Analysis.

## Architecture

Student UI → DoStudy Tutor API → Retrieval → AI model → Tutor rules → Response

## Run the backend

1. Install Node.js.
2. Open a terminal in `backend/`.
3. Run:
   `npm install`
4. Copy `.env.example` to `.env`.
5. Add your AI API key to `.env`.
6. Run:
   `npm start`

The API will run on `http://localhost:3001`.

## Test

Health:
`GET http://localhost:3001/api/health`

Tutor:
`POST http://localhost:3001/api/tutor/ask`

JSON body:
{
  "message": "I don't understand dimensional analysis.",
  "history": []
}

## Important

The knowledge base is deliberately narrow for v0.1. We will expand it topic-by-topic from the RCA/school materials instead of dumping the entire archive into the AI.

Do not commit `.env` or API keys to GitHub.
