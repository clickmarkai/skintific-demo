# Chat Widget – Architecture, Flow, and Recovery Guide

This document captures the current chat experience end‑to‑end so future changes can be made safely and, if anything breaks, the flow can be restored quickly.

## Key Files

- Frontend (UI): `src/components/ChatWidget.tsx`
- Supabase client: `src/lib/supabase.ts`
- Supabase Edge Function: `supabase/functions/chat/index.ts`
- Netlify Function (fallback): `netlify/functions/chat.ts`
- Persistence (DB): table `public.n8n_chat_histories` (jsonb `message`), carts-related tables

## High-level Flow

1. User clicks the launcher (Floating Action Button) to open the chat window. The window animates in (opacity + translate + scale).
2. UI injects a local (in‑memory) greeting: “Hello! How can I help you today?”
   - The greeting is NOT persisted to the DB to avoid duplicates after refresh.
3. If history exists for the stable `session_id`, it is loaded from `n8n_chat_histories` and rendered.
4. The user sends a message. The UI stores the user message in `n8n_chat_histories` and posts to the backend (Supabase Edge Function by default; Netlify function as backup).
5. Backend returns either:
   - Plain text, or
   - Structured payload (products | vouchers | cart | ticket).
6. UI renders the text and any structured content; it also persists the assistant reply to `n8n_chat_histories` as a structured JSON (plus a minimal text copy), so the UI can restore on refresh.

## Recommendation Clarifier (New)

Purpose: When a user asks for recommendations and we cannot confidently find strong matches, ask short clarifying questions, then retry search. If no results remain, return the closest matches with a clear message.

Trigger
- Any message that looks like a product‑search intent (e.g., “recommend”, “serum”, “cleanser”, “sunscreen”, etc.)
- Or a follow‑up after a weak/no‑match attempt

Clarifier Flow
1) Extract needs (LLM): `{ product_type?: string, concerns?: string[], price_tier?: string }` using prior 6 message turns for context
2) Search (ranked):
   - Embeddings over product descriptions/metadata (vector column), +
   - Tag/keyword alignment using `metadata.tags` and `metadata.type`, +
   - Price alignment (optional tiers)
   - Example weights: Embeddings 60%, Tags/concerns 30%, Price 10%
3) If results are empty/weak:
   - Ask 1–2 questions (product type, skin concerns, price range)
   - Retry search; if still empty → say: “there’s no exact match for your needs, here are the closest matches”, and return nearest matches
4) Persist each Q&A turn to `n8n_chat_histories` (structured assistant messages)

Notes
- Use existing `metadata.tags` and `metadata.type` for categories like moisturizer, serum, cleanser, sunscreen, toner, mask, makeup
- Mirror user language/tone in prompts and assistant replies


## Frontend Behavior (ChatWidget.tsx)

### Session & State

- Stable `session_id`: saved to `localStorage` as `chat_session_id`.
- Greeting: injected locally; never written to `n8n_chat_histories`.
- History load: on mount, fetches up to 200 messages from `n8n_chat_histories` for `session_id` and rebuilds bubbles.
- Cart rehydration: after history loads, if a previous `cart` snapshot exists, UI re‑adds a cart bubble so the cart restores visually.
- Animations: chat window uses `mounted` + `anim` (in/out) with Tailwind transitions (opacity/translate/scale) for smooth open/close.
 - Theme: black & white UI — launcher FAB and send button are black; user bubbles are black-on-white; assistant bubbles are white with a subtle border.
 - Buttons: subtle press animation via `active:scale-95`.
 - Product carousel: horizontal cards with hidden scrollbar (`.no-scrollbar`) and left/right arrow controls.
 - Auto vouchers: after the first successful Add to cart in a session, the UI automatically invokes `apply_voucher` to fetch applicable vouchers and renders them if any.
 - Voucher gating: uses `localStorage` key `chat_vouchers_shown_<session_id>` so the auto vouchers bubble renders only once per session (unless the user explicitly asks about vouchers).
 - Disabled states: in the chat cart bubble, “Clear cart” and “Go to cart” are disabled when the cart total is 0; “Go to cart” also disables while bundles are loading.
 - Cross‑app sync: after any cart change (add/edit/remove/clear), chat and cart page broadcast `cart_updated_at` in `localStorage` and a `cart:updated` CustomEvent. Both listen and refresh immediately (no manual refresh needed).
 - History replay hygiene: during history load, transient texts like “Adding…”, “Added…”, and “Bundle added…” are filtered; duplicate consecutive “Here are the recommended products below.” messages are suppressed; for cart snapshots only the latest one is kept.

### Sending Messages

- Validation: input must be non‑empty; send is disabled while `isLoading`.
- Submit on Enter (without Shift). While sending, a typing indicator appears.
- The user message is persisted to `n8n_chat_histories` with shape:

```json
{
  "session_id": "<uuid>",
  "message": { "role": "user", "content": "..." }
}
```

### Rendering Structured Replies

The assistant reply may include structured kinds; the UI will render them and persist a structured record so the content restores on refresh.

- Text (default)
- Products (`kind: "products"`):
  - Layout: large image at top; below it show name and price; then description/benefits; small thumbnails if available; bottom has Add to cart button.
  - Horizontal cards with hidden scrollbar (`.no-scrollbar`) and navigation arrows on the container.
  - `image_url` fallback to `/placeholder.svg` on error.
  - Price displayed from `price_cents` or `price`.
  - Add to cart → `addToCart()` (see Cart below).
- Vouchers (`kind: "vouchers"`):
  - Horizontal cards; show `description`, `discount`, `min_spend`, `estimated_savings_cents`
  - “Apply {code}” → `applyVoucher(code)`
- Cart (`kind: "cart"`):
  - Line items with qty controls and remove button
  - Totals: Subtotal/Discount/Total
  - Actions: Clear cart, Go to cart link
- Ticket (`kind: "ticket"`): small confirmation line `Ticket #... created.`

The persisted assistant message format (example):

```json
{
  "session_id": "<uuid>",
  "message": {
    "role": "assistant",
    "content": "Here are some recommendations...",
    "kind": "products",
    "products": [
      { "id": "...", "name": "...", "price_cents": 1299, "image_url": "...", "variant_id": "..." }
    ]
  }
}
```

## Cart & Voucher UX (UI-first with backend reconciliation)

### Cart Actions

All actions show optimistic UI feedback, then reconcile with backend:

- `add_line(product, qty, unit_price_cents, product_id, variant_id, image_url)`
- `edit_line(line, qty)`
- `delete_line(line)`
- `get_cart_info()` (forced refresh when needed)

UI ensures/locates a cart; writes to `cart_products`; reads back lines and computes totals. If the direct path fails, the Edge/Netlify function is invoked to complete the operation and fetch an accurate snapshot.

### Voucher Flow

### Bundles (Upsell)

- The chat “Go to cart” button opens a fullscreen bundle modal (rendered via portal) that fetches bundle suggestions.
- Bundle sources, in priority:
  1. Static bundles from DB tables `bundles` + `bundle_items` (active and within date range)
  2. Dynamic “Smart Routine Bundle”: 1 cart item + 1–2 complementary items at 10% off
- Add to cart (bundle):
  - Backend `add_bundle` discounts only the bundle items, de‑dupes existing cart lines (no quantity increase), updates unit prices and labels, and returns the updated cart.
  - Client fallback: if backend returns no snapshot, the UI updates/creates lines with discounted prices and then refreshes.
- Price display:
  - Chat cart bubble: shows current prices only (no strikethrough).
  - Cart page: shows original price struck‑through and discounted price with a “Bundle Discount” hint per line.
- UX: the bundle “Add to cart” button shows a spinner and disables while processing; “Go to cart” disables while bundles are loading.
- Apply voucher: validates eligibility; recomputes totals.
- List vouchers: shows active vouchers with `estimated_savings_cents`.

## Supabase Edge Function (Primary Backend)

### Intents

- `product_search` | `general` → text reply and/or `products` array
- `apply_voucher` → returns `cart` + message or list of vouchers
- `add_line` | `edit_line` | `delete_line` → returns updated `cart`
- `get_cart_info` | `delete_cart` → returns `cart` (and may include `bundles`)
- `get_upsell` → returns upsell products/bundles derived from cart contents
- `add_bundle` → apply % off to bundle items, de‑dupe existing lines, update unit_price, and return updated cart
- `ticket` → creates ticket via webhook
- `checkout` → returns checkout URL (if enabled)

### Product Recommendations

- Vector search via OpenAI embeddings → RPC `match_products` → fallback keyword search.
- Re-ranking heuristic based on extracted needs: product type match, tags/concerns alignment, price tier (budget/mid/premium), and small boosts for description/images.
- Response shape (for UI):

```json
{
  "output": "...",
  "products": [
    {
      "id": "...",
      "name": "...",
      "price_cents": 1299,
      "image_url": "...",
      "variant_id": "...",
      "description": "...",
      "tags": ["acne", "brightening"],
      "images": ["...", "..."],
      "type": "serum"
    }
  ]
}
```

### Cart

- Ensures/locates a cart row; reads/writes `cart_products` lines.
- Totals computed from lines; voucher discount applied when present.
 - History persistence: on history replay, only the latest `cart` snapshot is kept; persistence uses a content hash to avoid duplicate cart messages.
 - Chat bubble intentionally omits strikethroughs; slashed original vs discounted prices are rendered on the dedicated Cart page.

### Vouchers

- Validates code; computes discount using min spend and optional max discount.
- `apply_voucher` can also return a list of currently applicable vouchers (even without a code), enabling the UI to render a vouchers bubble after the first Add to cart.
- List endpoint returns top vouchers with estimated savings for the current subtotal.

### Ticket Creation (LLM‑only Escalation)

- After generating a draft assistant reply, a compact LLM check decides:

```json
{ "escalate": true | false }
```

- Escalate if the draft doesn’t resolve the user’s message OR the user explicitly asks for a ticket/human/support.
- Webhook payload:

```json
[
  {
    "user_email": "<email>",
    "message": "<last user message>",
    "category": "general",
    "session_id": "<session_id>",
    "user_Id": "<user id or anonymous>",
    "subject": "<compact subject>"
  }
]
```

## Netlify Function (Fallback Backend)

- Mirrors Edge Function intents and shapes.
- Lightweight rate‑limiting per session.
- Same ticket webhook behavior.

## Persistence & Tables

- `public.n8n_chat_histories`
  - `id` (serial/int), `session_id` (varchar), `message` (jsonb)
  - The `greeting` is never persisted; assistant/product/voucher/cart/ticket messages are persisted as JSON.
  - Transient UX messages are never persisted (e.g., “Adding…”, “Added…”, “Bundle added…”).
- Cart tables: `carts`, `cart_products`; optional RPC `ensure_cart`.
 - Bundle tables (optional for static bundles): `bundles`, `bundle_items`.

## Environment Variables

- Frontend:
  - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
  - `VITE_SUPABASE_FUNCTION_URL` (optional explicit Edge Function URL)
  - `VITE_CART_URL`
- Edge/Netlify Functions:
  - `OPENAI_API_KEY` / `VITE_OPENAI_API_KEY`
  - `CHAT_MODEL` (e.g., `gpt-4o-mini`)
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Edge)
  - `TICKET_WEBHOOK_URL`

## Validation & Error Handling

- Input cannot be blank; send disabled while loading.
- Images fall back to `/placeholder.svg` on error.
- Cart writes use defensive defaults; qty ≥ 1; price in cents normalized.
- Toasts on network/function errors.
 - Sync safety: if `add_bundle` does not return a cart snapshot, UI performs a line‑by‑line discounted add/update then refreshes.

## Quick Test Checklist (Smoke)

1. Open chat → greeting shows once; no duplicate rows in `n8n_chat_histories`.
2. Ask for products → product carousel renders; images load (fallback if needed); Add to cart works.
3. Apply voucher → either success with totals updated or list of vouchers shows.
4. Cart add/edit/delete → cart bubble updates; totals correct.
5. Clear cart on Cart page → chat bubble refreshes automatically and disables its Clear/Go buttons.
6. “Go to cart” (from chat bubble) opens a fullscreen bundle modal; the button is disabled while bundles are loading.
7. Add bundle → items are added at 10% off without duplicating existing lines; Cart page shows slashed original price and a Bundle Discount hint; chat shows current prices only.
8. Auto vouchers render only once per session after the first add‑to‑cart (unless user explicitly asks for vouchers).
9. Payment/human request → webhook ticket created; confirmation message returned.
10. Refresh page → history replays; cart snapshot restores; greeting does not duplicate.

## Detailed Smoke Tests – Clarifier Flow and Voucher-after-cart

1) Clarifier triggers on vague query
- Input: “Can you recommend something for my skin?”
- Expect: Assistant asks for product type + skin concerns + price range.
- DB: A new row in `n8n_chat_histories` with `{ role: "assistant", kind: "text", clarifier: { needs } }`.

2) Provide partial details → follow-up
- Input: “Serum.”
- Expect: Either products appear or a short follow-up clarifier (e.g., preferred concern/price).
- UI: If products appear, cards have image, name, price, and description.

3) Weak results → one clarifier and retry
- Input: “For acne” (after “Serum”).
- Expect: If results are still weak, assistant asks one concise question to refine.
- DB: Clarifier turns appended to `n8n_chat_histories` with clarifier metadata.

4) Zero matches → closest matches fallback
- Input: Add constraints likely to yield no results (e.g., unrealistic price + niche type).
- Expect: Message: “I couldn’t find an exact match … here are the closest items we have” + product list.

5) Multi-turn persistence & refresh
- Action: Refresh the page after steps 1–4.
- Expect: All prior clarifier turns and any product carousels rehydrate; greeting shows once.

6) Voucher-after-first-add-to-cart
- Action: From a product carousel, click “Add to cart” on one product.
- Expect: Cart bubble updates. UI silently requests vouchers; if available, a vouchers bubble renders.
- DB: Assistant vouchers message persisted to `n8n_chat_histories` with `{ kind: "vouchers", vouchers: [...] }`.

7) No vouchers available
- Setup: Temporarily mark all vouchers inactive or set `min_subtotal_cents` above subtotal.
- Action: Add first product to cart again.
- Expect: No vouchers bubble is rendered; no misleading text is shown.

8) Ticketing unaffected by clarifier
- Input: A request the LLM cannot resolve (e.g., refund/duplicate charge inquiry).
- Expect: LLM decides to escalate; webhook is called; assistant returns confirmation line.
- UI: Product, voucher, cart flows remain intact on subsequent messages.

Troubleshooting
- Clarifier not asked: Check Edge Function logs and ensure embeddings RPC `match_products` exists and returns rows; verify OpenAI API key.
- No closest matches: Ensure fallback keyword search is enabled; lower vector threshold if needed.
- Vouchers not rendering: Confirm Edge `apply_voucher` returns `vouchers` array; verify `active`, `expires_at`, and `min_subtotal_cents` conditions.
- History missing on refresh: Verify assistant structured messages are inserted into `n8n_chat_histories` and loaded by the UI.

## Recovery Playbook

- Carousel missing:
  - Verify Edge/Netlify returns `products` array. If not, re‑enable vector/keyword search in function.
- Vouchers not rendering:
  - Check function returns `vouchers` array with required fields.
- Cart not updating:
  - Ensure `ensure_cart` RPC exists; verify `cart_products` writes/reads; confirm UI fallback `get_cart_info` path works.
- Duplicated greeting:
  - Confirm greeting is not written to `n8n_chat_histories`.
- Ticket not created:
  - Check LLM escalation prompt and `TICKET_WEBHOOK_URL` connectivity.

## Notes

- All UI structured replies are persisted with a structured JSON so the UI can restore rich bubbles on refresh.
- The greeting remains local only to prevent duplicates.

