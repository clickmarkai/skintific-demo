/*
  Netlify Function: /chat
  - Accepts POST with { message, session_id, user_id, user_email, timestamp, source }
  - Routes intents and returns structured JSON compatible with ChatWidget rich rendering
  - Minimal in-memory product data and cart store for demo purposes
*/

import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/types/database";
import { PRODUCTS as CAT_PRODUCTS, searchProducts } from "./_productData";

type Intent =
  | "get_cart_info"
  | "add_line"
  | "edit_line"
  | "delete_line"
  | "delete_cart"
  | "apply_voucher"
  | "product_reco"
  | "ticket"
  | "checkout";

interface RequestBody {
  message?: string;
  session_id?: string;
  user_id?: string;
  user_email?: string;
  timestamp?: string;
  source?: string;
}

// Product catalog imports
const PRODUCTS = CAT_PRODUCTS;

const VOUCHERS = [
  { code: "WELCOME10", type: "percent" as const, value: 10, min_subtotal_cents: 0, applies_to: "*" },
  { code: "CERAMIDE15", type: "percent" as const, value: 15, min_subtotal_cents: 2000, applies_to: "ceramide" },
];

export type CartLine = { product_name: string; qty: number; unit_price_cents: number; image_url?: string };
export type Cart = { items: CartLine[]; subtotal_cents: number; discount_cents: number; total_cents: number; voucher_code?: string | null };

// Ephemeral in-memory carts keyed by session_id (replace with DB in production)
const carts = new Map<string, Cart>();
const lastHit = new Map<string, number>();
const awaitingClarification = new Map<string, boolean>();

const currency = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function findProductByQuery(q: string | undefined) {
  if (!q) return undefined;
  const results = searchProducts(q, 5);
  return results[0];
}

export function ensureCart(sessionId: string): Cart {
  let cart = carts.get(sessionId);
  if (!cart) {
    cart = { items: [], subtotal_cents: 0, discount_cents: 0, total_cents: 0, voucher_code: null };
    carts.set(sessionId, cart);
  }
  return cart;
}

export function recomputeTotals(cart: Cart) {
  cart.subtotal_cents = cart.items.reduce((acc, l) => acc + l.unit_price_cents * l.qty, 0);
  // Re-apply voucher if any
  const discount = computeBestVoucher(cart, cart.voucher_code || undefined);
  cart.discount_cents = discount.amount_cents;
  cart.total_cents = Math.max(0, cart.subtotal_cents - cart.discount_cents);
}

export function computeBestVoucher(cart: Cart, preferred?: string) {
  const candidates = VOUCHERS.filter((v) => v.code === preferred || !preferred);
  const eligible = (v: (typeof VOUCHERS)[number]) => {
    if (cart.subtotal_cents < v.min_subtotal_cents) return false;
    if (v.applies_to === "*") return true;
    const hasTag = cart.items.some((l) => {
      const prod = PRODUCTS.find((p) => p.name === l.product_name);
      return prod?.tags?.includes(v.applies_to as string);
    });
    return hasTag;
  };
  let best = { code: preferred || null as string | null, amount_cents: 0 };
  const pool = preferred ? VOUCHERS : VOUCHERS;
  for (const v of pool) {
    if (!eligible(v)) continue;
    const amount = v.type === "percent" ? Math.floor((cart.subtotal_cents * v.value) / 100) : v.value;
    if (amount > best.amount_cents) best = { code: v.code, amount_cents: amount };
  }
  return best;
}

export function extractQty(text: string) {
  const m = text.match(/\b(\d{1,2})\b/);
  return m ? Math.max(1, parseInt(m[1], 10)) : 1;
}

export function detectIntent(text: string): Intent {
  const t = text.toLowerCase();
  const voucherKeywords = ["voucher","discount","promo","coupon","code","deal","eligible","diskon","kupon","kode","potongan","ada promo","ada diskon"];
  if (voucherKeywords.some((k) => t.includes(k))) return "apply_voucher";
  if (isOutOfScope(t)) return "ticket";
  if (/\b(add|tambah|buy|beli|masukkan)\b/.test(t)) return "add_line";
  if (/\b(edit|update|ubah)\b/.test(t)) return "edit_line";
  if (/\b(remove|hapus|delete)\b/.test(t)) return "delete_line";
  if (/\b(clear cart|delete cart|empty cart)\b/.test(t)) return "delete_cart";
  if (/\b(cart|keranjang|show my cart)\b/.test(t)) return "get_cart_info";
  if (/\b(ticket|help|human|cs)\b/.test(t)) return "ticket";
  if (/\b(checkout|buy now|ready to buy|pay|checkout link)\b/.test(t)) return "checkout";
  return "product_reco";
}

function isOutOfScope(t: string) {
  const triggers = [
    "track", "where is my order", "resi", "awb", "delivery", "courier", "arrived",
    "refund", "exchange", "warranty", "policy", "defect", "broken", "double charge",
    "stock", "availability", "ready stock", "in stock",
    "change address", "after checkout",
  ];
  return triggers.some((k) => t.includes(k));
}

// Optional Supabase server client (service role) for persistence
const VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const VITE_SUPABASE_SERVICE_ROLE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const hasSupabase = Boolean(VITE_SUPABASE_URL && VITE_SUPABASE_SERVICE_ROLE_KEY);
const supabaseSrv = hasSupabase ? createClient<Database>(VITE_SUPABASE_URL as string, VITE_SUPABASE_SERVICE_ROLE_KEY as string) : null;

async function saveMessage(sessionId: string, role: "user" | "assistant", content: string) {
  if (!supabaseSrv) return;
  try {
    // Back-compat table
    await (supabaseSrv as any).from("chat_messages").insert({ session_id: sessionId, role, content });
    // Primary history table for n8n (expects message JSON)
    await (supabaseSrv as any).from("n8n_chat_histories").insert({ session_id: sessionId, message: { role, content } });
  } catch {}
}

async function loadRecentMessages(sessionId: string, limit = 12) {
  if (!supabaseSrv) return [] as Array<{ role: string; content: string; created_at: string }>;
  try {
    // Prefer n8n_chat_histories if exists; fallback to chat_messages
    let { data, error } = await supabaseSrv
      .from("n8n_chat_histories")
      .select("role, content, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      const alt = await supabaseSrv
        .from("chat_messages")
        .select("role, content, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(limit);
      data = alt.data as any;
    }
    return (data || []).reverse();
  } catch {
    return [];
  }
}

async function createTicket(sessionId: string, user_email: string | undefined, subject: string, message: string, category?: string, priority?: string) {
  if (!supabaseSrv) return { ticket_id: crypto.randomUUID() };
  try {
    const { data, error } = await supabaseSrv
      .from("tickets")
      .insert({ session_id: sessionId, user_email, subject, message, category, priority })
      .select("id")
      .single();
    if (error) throw error;
    return { ticket_id: data.id as string };
  } catch {
    return { ticket_id: crypto.randomUUID() };
  }
}

async function persistCart(sessionId: string, cart: Cart) {
  if (!supabaseSrv) return;
  try {
    await supabaseSrv.from("carts").upsert({ session_id: sessionId, subtotal_cents: cart.subtotal_cents, discount_cents: cart.discount_cents, total_cents: cart.total_cents, voucher_code: cart.voucher_code });
    // Replace cart lines
    await supabaseSrv.from("cart_lines").delete().eq("session_id", sessionId);
    const rows = cart.items.map((l) => ({ session_id: sessionId, product_name: l.product_name, qty: l.qty, unit_price_cents: l.unit_price_cents, image_url: l.image_url }));
    if (rows.length) await supabaseSrv.from("cart_lines").insert(rows);
  } catch {}
}

// Optional OpenAI intent extraction
const VITE_OPENAI_API_KEY = process.env.VITE_OPENAI_API_KEY;
const CHAT_MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";

// Basic normalization and synonym expansion for product queries
function normalizeQuery(input: string) {
  const q = (input || "").toLowerCase().trim();
  // common misspellings and synonyms
  const synonyms: Record<string, string[]> = {
    moisturizer: ["moisturizer", "moisturiser", "mosturizer", "moist", "hydrating", "gel", "cream", "lotion"],
    serum: ["serum"],
    sunscreen: ["sunscreen", "spf", "sun block", "sunblock"],
    cleanser: ["cleanser", "face wash", "wash"],
    toner: ["toner"],
  };
  const matched = Object.entries(synonyms).find(([, words]) => words.some((w) => q.includes(w)));
  if (matched) return { root: matched[0], terms: matched[1] } as { root: string; terms: string[] };
  // default: split into terms
  const tokens = q.split(/[^a-z0-9]+/).filter(Boolean);
  return { root: tokens[0] || q, terms: tokens } as { root: string; terms: string[] };
}

async function searchProductsFromDB(query: string, limit = 6) {
  if (!supabaseSrv) return [] as Array<{ id: string; name: string; price?: number; image_url?: string; tags?: string[]; variant_id?: string; description?: string }>;
  const { root, terms } = normalizeQuery(query);
  // Prefer semantic search via RPC if available, else fallback to keyword search
  try {
    // Try semantic search first when embeddings exist
    try {
      // Create a temporary embedding using OpenAI if key is provided; fall back to keyword if not
      if (VITE_OPENAI_API_KEY) {
        const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${VITE_OPENAI_API_KEY}` },
          body: JSON.stringify({
            model: process.env.EMBED_MODEL || "text-embedding-3-small",
            input: query,
          }),
        });
        if (embedRes.ok) {
          const embedData = await embedRes.json();
          const embedding = embedData?.data?.[0]?.embedding as number[] | undefined;
          if (embedding && Array.isArray(embedding)) {
            const { data: matches } = await (supabaseSrv as any).rpc('match_products', {
              query_embedding: embedding,
              match_threshold: 0.2,
              match_count: Math.max(3, Math.min(limit, 12)),
            });
            if (Array.isArray(matches) && matches.length) {
              const mapped = matches.map((row: any) => {
                const md = row.metadata || {};
                const firstImage = Array.isArray(md.images) && md.images.length ? (md.images[0]?.src as string) : undefined;
                return {
                  id: row.id as string,
                  name: (md.title as string) || (row.content as string)?.slice(0, 80) || "Product",
                  price: typeof md.price === "number" ? md.price : undefined,
                  image_url: (md.image_url as string) || firstImage,
                  tags: (md.tags as string[]) || [],
                  variant_id: (row.variant_id as string) || undefined,
                  description: (md.description as string) || (row.content as string)?.slice(0, 160),
                };
              });
              return mapped;
            }
          }
        }
      }
    } catch {}

    // Attempt a lightweight keyword search over title/content/tags
    // Using OR filters on jsonb fields
    const likeTerms = [root, ...terms].filter((v, i, a) => v && a.indexOf(v) === i);
    const orClauses: string[] = [];
    for (const term of likeTerms) {
      const pat = `%${term}%`;
      orClauses.push(`metadata->>title.ilike.${pat}`);
      orClauses.push(`content.ilike.${pat}`);
      // simple tag match when tags is an array of strings
      orClauses.push(`metadata->tags.cs.{${term}}`);
      orClauses.push(`metadata->>type.ilike.${pat}`);
    }
    const { data } = await (supabaseSrv as any)
      .from("products")
      .select("id, content, metadata")
      .or(orClauses.join(","))
      .limit(Math.max(3, Math.min(limit, 12)));

    const mapped = (data || []).map((row: any) => {
      const md = row.metadata || {};
      const firstImage = Array.isArray(md.images) && md.images.length ? (md.images[0]?.src as string) : undefined;
      return {
        id: row.id as string,
        name: (md.title as string) || (row.content as string)?.slice(0, 80) || "Product",
        price: typeof md.price === "number" ? md.price : undefined,
        image_url: (md.image_url as string) || firstImage,
        tags: (md.tags as string[]) || [],
        variant_id: (row.variant_id as string) || undefined,
        description: (md.description as string) || (row.content as string)?.slice(0, 160),
      };
    });
    return mapped;
  } catch {
    return [] as Array<{ id: string; name: string; price?: number; image_url?: string; tags?: string[]; variant_id?: string; description?: string }>;
  }
}

async function extractIntentLLM(message: string): Promise<Partial<{ intent: Intent; product_name: string; qty: number; voucher_name: string }>> {
  if (!VITE_OPENAI_API_KEY) return {};
  const system = `You are a router for a skincare e-commerce assistant. Output ONLY JSON with: intent (one of get_cart_info, add_line, edit_line, delete_line, delete_cart, apply_voucher, product_reco, ticket, checkout), product_name (string or empty), qty (number), voucher_name (string or empty). If user asks discounts/promos, set intent=apply_voucher.`;
  const user = message;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${VITE_OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return {};
    const parsed = JSON.parse(content);
    return parsed;
  } catch {
    return {};
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  // CORS preflight handled implicitly by Netlify; add headers to response
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  } as const;

  try {
    const body: RequestBody & { intent?: any; product_name?: string; qty?: number; voucher_name?: string } = event.body ? JSON.parse(event.body) : {};
    const message = body.message?.trim() || "";
    const sessionId = body.session_id || "anonymous";
    // Simple per-session rate limit (1 request per 600ms)
    const now = Date.now();
    const last = lastHit.get(sessionId) || 0;
    if (now - last < 600) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: "Too many requests, please slow down." }) };
    }
    lastHit.set(sessionId, now);


    if (!message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing message" }) };
    }

    // Router: LLM (optional) + keyword overrides
    let intent: Intent | undefined;
    let hintedProduct: string | undefined;
    let hintedVoucher: string | undefined;
    let hintedQty: number | undefined;

    if (VITE_OPENAI_API_KEY && !body.intent) {
      const llm = await extractIntentLLM(message);
      if (llm.intent) intent = llm.intent;
      hintedProduct = (llm as any).product_name || undefined;
      hintedVoucher = (llm as any).voucher_name || undefined;
      hintedQty = (llm as any).qty || undefined;
    }

    // Hard keyword overrides (voucher etc.)
    intent = (body.intent as any) || intent || detectIntent(message);
    // LLM escalation with regex fallback
    async function classifyNeedsHumanLLM(msg: string): Promise<boolean> {
      if (!VITE_OPENAI_API_KEY) return false;
      try {
        const sys = "Decide if this user request should be escalated to a human agent. Reply with pure JSON: { escalate: boolean }. Escalate if it concerns payment problems, billing, refunds, duplicate charges, missing confirmations/emails, account security, or anything requiring manual intervention beyond product recommendations, vouchers, cart or pricing.";
        const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${VITE_OPENAI_API_KEY}` }, body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: "system", content: sys }, { role: "user", content: msg }], temperature: 0, response_format: { type: "json_object" } }) });
        const data = await res.json();
        const parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
        return Boolean(parsed.escalate);
      } catch { return false; }
    }
    const regexNeedsHuman = /\b(payment|paid|charge|charged|billing|invoice|receipt|no\s*email|email\s*confirm|confirmation|failed\s*payment|refund|chargeback|double\s*charge)\b/i.test(message);
    let needsHuman = regexNeedsHuman || await classifyNeedsHumanLLM(message);
    if (needsHuman && intent !== 'apply_voucher' && intent !== 'get_cart_info') {
      intent = 'ticket';
    }
    if (body.product_name) hintedProduct = body.product_name;
    if (typeof body.qty === 'number') hintedQty = body.qty;
    if (typeof body.voucher_name === 'string') hintedVoucher = body.voucher_name;
    if (intent === "product_reco") {
      // Prefer DB-backed search to ensure results match the user's request (e.g. moisturizer)
      const dbResults = await searchProductsFromDB(message, 6);
      let results: Array<any> = dbResults.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        image_url: p.image_url,
        tags: p.tags,
        variant_id: p.variant_id,
        description: undefined,
      }));
      if (!results.length) {
        // Fallback to in-memory demo catalog
        const demo = searchProducts(message, 6);
        results = demo.map((d) => ({ 
          name: d.name, 
          price_cents: d.price_cents, 
          image_url: d.image_url, 
          tags: d.tags,
          description: `Top pick: ${d.name}. Loved for ${Array.isArray(d.tags) && d.tags.length ? d.tags.slice(0,2).join(", ") : 'great results'}.`
        }));
      }
      const output = results.length > 0
        ? `Here are some recommendations to consider for your routine:`
        : `I couldn’t find an exact match, but here are some popular options:`;
      await saveMessage(sessionId, "user", message);
      await saveMessage(sessionId, "assistant", output);
      return { statusCode: 200, headers, body: JSON.stringify({ output, products: results }) };
    }

  const cart = ensureCart(sessionId);
  // Attempt to ensure a persistent cart via Supabase RPC if available
  try {
    if (supabaseSrv) {
      const { data: ensured } = await supabaseSrv.rpc('ensure_cart', { p_currency: 'USD', p_session_id: sessionId, p_user_id: body.user_id || null });
      if (ensured?.id) {
        cart.voucher_code = cart.voucher_code || null;
      }
    }
  } catch {}

    if (intent === "get_cart_info") {
      recomputeTotals(cart);
      const output = `Your cart summary — Subtotal ${currency(cart.subtotal_cents)}, Discount -${currency(cart.discount_cents)}, Total ${currency(cart.total_cents)}.`;
      await persistCart(sessionId, cart);
      await saveMessage(sessionId, "user", message);
      await saveMessage(sessionId, "assistant", output);
      return { statusCode: 200, headers, body: JSON.stringify({ output, cart }) };
    }

    if (intent === "delete_cart") {
      carts.set(sessionId, { items: [], subtotal_cents: 0, discount_cents: 0, total_cents: 0, voucher_code: null });
      const fresh = ensureCart(sessionId);
      const output = `Cart cleared.`;
      await persistCart(sessionId, fresh);
      await saveMessage(sessionId, "user", message);
      await saveMessage(sessionId, "assistant", output);
      return { statusCode: 200, headers, body: JSON.stringify({ output, cart: fresh }) };
    }

    if (intent === "add_line" || intent === "edit_line" || intent === "delete_line") {
      // Extract product info from request body if available
      const requestedProductId = body.product_id;
      const requestedVariantId = body.variant_id;
      const requestedProductName = body.product_name || hintedProduct;
      const requestedQty = body.qty || hintedQty || extractQty(message);
      const requestedPrice = body.unit_price_cents;
      const requestedImage = body.image_url;
      
      try {
        if (supabaseSrv) {
          // Ensure cart exists
          const { data: ensured, error: ensureErr } = await supabaseSrv.rpc('ensure_cart', { 
            p_currency: 'IDR', 
            p_session_id: sessionId, 
            p_user_id: body.user_id || null 
          });
          
          if (ensureErr || !ensured?.id) {
            console.error('ensure_cart failed:', ensureErr);
            return { statusCode: 500, headers, body: JSON.stringify({ error: "Cart unavailable" }) };
          }
          
          const cartId = ensured.id;
          
          // For delete, we need to find the existing line
          if (intent === 'delete_line') {
            // Try to find line by variant_id, product_id, or title
            const { data: lines } = await supabaseSrv
              .from('cart_products')
              .select('id')
              .eq('cart_id', cartId)
              .or(`variant_id.eq.${requestedVariantId || 'null'},product_id.eq.${requestedProductId || 'null'},title_snapshot.eq.${requestedProductName || 'null'}`)
              .limit(1);
            
            if (lines && lines.length > 0) {
              await supabaseSrv
                .from('cart_products')
                .delete()
                .eq('id', lines[0].id);
            }
          } else {
            // For add/edit, check if line exists
            const { data: existing } = await supabaseSrv
              .from('cart_products')
              .select('id, qty')
              .eq('cart_id', cartId)
              .or(`variant_id.eq.${requestedVariantId || 'null'},product_id.eq.${requestedProductId || 'null'},title_snapshot.eq.${requestedProductName || 'null'}`)
              .limit(1);
            
            const existingLine = existing && existing.length > 0 ? existing[0] : null;
            
            if (existingLine) {
              // Update existing line
              const newQty = intent === 'add_line' 
                ? (existingLine.qty || 0) + (requestedQty || 1)
                : (requestedQty || 1);
                
              await supabaseSrv
                .from('cart_products')
                .update({
                  qty: Math.max(1, newQty),
                  unit_price: (requestedPrice || 0) / 100,
                  title_snapshot: requestedProductName || 'Unknown Product',
                  image_url: requestedImage || null,
                })
                .eq('id', existingLine.id);
            } else {
              // Insert new line
              await supabaseSrv
                .from('cart_products')
                .insert({
                  cart_id: cartId,
                  product_id: requestedProductId || requestedProductName || 'unknown',
                  variant_id: requestedVariantId || requestedProductId || requestedProductName || 'unknown',
                  qty: Math.max(1, requestedQty || 1),
                  unit_price: (requestedPrice || 0) / 100,
                  title_snapshot: requestedProductName || 'Unknown Product',
                  image_url: requestedImage || null,
                });
            }
          }
          
          // Fetch updated cart
          const updatedCart = await fetchCartItems(cartId, 'IDR');
          const output = intent === "delete_line" 
            ? `Removed ${requestedProductName}.`
            : intent === "edit_line"
            ? `Updated ${requestedProductName} quantity to ${requestedQty}.`
            : `Added ${requestedProductName} to cart.`;
            
          await logEvent(supabaseSrv, sessionId, body.user_id, 'user', message || intent);
          await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', output);
          
          return { statusCode: 200, headers, body: JSON.stringify({ output, cart: updatedCart, returnCart: true }) };
        } else {
          // Fallback to in-memory cart
          const searchQ = requestedProductName || hintedProduct || message;
          const matches = searchProducts(searchQ, 5);
          if (matches.length === 0) {
            return { statusCode: 200, headers, body: JSON.stringify({ output: "I couldn't find that product. Could you specify the name?" }) };
          }
          const product = matches[0];
          const qty = requestedQty || hintedQty || extractQty(message);
          const idx = cart.items.findIndex((l) => l.product_name === product.name);
          
          if (intent === "add_line") {
            if (idx >= 0) cart.items[idx].qty += qty; 
            else cart.items.push({ 
              product_name: product.name, 
              qty, 
              unit_price_cents: product.price_cents, 
              image_url: product.image_url 
            });
          } else if (intent === "edit_line") {
            if (idx >= 0) cart.items[idx].qty = qty; 
            else cart.items.push({ 
              product_name: product.name, 
              qty, 
              unit_price_cents: product.price_cents, 
              image_url: product.image_url 
            });
          } else if (intent === "delete_line") {
            if (idx >= 0) cart.items.splice(idx, 1);
          }
          
          recomputeTotals(cart);
          await persistCart(sessionId, cart);
          
          const output = intent === "delete_line" 
            ? `Removed ${product.name}.`
            : `Updated ${product.name}. New total ${currency(cart.total_cents)}.`;
            
          await saveMessage(sessionId, "user", message);
          await saveMessage(sessionId, "assistant", output);
          
          return { statusCode: 200, headers, body: JSON.stringify({ output, cart }) };
        }
      } catch (error) {
        console.error('Cart operation error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Cart unavailable" }) };
      }
    }

    if (intent === "apply_voucher") {
      // If message contains an explicit code, try it; else best eligible
      const codeMatch = (hintedVoucher || message).match(/[A-Z0-9]{4,}/i);
      recomputeTotals(cart);
      let best = computeBestVoucher(cart, codeMatch ? codeMatch[0].toUpperCase() : undefined);
      if (codeMatch && best.code?.toUpperCase() !== codeMatch[0].toUpperCase()) {
        // provided code invalid → retry best-eligible without code
        best = computeBestVoucher(cart, undefined);
        cart.voucher_code = best.code || null;
        recomputeTotals(cart);
        const output = `${codeMatch[0].toUpperCase()} isn't valid. I applied a better discount for you — new total ${currency(cart.total_cents)}.`;
        await persistCart(sessionId, cart);
        await saveMessage(sessionId, "user", message);
        await saveMessage(sessionId, "assistant", output);
        return { statusCode: 200, headers, body: JSON.stringify({ output, cart }) };
      } else {
        cart.voucher_code = best.code || null;
        recomputeTotals(cart);
        if (best.code) {
          const saved = best.amount_cents;
          const output = `Applied ${best.code} — you saved ${currency(saved)}! New total ${currency(cart.total_cents)}.`;
          await persistCart(sessionId, cart);
          await saveMessage(sessionId, "user", message);
          await saveMessage(sessionId, "assistant", output);
          return { statusCode: 200, headers, body: JSON.stringify({ output, cart }) };
        } else {
          const output = `No eligible vouchers for the current cart.`;
          await saveMessage(sessionId, "user", message);
          await saveMessage(sessionId, "assistant", output);
          return { statusCode: 200, headers, body: JSON.stringify({ output, cart }) };
        }
      }
    }

    if (intent === "checkout") {
      recomputeTotals(cart);
      const params = new URLSearchParams();
      cart.items.forEach((l, i) => {
        params.append(`item${i}_name`, l.product_name);
        params.append(`item${i}_qty`, String(l.qty));
      });
      if (cart.voucher_code) params.append("voucher", cart.voucher_code);
      const base = process.env.CHECKOUT_BASE_URL || "https://example-checkout.local/checkout";
      const checkoutUrl = `${base}?${params.toString()}`;
      const output = `Here’s your checkout link: ${checkoutUrl}`;
      await saveMessage(sessionId, "user", message || "checkout");
      await saveMessage(sessionId, "assistant", output);
      return { statusCode: 200, headers, body: JSON.stringify({ output, cart, checkout_url: checkoutUrl }) };
    }

    if (intent === "ticket") {
      // Create a ticket via webhook for OOS topics
      const webhookUrl = process.env.TICKET_WEBHOOK_URL || "https://primary-production-b68a.up.railway.app/webhook/ticket_create";
      // Try to infer subject/category with LLM, fallback to heuristics
      let subject = "Customer support request";
      let category = "general";
      if (VITE_OPENAI_API_KEY) {
        try {
          const sys = `Extract concise subject and category for a customer support ticket from the user's last message. Return JSON {subject:string, category:string}. Categories: product_info, order, payment, shipping, return_refund, account, other.`;
          const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${VITE_OPENAI_API_KEY}` }, body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: "system", content: sys }, { role: "user", content: message }], temperature: 0, response_format: { type: "json_object" } }) });
          const data = await res.json();
          const parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
          subject = typeof parsed.subject === 'string' && parsed.subject.trim() ? parsed.subject.trim() : subject;
          category = typeof parsed.category === 'string' && parsed.category.trim() ? parsed.category.trim() : category;
        } catch {}
      } else {
        const lower = (message || '').toLowerCase();
        if (/stock|availability|ready/.test(lower)) category = 'product_info';
        else if (/refund|return/.test(lower)) category = 'return_refund';
        else if (/ship|delivery|courier/.test(lower)) category = 'shipping';
        else if (/pay|payment|charge/.test(lower)) category = 'payment';
        subject = message.slice(0, 80) || subject;
      }
      const payload = [{
        user_email: body.user_email || 'anonymous@example.com',
        message,
        category,
        session_id: sessionId,
        user_Id: body.user_id || 'anonymous',
        subject
      }];
      try {
        const r = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) {
          console.error('Ticket webhook failed', r.status, await r.text().catch(()=>'') );
        }
      } catch (e) { console.error('Ticket webhook error', e); }
      const output = `I’ve created a support ticket so a human can assist you shortly. Subject: ${subject}.`;
      await saveMessage(sessionId, "user", message);
      await saveMessage(sessionId, "assistant", output);
      return { statusCode: 200, headers, body: JSON.stringify({ output, ticket_created: true }) };
    }

    // Fallback
    return { statusCode: 200, headers, body: JSON.stringify({ output: "How can I help you with Skintific products, cart, or vouchers today?" }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal Server Error" }) };
  }
};

export default handler;


