# Wahl site audit

Requested in issue #45; reviewed on 2026-09-07 against commit `6fe31b58e6b7f90728b349d43ef27c7256d7f58c` (version `0.2.0`).

Wahl already has a clear identity: a single, typography-led wall with quiet owner controls. The most useful next changes are small improvements to readability, navigation, and confidence when posting. This audit proposes follow-up work; it changes no application behavior.

## Scope and evidence

Reviewed the React UI, both CSS layers, feed pagination, editor, public HTML, Supabase client configuration, database access policies, activity callback, and existing tests. Findings below come from source inspection and finite local validation. No browser, live site, live database, deployment, or authenticated owner interaction was exercised. Layout and assistive-technology observations are candidates for manual verification, not a completed accessibility certification or security audit.

Preserve these existing strengths:

- Thoughts and repository activity share the chronological feed, with bounded pagination, retry handling, and build-commit fallbacks when the first activity read fails.
- The editor counts formatting toward the 320-character limit, renders escaped text, and makes submitted `#fix` thoughts private.
- The schema enforces owner access to private thoughts and modifications. Browser roles have only select access to repository activity; its callback checks authentication and payloads before using the service role. These are source-level safeguards; deployed policy state was not checked.
- Controls already include meaningful labels, pressed/expanded states, semantic timestamps, several explicit focus styles, and reduced-motion support.

## Recommended follow-ups, in order

### 1. Make secondary text easier to read

**Observed:** In [production.css](../src/production.css), `.quiet-button` and `.release-history > button` use `#675640` at 9px. Against the nominal header background `#130c08`, that color has approximately **2.75:1** contrast. The `#806c52` used for inactive feed filters has approximately **3.86:1** against the same reference background. Both are below the 4.5:1 target for normal text. The actual header is translucent and the page uses gradients, so final contrast requires measuring rendered backgrounds.

**Smallest enhancement:** Adjust the affected text colors and modestly increase the smallest control labels while retaining the warm palette and secondary placement.

**Acceptance:** Enabled control labels and other normal text meet 4.5:1 against their actual backgrounds in default and interactive states. Check at 200% zoom and a narrow viewport for wrapping and readability; preserve visible keyboard focus.

### 2. Protect against accidental deletion

**Observed:** `PostCard` in [App.jsx](../src/App.jsx) immediately calls `deletePost` from its trash button; the live path immediately deletes the row. There is no confirmation or undo. `.delete-post` is only 23 × 23 CSS pixels. The [schema](../database/schema.sql) also cascades deletion to the thought's automation request, so removing a fix thought removes its in-site progress record without cancelling external GitHub work.

**Smallest enhancement:** Add a quiet inline confirmation with Cancel and Delete, a pending state, and a larger hit area. Explain the progress-record consequence for fix thoughts. Keep the icon visually secondary.

**Acceptance:** The first activation does not write to Supabase; Cancel preserves the thought; a confirmed deletion sends one request. A failure keeps the thought and announces an error. Keyboard focus moves predictably after cancellation or removal. Aim for a 44px touch area where space permits, with at least 24px or verified equivalent spacing. Preserve existing deletion RLS and avoid adding a trash/archive data model.

### 3. Add a simple heading structure

**Observed:** In [App.jsx](../src/App.jsx), the wordmark is a `div` and “the wall” is a `span`; the page has no heading elements. The main landmark and named feed section help, but readers navigating by headings cannot jump to the wall.

**Smallest enhancement:** Make the wordmark an `h1` and the wall label an `h2`, explicitly preserving their current visual styles. No additional navigation is needed.

**Acceptance:** Heading navigation exposes Wahl followed by the wall, with no visual spacing regression. Verify owner and public views, keyboard navigation, and narrow layouts.

### 4. Make authoring and sign-in feedback more dependable

**Observed:** `Composer.submit` in [App.jsx](../src/App.jsx) increments the editor key after a successful post, replacing the editable element. There is no explicit focus restoration or success announcement. `SignIn` renders status messages as plain `small` elements without live-region semantics, has no pending submission guard, and its password fields omit explicit autocomplete purposes. In contrast, `PullRequestReview` already uses a pending guard and status region.

**Smallest enhancement:** Announce successful posting and restore focus when the editor is replaced, without stealing focus after the user moves elsewhere. Give sign-in/password updates a stable status region, prevent duplicate pending submissions, and use appropriate `username`, `current-password`, and `new-password` autocomplete values.

**Acceptance:** Verify keyboard focus after successful and failed posts; failed posts retain the draft. Sign-in progress, failures, and password-save results are announced without duplicate requests. Password-manager completion works. Auth transitions still clear private content and owner controls. Exercise both local preview and configured owner flows during a later authorized manual review.

### 5. Check the expanded sticky header on small screens

**Observed:** `.site-header` in [production.css](../src/production.css) is sticky, while both release history and sign-in forms expand inside it. Below 520px, header controls stack into one column. Expanded history plus sign-in can therefore make the pinned area much taller. Actual obstruction has not been reproduced in a browser.

**Smallest enhancement, if confirmed:** Keep the compact header pinned while letting expanded history/account content scroll naturally or collapse through an accessible control.

**Acceptance:** On a 320px-wide screen, a short landscape viewport, and at 200% zoom, open history and sign-in together and tab through the page. Every focused control must remain visible and reachable; the wall must remain readable. Preserve the requested sticky-header behavior and update its existing test if the implementation changes.

## Lower-priority opportunity

[styles.css](../src/styles.css) loads Google Fonts through a CSS `@import`. Fallback fonts and `display=swap` already exist. Measure cold-load font timing before changing delivery; if it meaningfully delays the intended typography, consider HTML stylesheet/preconnect hints or a small self-hosted font set. Verify blocked-font readability and layout shift. No performance regression or live Core Web Vitals result was measured here.

## Validation and next step

- `npm test` passed: all nine reported test-file groups, including feed rendering, pagination, formatting, and automation policy checks.
- `npm run build` passed. Vite reported approximately 73.22 kB gzip for JavaScript and 3.99 kB gzip for CSS; these artifact sizes are not a measurement of live loading speed.
- No runtime, dependency, schema, workflow, environment, or hosting changes are included, so no version bump is needed.

Start with readability, then deletion protection as separate focused changes. Keep this audit as a dated source snapshot. Each implemented suggestion still needs its acceptance checks; existing tests do not establish real browser focus behavior, rendered contrast, or deployed RLS correctness.
