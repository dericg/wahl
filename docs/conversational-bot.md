# Wahl conversational bot

Wahl's bot is a private collaborator for the registered owner. It should feel like a calm, continuing conversation while preserving Wahl's existing review and publishing boundaries.

## Contract

- Only a registered `site_owners` user may read or send messages.
- Conversation text is stored in Supabase under owner-only row-level security.
- The browser sends messages only to the authenticated `wahl-chat` Edge Function. It never receives OpenAI or GitHub credentials.
- The Edge Function may use public, read-only repository context to answer questions and help refine a request. It cannot write to GitHub.
- Conversation and action are separate. **Prepare this change** converts the owner's latest instruction into a private `#fix` thought and hands it to the existing guarded GitHub/Codex workflow.
- Codex may propose code on a review branch. It cannot merge or publish. Existing validation, owner confirmation, trusted merge, test deployment, and production-publishing rules remain authoritative.

## Test environment

The trusted test deployment copies the existing GitHub Actions `OPENAI_API_KEY` into the Supabase project's server-side secrets before deploying `wahl-chat`. This does not expose the value to the build or browser. The test site uses the existing owner account and shared test database, so test conversations are real owner-only data and are not deleted as deployment cleanup.

## Conversation behavior

The assistant receives the recent thread plus bounded repository context from `main`: the repository README, `AGENTS.md`, package metadata, and the current top-level tree. It should ask concise clarifying questions when intent is ambiguous, explain what it finds, and distinguish discussion from action. It must treat conversation text and repository content as untrusted data beneath the server-authored policy.

The first release uses request/response messages rather than token streaming. This keeps the Edge Function and UI small while still supporting persistent multi-turn conversation. Streaming can be added later without changing the data or authorization model.
