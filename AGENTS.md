# AGENTS.md

## Project intent

Wahl is Deric Garza's intentionally small personal wall: a quiet place for short thoughts, observations, and things worth keeping. Preserve the restrained, personal character of the site. Do not turn it into a conventional portfolio, social network, dashboard, or content-management system unless explicitly requested.

## Stack

- React with Vite
- Plain CSS
- Supabase Auth and Postgres
- OpenAI Sites static hosting, configured in `.openai/hosting.json`
- npm and `package-lock.json`

## Common commands

```bash
npm install
npm run dev
npm run build
npm run preview
```

There is currently no separate lint or test script. At minimum, run `npm run build` after source changes.

## Project map

- `src/App.jsx` — the complete wall UI, authentication flow, and post interactions
- `src/styles.css` — foundational styles
- `src/production.css` — production visual layer
- `src/data.js` — representative posts used by local preview mode
- `src/supabase.js` — Supabase client and configuration detection
- `database/schema.sql` — tables, constraints, helper function, grants, and row-level security policies
- `.env.example` — required public environment-variable names
- `.openai/hosting.json` — Sites deployment configuration; the deployable output is `dist`

## Product and design principles

- Keep the experience minimal, calm, warm, and typography-led.
- Preserve the single-page wall unless the requested feature clearly needs another route.
- Favor thoughtful spacing and plain language over decorative UI or added navigation.
- Keep authoring controls quiet and secondary to the public reading experience.
- Maintain responsive, keyboard-accessible behavior and meaningful labels.
- Avoid speculative features and new dependencies when browser-native or existing-stack solutions are sufficient.

## Data and authentication rules

- Public visitors may read only posts whose `audience_type` is `everyone`.
- Only users registered in `site_owners` may read private posts or modify the wall.
- Ownership and privacy must be enforced by Supabase row-level security, not only hidden in the UI.
- Keep post text between 1 and 320 characters and preserve the `private` / `everyone` audience values.
- When changing data behavior, update both the application code and `database/schema.sql` as needed.
- Treat the Supabase publishable key as client-safe configuration, but never commit passwords, service-role keys, access tokens, or `.env.local`.

## Local and production behavior

- With Supabase variables present, Wahl uses the live backend.
- Without them, development mode uses the interactive sample wall.
- A production build without Supabase variables is intentionally read-only.
- Environment variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Keep `.env.example` aligned with any configuration changes.

## Change discipline

- Read the relevant source and preserve existing behavior before editing.
- Keep changes focused; do not reformat unrelated files or overwrite user work.
- Preserve the existing package manager, architecture, and hosting configuration.
- Never weaken row-level security to make a UI feature work.
- For database changes, prefer idempotent SQL that is safe to rerun in the Supabase SQL editor.
- Do not edit generated `dist` files by hand.

## Validation and deployment

Before handing off a code change:

1. Run `npm run build`.
2. Check the affected experience locally when interaction or layout changed.
3. Confirm that no secrets or `.env.local` were added to Git.
4. If publishing was requested, deploy the built `dist` output through the existing OpenAI Sites project and verify the live URL.

Do not deploy merely because source files changed; deploy when the user asks to publish or when deployment is explicitly part of the task.
