# MemoryTube

MemoryTube is a small Next.js MVP for saving YouTube links, summarizing transcripts with OpenAI, and asking questions over saved videos.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth and Postgres
- OpenAI for summaries, embeddings, and Q&A
- pgvector through Supabase for simple RAG

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` from `.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
OPENAI_API_KEY=your-openai-api-key
OPENAI_SUMMARY_MODEL=gpt-4.1-mini
OPENAI_CHAT_MODEL=gpt-4.1-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_VISION_MODEL=gpt-4.1-mini
```

3. In Supabase, open SQL Editor and run `supabase/schema.sql`.

4. In Supabase Auth settings, enable email/password auth. For fastest local testing, disable email confirmation.

5. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## MVP Flow

1. Create an account or log in.
2. Save a YouTube URL.
3. If captions are available, MemoryTube fetches them and summarizes the video.
4. If captions are unavailable, paste a transcript manually on the video detail page.
5. Ask questions on the chat page. Answers are generated only from your saved video data.

## E2E Test Questions

Use these prompts after saving and summarizing a few videos:

- 이 영상 핵심 요약해줘
- 내가 저장한 AI 영상들 공통점 알려줘
- 전기자전거 관련 영상만 정리해줘
- 이 영상에서 조심해야 할 점 알려줘
- 방금 말한 내용 더 쉽게 설명해줘

## Database

The schema creates:

- `users`
- `videos`
- `transcripts`
- `summaries`
- `video_chunks`
- `openai_usage_logs`
- `match_video_chunks` RPC for vector search

Row-level security is enabled so users can only access their own rows.

## OpenAI Usage Safety

The MVP includes basic cost protection before calling OpenAI:

- Transcript summarization clips very long transcripts.
- Chat requests limit the number of chunks and total context size.
- Summary and chat responses set `max_tokens`.
- OpenAI calls are logged to `openai_usage_logs` with estimated input/output sizes.
- Usage sizes are estimates for debugging, not exact billing numbers.

## Vercel Deployment

### Root Directory

If your GitHub repository root does not directly contain this app's `package.json`, set the Vercel Root Directory to:

```text
youtube ai
```

Vercel must see this folder as the project root because this is where `package.json`, `next.config.ts`, `src/app`, and `vercel.json` live. If your GitHub repository root is already this folder, leave Root Directory empty.

### 1. Prepare Supabase

1. Create a production Supabase project.
2. In Supabase SQL Editor, run the full contents of `supabase/schema.sql`.
3. In Authentication > Providers, enable Email.
4. In Authentication > URL Configuration, set:
   - Site URL: `https://your-vercel-domain.vercel.app`
   - Redirect URL: `https://your-vercel-domain.vercel.app/dashboard`
5. If you use a custom domain later, add the same production URLs for that domain too.
6. Keep the anon key public. Do not add a service role key to Vercel for this MVP.

### 2. Configure Vercel Environment Variables

Add these variables in Vercel Project Settings > Environment Variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-production-anon-key
OPENAI_API_KEY=your-openai-api-key
OPENAI_SUMMARY_MODEL=gpt-4.1-mini
OPENAI_CHAT_MODEL=gpt-4.1-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_VISION_MODEL=gpt-4.1-mini
```

Notes:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` must point to the production Supabase project, not local Supabase.
- `OPENAI_VISION_MODEL` is configured for future use, but visual frame analysis is not part of this MVP yet.
- `NEXT_PUBLIC_SITE_URL` is not required by the current app.

### 3. Deploy

1. Push the project to GitHub.
2. In Vercel, import the GitHub repository.
3. Use the default Next.js build settings:
   - Install command: `npm install`
   - Build command: `npm run build`
   - Output directory: leave default
4. Add the environment variables above for Production.
5. Deploy.
6. Open the Vercel URL and create a test account.
7. Save one YouTube URL with captions, confirm summary generation, then ask a chat question.

### 4. Deployment Checklist

- [ ] Supabase production project created
- [ ] Supabase project URL copied to `NEXT_PUBLIC_SUPABASE_URL`
- [ ] Supabase anon key copied to `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] OpenAI API key added as `OPENAI_API_KEY`
- [ ] Supabase `schema.sql` applied successfully
- [ ] Supabase Email auth enabled
- [ ] Supabase Site URL set to the Vercel production URL
- [ ] Supabase Redirect URL includes `https://your-vercel-domain.vercel.app/dashboard`
- [ ] Vercel environment variables configured for Production
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] Deployed app can sign up, log in, save a YouTube URL, summarize, and chat

## Notes

- YouTube transcript fetching depends on publicly available captions and can fail.
- Video title and thumbnail use YouTube oEmbed when available.
- This MVP processes summaries synchronously in the API request.
- The app uses the Supabase anon key and RLS; no service role key is required.
- Vercel serverless request limits may affect very long videos because this MVP processes summaries during the API request.

## TODO

- TODO: Move video processing to a background job before production.
- TODO: Add retry controls for failed summaries.
- TODO: Add better transcript import options.
- TODO: Add chunk deletion from the UI when deleting videos.
- TODO: Add tests around URL parsing and RAG fallback behavior.

## Out of Scope

- Payments
- Mobile app
- Chrome extension
- Automatic YouTube history sync
