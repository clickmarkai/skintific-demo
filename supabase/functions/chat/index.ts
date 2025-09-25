import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.2';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const CHAT_MODEL = Deno.env.get('CHAT_MODEL') || 'gpt-4o-mini';

interface LineItem {
  product_name: string;
  qty: number;
  unit_price_cents: number;
  image_url?: string;
  product_id?: string;
  variant_id?: string;
  bundle?: boolean;
}

interface Cart {
  items: LineItem[];
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  voucher_code: string | null;
}

const currency = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const detectIntent = (message: string): string => {
  const lower = message.toLowerCase();
  // Add to cart only when explicitly asked to add/put into cart or clear buy intent
  const addToCart = /(add|put|insert)\b[\s\S]*\b(cart|bag)\b/.test(lower) || /\badd to (cart|bag)\b/.test(lower);
  const buyDirect = /\b(buy now|purchase now|proceed to checkout)\b/.test(lower);
  if ((addToCart || buyDirect) && !/\b(remove|delete|cancel)\b/.test(lower)) return "add_line";
  if (/\b(change|update|modify|set|edit)\s+(qty|quantity)\b/.test(lower)) return "edit_line";
  if (/\b(remove|delete|cancel|take out)\b/.test(lower)) return "delete_line";
  if (/\b(clear|empty|reset)\s+(cart|bag)\b/.test(lower)) return "delete_cart";
  if (/\b(cart|bag|total|summary|order)\b/.test(lower) && /\b(show|view|check|what|see|look)\b/.test(lower)) return "get_cart_info";
  if (/\b(voucher|coupon|discount|promo|code|apply)\b/.test(lower)) return "apply_voucher";
  if (/\b(checkout|pay|complete order)\b/.test(lower)) return "checkout";
  if (/\b(help|support|issue|problem|complaint|refund|return)\b/.test(lower)) return "ticket";
  // Default conversational/product path ("need", "want" etc. are treated as product queries, not add-to-cart)
  return "general";
};

const fetchCartItems = async (cartId: string, currency: string = 'IDR'): Promise<Cart> => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: lines, error: linesErr } = await supabase
      .from('cart_products')
      .select('*')
      .eq('cart_id', cartId);

    if (linesErr || !lines) {
      return { items: [], subtotal_cents: 0, discount_cents: 0, total_cents: 0, voucher_code: null };
    }

    const items: LineItem[] = lines.map((line: any) => ({
      product_name: line.title_snapshot || line.product_id || 'Unknown Product',
      qty: line.qty || 0,
      unit_price_cents: Math.round((line.unit_price || 0) * 100),
      image_url: line.image_url || undefined,
      product_id: line.product_id,
      variant_id: line.variant_id,
    }));

    const subtotal_cents = items.reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);

    return {
      items,
      subtotal_cents,
      discount_cents: 0,
      total_cents: subtotal_cents,
      voucher_code: null,
    };
  } catch (error) {
    console.error('fetchCartItems error:', error);
    return { items: [], subtotal_cents: 0, discount_cents: 0, total_cents: 0, voucher_code: null };
  }
};

const logEvent = async (supabase: any, sessionId: string, userId: string | null, role: 'user' | 'assistant', content: string) => {
  try {
    await supabase.from('events').insert({
      session_id: sessionId,
      user_id: userId,
      event_type: 'message',
      metadata: { role, content },
    });
    // IMPORTANT: Do not write to n8n_chat_histories here to avoid duplicates on refresh.
  } catch (error) {
    console.error('Error logging event:', error);
  }
};

serve(async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  try {
    const body = await req.json();
    const { message = '', intent: hintedIntent, product_name: hintedProduct, qty: hintedQty } = body;
    const sessionId = body.session_id || crypto.randomUUID();
    let intent = hintedIntent || detectIntent(message);

    const supabaseSrv = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Prefer n8n_chat_histories for conversation history, fallback to events(metadata)
    async function loadHistory(sessionId: string): Promise<Array<{ role: 'user'|'assistant', content: string }>> {
      try {
        const { data } = await (supabaseSrv as any)
          .from('n8n_chat_histories')
          .select('message')
          .eq('session_id', sessionId)
          .order('id', { ascending: true })
          .limit(50);
        if (Array.isArray(data) && data.length) {
          return data
            .map((r: any) => ({ role: r.message?.role || 'user', content: r.message?.content || '' }))
            .filter((m: any) => typeof m.content === 'string');
        }
      } catch {}
      try {
        const { data } = await (supabaseSrv as any)
          .from('events')
          .select('metadata')
          .eq('session_id', sessionId)
          .eq('event_type', 'message')
          .order('created_at', { ascending: true })
          .limit(50);
        return (data || []).map((r: any) => ({ role: r.metadata?.role || 'user', content: r.metadata?.content || '' }));
      } catch { return []; }
    }

    // --- Helper: product search (vector first, fallback keyword) ---
    async function vectorSearchProducts(query: string, limit = 6, threshold = 0.25) {
      if (!OPENAI_API_KEY) return [] as Array<any>;
      try {
        const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'text-embedding-3-small', input: query })
        });
        if (!embedRes.ok) return [];
        const { data } = await embedRes.json();
        const embedding = data?.[0]?.embedding as number[] | undefined;
        if (!embedding) return [];
        const { data: matches } = await (supabaseSrv as any).rpc('match_products', {
          query_embedding: embedding,
          match_threshold: threshold,
          match_count: Math.max(6, limit * 3)
        });
        const rows = (matches || []).slice(0, limit);
        return rows.map((row: any) => {
          const md = row.metadata || {};
          const price = typeof md.price === 'number' ? md.price : (typeof md.price_min === 'number' ? md.price_min : 0);
          const img = md.image_url || (Array.isArray(md.images) && md.images[0]?.src) || null;
          return {
            id: row.id,
            name: md.title || row.content || 'Product',
            price_cents: Math.round(Number(price) * 100),
            image_url: img || undefined,
            variant_id: md.variant_id || row.variant_id || row.id,
            description: typeof md.description === 'string' && md.description ? md.description : (typeof row.content === 'string' ? String(row.content).slice(0, 200) : undefined),
            tags: Array.isArray(md.tags) ? md.tags.filter((t: any) => typeof t === 'string') : [],
            images: Array.isArray(md.images) ? md.images.map((im: any) => im?.src || im).filter(Boolean).slice(0, 5) : undefined,
            type: typeof md.type === 'string' ? md.type : undefined,
          };
        });
      } catch { return [] as Array<any>; }
    }

    async function keywordSearchProducts(query: string, limit = 6) {
      try {
        const lower = (query || '').toLowerCase();
        const terms = Array.from(new Set(lower.split(/[^a-z0-9]+/).filter(Boolean))).slice(0, 8);
        if (!terms.length) return [];
        // Focus on type and title which are well-populated
        const ors: string[] = [];
        for (const t of terms) {
          const like = `%${t}%`;
          ors.push(`metadata->>type.ilike.${like}`);
          ors.push(`metadata->>title.ilike.${like}`);
        }
        let queryBuilder = (supabaseSrv as any)
          .from('products')
          .select('id, content, metadata, variant_id');
        if (ors.length) queryBuilder = queryBuilder.or(ors.join(','));
        const { data: rows } = await queryBuilder.limit(limit * 3);
        return (rows || []).slice(0, limit).map((row: any) => {
          const md = row.metadata || {};
          const price = typeof md.price === 'number' ? md.price : (typeof md.price_min === 'number' ? md.price_min : 0);
          const img = md.image_url || (Array.isArray(md.images) && md.images[0]?.src) || null;
          return {
            id: row.id,
            name: md.title || row.content || 'Product',
            price_cents: Math.round(Number(price) * 100),
            image_url: img || undefined,
            variant_id: md.variant_id || row.variant_id || row.id,
            description: typeof md.description === 'string' && md.description ? md.description : (typeof row.content === 'string' ? String(row.content).slice(0, 200) : undefined),
            tags: Array.isArray(md.tags) ? md.tags.filter((t: any) => typeof t === 'string') : [],
            images: Array.isArray(md.images) ? md.images.map((im: any) => im?.src || im).filter(Boolean).slice(0, 5) : undefined,
            type: typeof md.type === 'string' ? md.type : undefined,
          };
        });
      } catch { return [] as Array<any>; }
    }

    async function searchProductsSmart(query: string, limit = 6) {
      let products = await vectorSearchProducts(query, limit);
      if (!products.length) products = await keywordSearchProducts(query, limit);
      return products;
    }

    // Simple upsell: given cart categories, suggest complementary categories (e.g., serum with moisturizer)
    function complementaryCategories(categories: string[]): string[] {
      const set = new Set(categories.map((c) => c.toLowerCase()));
      const out: string[] = [];
      if (set.has('moisturizer')) out.push('serum', 'sunscreen');
      if (set.has('serum')) out.push('moisturizer', 'sunscreen');
      if (set.has('cleanser')) out.push('toner', 'moisturizer');
      if (set.has('toner')) out.push('serum', 'moisturizer');
      if (set.has('sunscreen')) out.push('cleanser', 'moisturizer');
      if (set.has('mask')) out.push('serum', 'moisturizer');
      // catch-all for unknown categories
      if (set.size === 0) out.push('sunscreen');
      if (out.length === 0) out.push('serum', 'moisturizer');
      return Array.from(new Set(out));
    }

    async function getCartCategories(supabase: any, cartId: string): Promise<string[]> {
      try {
        const { data: lines } = await supabase
          .from('cart_products')
          .select('product_id, variant_id')
          .eq('cart_id', cartId);
        const vIds = (lines || []).map((l: any) => l.variant_id).filter(Boolean);
        const pIds = (lines || []).map((l: any) => l.product_id).filter(Boolean);
        const cats = new Set<string>();
        if (vIds.length) {
          const { data } = await supabase.from('products').select('variant_id, metadata').in('variant_id', vIds as any);
          for (const r of data || []) extractCategoriesFromProductRow(r).forEach((c)=>cats.add(c));
        }
        if (pIds.length) {
          const { data } = await supabase.from('products').select('id, metadata').in('id', pIds as any);
          for (const r of data || []) extractCategoriesFromProductRow(r).forEach((c)=>cats.add(c));
        }
        return Array.from(cats);
      } catch { return []; }
    }

    async function computeUpsellForCart(cart: any, cartId: string): Promise<any[]> {
      try {
        const cartCats = await getCartCategories(supabaseSrv, cartId);
        let wanted = complementaryCategories(cartCats);
        if (!wanted.length) wanted = ['serum', 'moisturizer', 'sunscreen'];

        // Aggregate candidates by running keyword search per category (more robust than embeddings here)
        const aggregated: any[] = [];
        for (const cat of wanted) {
          const rows = await keywordSearchProducts(cat, 6);
          aggregated.push(...rows);
        }
        // Dedupe by id/variant
        const seen = new Set<string>();
        const inCartIds = new Set<string>((cart.items || []).map((i: any) => String(i.variant_id || i.product_id || '')).filter(Boolean));
        const list: any[] = [];
        for (const p of aggregated) {
          const key = String(p.variant_id || p.id || '');
          if (!key || seen.has(key) || inCartIds.has(key)) continue;
          seen.add(key);
          list.push(p);
          if (list.length >= 6) break;
        }
        if (list.length) return list.slice(0, 4);

        // Final fallback: latest products not in cart
        try {
          const { data: rows } = await (supabaseSrv as any)
            .from('products')
            .select('id, content, metadata, variant_id')
            .order('created_at', { ascending: false })
            .limit(12);
          const mapped = (rows || []).map((row: any) => {
            const md = row.metadata || {};
            const price = typeof md.price === 'number' ? md.price : (typeof md.price_min === 'number' ? md.price_min : 0);
            const img = md.image_url || (Array.isArray(md.images) && md.images[0]?.src) || null;
            return {
              id: row.id,
              name: md.title || row.content || 'Product',
              price_cents: Math.round(Number(price) * 100),
              image_url: img || undefined,
              variant_id: md.variant_id || row.variant_id || row.id,
              description: typeof md.description === 'string' && md.description ? md.description : (typeof row.content === 'string' ? String(row.content).slice(0, 200) : undefined),
              tags: Array.isArray(md.tags) ? md.tags.filter((t: any) => typeof t === 'string') : [],
              images: Array.isArray(md.images) ? md.images.map((im: any) => im?.src || im).filter(Boolean).slice(0, 5) : undefined,
              type: typeof md.type === 'string' ? md.type : undefined,
            };
          });
          const filtered = mapped.filter((p: any) => !inCartIds.has(String(p.variant_id || p.id || '')));
          return filtered.slice(0, 4);
        } catch {}
      } catch {}
      return [];
    }

    async function computeBundleUpsell(cart: any, cartId: string): Promise<any[]> {
      try {
        // Do not suggest bundles if the cart is empty
        const hasItems = Array.isArray(cart?.items) && cart.items.length > 0;
        if (!hasItems) return [];
        // Strategy: find bundles whose items intersect with complementary categories of the cart
        const cartCats = await getCartCategories(supabaseSrv, cartId);
        const wanted = complementaryCategories(cartCats);
        // Load bundles with their items
        const { data: bundles } = await (supabaseSrv as any)
          .from('bundles')
          .select('id, title, description, pricing_type, discount_value, active')
          .eq('active', true)
          .limit(20);
        const { data: items } = await (supabaseSrv as any)
          .from('bundle_items')
          .select('bundle_id, product_id, qty');
        const itemsByBundle = new Map<string, any[]>();
        for (const it of items || []) {
          const arr = itemsByBundle.get(it.bundle_id) || [];
          arr.push(it);
          itemsByBundle.set(it.bundle_id, arr);
        }
        const results: any[] = [];
        for (const b of bundles || []) {
          const its = itemsByBundle.get(b.id) || [];
          if (!its.length) continue;
          // Load product metadata for items to compute price and categories
          const pIds = its.map((x) => x.product_id).filter(Boolean);
          const { data: prods } = await (supabaseSrv as any)
            .from('products')
            .select('id, content, metadata, variant_id')
            .in('id', pIds as any);
          const mapped = (prods || []).map((row: any) => {
            const md = row.metadata || {};
            const price = typeof md.price === 'number' ? md.price : (typeof md.price_min === 'number' ? md.price_min : 0);
            const img = md.image_url || (Array.isArray(md.images) && md.images[0]?.src) || null;
            return {
              id: row.id,
              name: md.title || row.content || 'Product',
              price_cents: Math.round(Number(price) * 100),
              image_url: img || undefined,
              variant_id: md.variant_id || row.variant_id || row.id,
              categories: extractCategoriesFromProductRow(row),
            };
          });
          // Check if bundle matches wanted categories
          const bundleCats = new Set<string>();
          for (const p of mapped) for (const c of (p.categories || [])) bundleCats.add(c);
          const matchesWanted = wanted.length === 0 || wanted.some((c) => bundleCats.has(c));
          if (!matchesWanted) continue;
          const original = mapped.reduce((s, p) => s + (p.price_cents || 0), 0);
          let price = original;
          if (b.pricing_type === 'percent_off') price = Math.max(0, Math.round(original * (100 - Number(b.discount_value || 0)) / 100));
          else if (b.pricing_type === 'amount_off') price = Math.max(0, Math.round(original - Number(b.discount_value || 0) * 100));
          else if (b.pricing_type === 'fixed_price') price = Math.round(Number(b.discount_value || original * 0.9) * 100);
          const discountPercent = original > 0 ? Math.round((1 - price / original) * 100) : 0;
          results.push({
            id: b.id,
            title: b.title,
            description: b.description || undefined,
            items: mapped.map(({ categories, ...rest }) => rest),
            price_cents: price,
            original_price_cents: original,
            discount_percent: discountPercent,
          });
        }
        if (results.length > 0) return results.slice(0, 3);

        // Dynamic fallback bundles: include one cart item + additional random complementary items
        try {
          const cartItems = Array.isArray(cart?.items) ? cart.items : [];
          if (cartItems.length === 0) return [];
          const anchorLine = cartItems[0];
          const anchor = {
            id: anchorLine.product_id,
            variant_id: anchorLine.variant_id,
            name: anchorLine.product_name,
            price_cents: anchorLine.unit_price_cents || 0,
            image_url: anchorLine.image_url || null,
          };

          // Fetch candidate products (random/recent) and filter out cart items and same title
          const { data: all } = await (supabaseSrv as any)
            .from('products')
            .select('id, content, metadata, variant_id')
            .order('created_at', { ascending: false })
            .limit(30);
          const inCartIds = new Set<string>(cartItems.map((i: any) => String(i.product_id || '')).filter(Boolean));
          const candidates = (all || []).map((row: any) => {
            const md = row.metadata || {};
            const price = typeof md.price === 'number' ? md.price : (typeof md.price_min === 'number' ? md.price_min : 0);
            const img = md.image_url || (Array.isArray(md.images) && md.images[0]?.src) || null;
            return {
              id: row.id,
              name: md.title || row.content || 'Product',
              price_cents: Math.round(Number(price) * 100),
              image_url: img || undefined,
              variant_id: md.variant_id || row.variant_id || row.id,
              categories: extractCategoriesFromProductRow(row),
            };
          })
          .filter((p: any) => !inCartIds.has(String(p.id)) && String(p.name || '').toLowerCase() !== String(anchor.name || '').toLowerCase());

          // Ensure additional items are from categories NOT in the cart and with no duplicates among themselves
          const cartCatSet = new Set<string>((cartCats || []).map((c: any) => String(c)));
          const eligible = (candidates || []).filter((p: any) => Array.isArray(p.categories) && p.categories.some((c: any) => !cartCatSet.has(String(c))));
          const shuffled = [...eligible].sort(() => Math.random() - 0.5);
          const usedCats = new Set<string>(Array.from(cartCatSet));
          const picked: any[] = [];
          for (const p of shuffled) {
            const cats = (p.categories || []).map((c: any) => String(c));
            const cat = cats.find((c: string) => !usedCats.has(c));
            if (!cat) continue;
            usedCats.add(cat);
            picked.push(p);
            if (picked.length >= 2) break;
          }

          const others = picked;
          if (!others.length) return [];

          const items = [anchor, ...others].slice(0, 3).map((p) => ({ id: p.id, variant_id: p.variant_id, name: p.name, price_cents: p.price_cents, image_url: p.image_url }));
          const original = items.reduce((s, p) => s + (p.price_cents || 0), 0);
          const price = Math.max(0, Math.round(original * 0.90)); // 10% off
          const discountPercent = 10;
          return [{
            id: `dynamic-random-${Date.now()}`,
            title: 'Smart Routine Bundle',
            description: 'Cart item + complementary picks at 10% off.',
            items,
            price_cents: price,
            original_price_cents: original,
            discount_percent: discountPercent,
          }];
        } catch {}
        return [];
      } catch { return []; }
    }

    function applyUpsellDiscount(items: any[], percent: number = 10): any[] {
      try {
        return (items || []).map((p: any) => {
          const base = typeof p.price_cents === 'number' ? p.price_cents : 0;
          const discounted = Math.max(0, Math.round(base * (100 - percent) / 100));
          return {
            ...p,
            original_price_cents: base,
            price_cents: discounted,
            discount_percent: percent,
            upsell: true,
          };
        });
      } catch { return items || []; }
    }

    // Needs extraction via LLM (product_type, concerns, price_tier)
    async function extractNeeds(query: string, history: Array<any>) {
      if (!OPENAI_API_KEY) return {} as any;
      try {
        const sys = "Extract product recommendation needs. Reply JSON {product_type?:string, concerns?:string[], price_tier?:string}. Product types include: moisturizer, serum, cleanser, sunscreen, toner, mask, makeup.";
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST', headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: 'system', content: sys }, ...history.slice(-6), { role: 'user', content: query }], temperature: 0, response_format: { type: 'json_object' } })
        });
        const data = await res.json().catch(()=>({}));
        const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
        return parsed || {};
      } catch { return {} as any; }
    }

    // Ask the LLM to judge if we have enough specifics to recommend products.
    // Uses chat history to account for previously provided details.
    async function judgeSpecificityLLM(history: Array<{ role: string; content: string }>, lastUser: string): Promise<{ specific: boolean; missing?: { product_type?: boolean; concerns?: boolean; budget?: boolean }; reason?: string } | null> {
      if (!OPENAI_API_KEY) return null;
      try {
        const system = {
          role: 'system',
          content:
            'You decide if there is enough information to recommend concrete shopping products. Return ONLY strict JSON: {"specific": boolean, "missing": {"product_type"?: boolean, "concerns"?: boolean, "budget"?: boolean}}.\nDefinition of specific: true only if, considering the last 10 turns, the user provided (a) a concrete product type or item/category AND (b) at least one explicit skin need/concern (e.g., oily, acne, brightening, dark spots, anti-aging, sensitive, pores, hydrating, barrier, redness). Budget is optional but mark missing if absent.\nIf concerns are absent in both history and the last message, you MUST set specific=false with missing.concerns=true. Be deterministic.'
        } as any;
        const messages: any[] = [system, ...history.slice(-10), { role: 'user', content: lastUser }];
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: CHAT_MODEL, messages, temperature: 0, response_format: { type: 'json_object' } })
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => ({}));
        const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
        if (typeof parsed?.specific === 'boolean') {
          return parsed as any;
        }
      } catch {}
      return null;
    }

    function priceBucket(priceCents: number | undefined): 'budget' | 'mid' | 'premium' | undefined {
      if (typeof priceCents !== 'number' || !isFinite(priceCents)) return undefined;
      if (priceCents <= 150_000) return 'budget';
      if (priceCents <= 400_000) return 'mid';
      return 'premium';
    }

    function scoreProductByNeeds(p: any, needs: any): number {
      let score = 0;
      const name = String(p.name || '').toLowerCase();
      const type = String(p.type || '').toLowerCase();
      const tags: string[] = Array.isArray(p.tags) ? p.tags.map((t: any) => String(t).toLowerCase()) : [];
      const priceTier = priceBucket(p.price_cents);
      if (needs?.product_type) {
        const pt = String(needs.product_type).toLowerCase();
        if (type.includes(pt)) score += 3;
        else if (name.includes(pt)) score += 2;
      }
      if (Array.isArray(needs?.concerns)) {
        for (const c of needs.concerns) {
          const cc = String(c).toLowerCase();
          if (tags.includes(cc)) score += 1.5;
          else if (name.includes(cc)) score += 0.5;
        }
      }
      if (typeof needs?.price_tier === 'string') {
        if (priceTier === String(needs.price_tier).toLowerCase()) score += 1;
      }
      // modest preference for more images/description
      if (Array.isArray(p.images) && p.images.length > 0) score += 0.25;
      if (p.description) score += 0.25;
      return score;
    }

    function rerankProducts(products: any[], needs: any): any[] {
      return [...products]
        .map(p => ({ ...p, _score: scoreProductByNeeds(p, needs) }))
        .sort((a, b) => (b._score ?? 0) - (a._score ?? 0))
        .map(({ _score, ...rest }) => rest);
    }

    async function persistHistoryStructured(sessionId: string, message: any) {
      try { await (supabaseSrv as any).from('n8n_chat_histories').insert({ session_id: sessionId, message }); } catch {}
    }

    function hasConcern(text: string): boolean {
      return /(acne|oily|dry|combination|sensitive|redness|irritat|brighten|brightening|hyperpig|dark\s*spots?|blemish|wrinkle|aging|anti-?aging|firm|pore|pores|blackheads?|whiteheads?|hydrating|moisturizing|soothing|calming|repair|barrier)/i.test(String(text || ''));
    }

    function hasProductTypeText(text: string): boolean {
      return /(moisturizer|moisturiser|serum|cleanser|face\s*wash|sunscreen|\bspf\b|toner|mask|make\s*up|makeup|foundation|cushion|powder|concealer|lipstick|mascara|eyeliner|brow|blush|bronzer|highlighter|primer|setting\s*spray|palette)/i.test(String(text || ''));
    }

    function inferProductTypeFromHistory(history: Array<{ role: string; content: string }>): string | undefined {
      const typeMap: Array<[RegExp, string]> = [
        [/moistur/i, 'moisturizer'],
        [/serum/i, 'serum'],
        [/cleanser|wash/i, 'cleanser'],
        [/sunscreen|spf/i, 'sunscreen'],
        [/toner/i, 'toner'],
        [/mask/i, 'mask'],
        [/make\s?up|foundation|concealer/i, 'makeup'],
      ];
      for (const m of [...history].reverse().slice(0, 10)) {
        if (m.role !== 'user') continue;
        for (const [re, type] of typeMap) {
          if (re.test(String(m.content || ''))) return type;
        }
      }
      return undefined;
    }

    // Canonical category mapping (normalize collection names and product descriptors)
    function canonicalCategory(input: string | undefined | null): string | null {
      if (!input) return null;
      const s = String(input).trim().toLowerCase();
      // Only map explicit category names; avoid mapping benefits like "hydrating" to moisturizer
      if (/^moisturis(e|)r(s)?$/.test(s)) return 'moisturizer';
      if (/^facial\s+moisturizer$/.test(s)) return 'moisturizer';
      if (/^serum(s)?$/.test(s)) return 'serum';
      if (/^facial\s+serum(\s*&\s*essence)?$/.test(s)) return 'serum';
      if (/^cleanser(s)?$/.test(s)) return 'cleanser';
      if (/^sunscreen(s)?$/.test(s)) return 'sunscreen';
      if (/^face\s+sunscreen$/.test(s)) return 'sunscreen';
      if (/^body\s+sunscreen(\s*&\s*after\s*sun)?$/.test(s)) return 'sunscreen';
      if (/^toner(s)?$/.test(s)) return 'toner';
      if (/^face\s*\bmask\b.*packs$/.test(s)) return 'mask';
      if (/^face\s*mask\s*&\s*packs$/.test(s)) return 'mask';
      if (/^mask(s)?$/.test(s)) return 'mask';
      if (/^make\s?-?up$/.test(s) || /^makeup$/.test(s)) return 'makeup';
      if (s === 'all') return 'all';
      return null;
    }

    function extractCategoriesFromProductRow(row: any): string[] {
      const md = row?.metadata || {};
      const cats = new Set<string>();
      const c1 = canonicalCategory(md.type);
      if (c1) cats.add(c1);
      // Only use explicit tags for category inference to avoid false positives from descriptions
      if (Array.isArray(md.tags)) {
        for (const t of md.tags) {
          const c = canonicalCategory(String(t));
          if (c) cats.add(c);
        }
      }
      return Array.from(cats);
    }

    function parseArrayLike(value: any): string[] {
      if (Array.isArray(value)) return value as string[];
      if (typeof value === 'string') {
        const s = value.trim();
        if (!s) return [];
        // Try JSON first
        try {
          const arr = JSON.parse(s);
          if (Array.isArray(arr)) return arr;
        } catch {}
        // Postgres text[] often returns like "{A,B}" via other clients; handle that too
        if (s.startsWith('{') && s.endsWith('}')) {
          const inner = s.slice(1, -1);
          return inner.split(',').map((x) => x.replace(/^"|"$/g, '').trim()).filter(Boolean);
        }
        return [s];
      }
      return [];
    }

    function normalizeCollections(val: any): string[] {
      const raw = parseArrayLike(val);
      const out: string[] = [];
      for (const r of raw) {
        const c = canonicalCategory(String(r)) || String(r).toLowerCase();
        out.push(c);
      }
      return Array.from(new Set(out));
    }

    // Clarifier de-duplication helpers
    function isClarifierAsk(text: string | undefined | null): boolean {
      const s = String(text || '');
      return /to recommend the best fit, could you share/i.test(s) || /skin concerns.*(oily|acne|brightening|anti-?aging)/i.test(s);
    }
    async function clarifierAskedRecently(sessionId: string, windowMs = 4000): Promise<boolean> {
      try {
        const since = Date.now() - windowMs;
        const { data } = await (supabaseSrv as any)
          .from('events')
          .select('metadata, created_at')
          .eq('session_id', sessionId)
          .eq('event_type', 'message')
          .order('created_at', { ascending: false })
          .limit(5);
        for (const r of data || []) {
          const ts = new Date(r.created_at).getTime();
          if (ts < since) break;
          const role = r?.metadata?.role;
          const content = r?.metadata?.content;
          if (role === 'assistant' && isClarifierAsk(content)) return true;
        }
      } catch {}
      return false;
    }

    function userProvidedAnySpecifics(text: string): boolean {
      const t = String(text || '').toLowerCase();
      const hasType = hasProductTypeText(t);
      const hasConc = hasConcern(t);
      const hasBudget = /(under|below|budget|idr|rp|usd|price|affordable|expensive|\$\s?\d+|\d+\s?(k|rb|ribu))/i.test(t);
      return Boolean(hasType || hasConc || hasBudget);
    }

    // Escalate using LLM classification only (no regex gates)
    async function classifyNeedsHumanLLM(msg: string): Promise<boolean> {
      if (!OPENAI_API_KEY) return false;
      try {
        const sys = "Decide if this user request should be escalated to a human agent. Reply with pure JSON: { escalate: boolean }. Escalate if it concerns payment problems, billing, refunds, duplicate charges, missing confirmations/emails, account security, or anything requiring manual intervention beyond product recommendations, vouchers, cart or pricing.";
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
          body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: msg }], temperature: 0, response_format: { type: 'json_object' } })
        });
        const data = await res.json();
        const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
        return Boolean(parsed.escalate);
      } catch (_) { return false; }
    }
    // Escalate only for conversational/general flow
    if (intent === 'general') {
      const needsHuman = await classifyNeedsHumanLLM(message);
      if (needsHuman) {
        intent = 'ticket';
      }
    }

    if (intent === "get_cart_info") {
      try {
        const { data: ensured } = await supabaseSrv.rpc('ensure_cart', { 
          p_currency: 'IDR', 
          p_session_id: sessionId, 
          p_user_id: body.user_id || null 
        });
        
        if (ensured?.id) {
          const cart = await fetchCartItems(ensured.id, 'IDR');
          const output = cart.items.length === 0 
            ? "Your cart is empty."
            : `Your cart has ${cart.items.length} item${cart.items.length > 1 ? 's' : ''}.`;
          
          await logEvent(supabaseSrv, sessionId, body.user_id, 'user', message || 'show cart');
          await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', output);
          
          // Compute bundle suggestions for modal on cart page
          let bundles: any[] = [];
          try { bundles = await computeBundleUpsell(cart, ensured.id); } catch {}
          return new Response(
            JSON.stringify({ output, cart, returnCart: true, bundles }),
            { headers }
          );
        }
      } catch (error) {
        console.error('get_cart_info error:', error);
      }
      
      return new Response(
        JSON.stringify({ output: "Your cart is empty.", cart: { items: [], subtotal_cents: 0, discount_cents: 0, total_cents: 0, voucher_code: null } }),
        { headers }
      );
    }

    if (intent === "get_upsell") {
      try {
        const { data: ensured } = await supabaseSrv.rpc('ensure_cart', {
          p_currency: 'IDR',
          p_session_id: sessionId,
          p_user_id: body.user_id || null,
        });
        const cartId = ensured?.id;
        if (cartId) {
          const cart = await fetchCartItems(cartId, 'IDR');
          // Do not return upsell/bundles when the cart is empty
          if (!Array.isArray(cart.items) || cart.items.length === 0) {
            return new Response(JSON.stringify({ output: '', upsell: [], bundles: [] }), { headers });
          }
          let upsell: any[] = [];
          let bundles: any[] = [];
          try {
            const cartCats = await getCartCategories(supabaseSrv, cartId);
            const wanted = complementaryCategories(cartCats);
            if (wanted.length) {
              const q = wanted.join(' ');
              let candidates = await searchProductsSmart(q, 8);
              const inCartIds = new Set<string>(
                (cart.items || [])
                  .map((i: any) => [String(i.variant_id || ''), String(i.product_id || '')])
                  .flat()
                  .filter(Boolean)
              );
              upsell = (candidates || []).filter((p: any) => !inCartIds.has(String(p.variant_id || p.id || ''))).slice(0, 4);
              upsell = applyUpsellDiscount(upsell, 10);
            }
          } catch {}
          try { bundles = await computeBundleUpsell(cart, cartId); } catch {}
          const output = (upsell.length || bundles.length) ? 'You may also like these to complete your routine:' : '';
          if (output) await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', output);
          return new Response(JSON.stringify({ output, upsell, bundles }), { headers });
        }
      } catch (e) {
        console.error('get_upsell error:', e);
      }
      return new Response(JSON.stringify({ upsell: [] }), { headers });
    }

    if (intent === "delete_cart") {
      try {
        const cartIds: string[] = [];
        // Clear ALL active carts tied to this session
        try {
          const { data: bySession } = await supabaseSrv
            .from('carts')
            .select('id')
            .eq('status', 'active')
            .eq('session_id', sessionId);
          for (const r of bySession || []) {
            if (r?.id && !cartIds.includes(r.id)) cartIds.push(r.id);
          }
        } catch {}
        // And ALL active carts tied to this user (if provided)
        try {
          if (body.user_id) {
            const { data: byUser } = await supabaseSrv
              .from('carts')
              .select('id')
              .eq('status', 'active')
              .eq('user_id', body.user_id);
            for (const r of byUser || []) {
              if (r?.id && !cartIds.includes(r.id)) cartIds.push(r.id);
            }
          }
        } catch {}

        if (cartIds.length) {
          await supabaseSrv
            .from('cart_products')
            .delete()
            .in('cart_id', cartIds as any);
          // Best-effort: clear any applied voucher reference
          try {
            await supabaseSrv
              .from('carts')
              .update({ voucher_id: null })
              .in('id', cartIds as any);
          } catch {}
        }

        const output = "Cart cleared.";
        await logEvent(supabaseSrv, sessionId, body.user_id, 'user', message || 'clear cart');
        await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', output);

        return new Response(
          JSON.stringify({
            output,
            cart: { items: [], subtotal_cents: 0, discount_cents: 0, total_cents: 0, voucher_code: null },
            returnCart: true
          }),
          { headers }
        );
      } catch (error) {
        console.error('delete_cart error:', error);
      }

      return new Response(
        JSON.stringify({ output: "Cart cleared.", cart: { items: [], subtotal_cents: 0, discount_cents: 0, total_cents: 0, voucher_code: null } }),
        { headers }
      );
    }

    if (intent === "add_bundle") {
      try {
        const items = Array.isArray((body as any)?.items) ? (body as any).items : [];
        const discountPercent = Number((body as any)?.discount_percent || 10);
        const { data: ensured } = await supabaseSrv.rpc('ensure_cart', { 
          p_currency: 'IDR', 
          p_session_id: sessionId, 
          p_user_id: body.user_id || null 
        });
        if (!ensured?.id) return new Response(JSON.stringify({ error: 'Cart unavailable' }), { status: 500, headers });
        const cartId = ensured.id;

        // Build a set of existing product ids/variant ids to dedupe
        const { data: existingLines } = await supabaseSrv
          .from('cart_products')
          .select('id, product_id, variant_id, title_snapshot, unit_price')
          .eq('cart_id', cartId);
        const byKey = new Map<string, any>();
        const byTitle = new Map<string, any>();
        for (const l of existingLines || []) {
          const key = String(l.product_id || l.variant_id || '');
          if (key) byKey.set(key, l);
          const t = (l.title_snapshot || '').toString().trim().toLowerCase();
          if (t) byTitle.set(t, l);
        }

        async function resolveProduct(productId: string | null, name: string): Promise<{ id: string | null, variant_id: string | null, price_cents?: number, image_url?: string, title?: string }> {
          try {
            if (productId) {
              const { data: row } = await supabaseSrv.from('products').select('id, variant_id, metadata').eq('id', productId).maybeSingle();
              if (row?.id) {
                const md = row.metadata || {};
                const price = typeof md.price === 'number' ? md.price : (typeof md.price_min === 'number' ? md.price_min : 0);
                const img = md.image_url || (Array.isArray(md.images) && md.images[0]?.src) || null;
                return { id: row.id, variant_id: row.variant_id || null, price_cents: Math.round(Number(price) * 100), image_url: img || undefined, title: md.title };
              }
            }
            const like = `%${name}%`;
            const { data: rows } = await supabaseSrv
              .from('products')
              .select('id, variant_id, metadata')
              .ilike('metadata->>title', like)
              .limit(1);
            if (rows && rows.length) {
              const md = rows[0].metadata || {};
              const price = typeof md.price === 'number' ? md.price : (typeof md.price_min === 'number' ? md.price_min : 0);
              const img = md.image_url || (Array.isArray(md.images) && md.images[0]?.src) || null;
              return { id: rows[0].id, variant_id: rows[0].variant_id || null, price_cents: Math.round(Number(price) * 100), image_url: img || undefined, title: md.title };
            }
          } catch {}
          return { id: productId, variant_id: null };
        }

        for (const raw of items) {
          let productId = String(raw.id || raw.product_id || '') || null;
          let variantId = String(raw.variant_id || raw.id || '') || null;
          const name = String(raw.name || 'Bundle Item');
          let imageUrl = raw.image_url || null;
          let priceCents = Number(raw.price_cents || 0);
          if (!productId) {
            const resolved = await resolveProduct(productId, name);
            productId = resolved.id;
            if (!variantId) variantId = resolved.variant_id;
            if (!priceCents && resolved.price_cents) priceCents = resolved.price_cents;
            if (!imageUrl && resolved.image_url) imageUrl = resolved.image_url as any;
          }
          if (!productId && !variantId) continue;
          const key = String(productId || variantId);
          const discounted = Math.max(0, Math.round(priceCents * (100 - discountPercent) / 100));
          const existing = byKey.get(key) || byTitle.get(name.trim().toLowerCase());
          if (existing) {
            // Update existing line price to discounted (no qty change)
            await supabaseSrv
              .from('cart_products')
              .update({
                unit_price: discounted / 100,
                title_snapshot: existing.title_snapshot && existing.title_snapshot.includes('Bundle Discount')
                  ? existing.title_snapshot
                  : `${existing.title_snapshot || name} (Bundle Discount)`,
              })
              .eq('id', existing.id);
          } else {
            await supabaseSrv
              .from('cart_products')
              .insert({
                cart_id: cartId,
                product_id: productId || name,
                variant_id: variantId || productId || name,
                qty: 1,
                unit_price: discounted / 100,
                title_snapshot: `${name} (Bundle Discount)`,
                image_url: imageUrl,
              });
          }
        }

        const updatedCart = await fetchCartItems(cartId, 'IDR');
        await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', 'Bundle added to cart.');
        return new Response(JSON.stringify({ output: 'Bundle added to cart.', cart: updatedCart, returnCart: true }), { headers });
      } catch (e) {
        console.error('add_bundle error:', e);
        return new Response(JSON.stringify({ error: 'Unable to add bundle' }), { status: 500, headers });
      }
    }

    if (intent === "add_line" || intent === "edit_line" || intent === "delete_line") {
      // Extract product info from request body if available
      const requestedProductId = body.product_id;
      const requestedVariantId = body.variant_id;
      const requestedProductName = body.product_name || hintedProduct;
      const requestedQty = body.qty || hintedQty || 1;
      const requestedPrice = body.unit_price_cents;
      const requestedImage = body.image_url;
      
      try {
        // Ensure cart exists
        const { data: ensured, error: ensureErr } = await supabaseSrv.rpc('ensure_cart', { 
          p_currency: 'IDR', 
          p_session_id: sessionId, 
          p_user_id: body.user_id || null 
        });
        
        if (ensureErr || !ensured?.id) {
          console.error('ensure_cart failed:', ensureErr);
          return new Response(
            JSON.stringify({ error: "Cart unavailable" }),
            { status: 500, headers }
          );
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

        // Generate upsell (robust path)
        let upsell: any[] = [];
        let bundles: any[] = [];
        try { upsell = await computeUpsellForCart(updatedCart, cartId); upsell = applyUpsellDiscount(upsell, 10); } catch {}
        try { bundles = await computeBundleUpsell(updatedCart, cartId); } catch {}
        
        return new Response(
          JSON.stringify({ output, cart: updatedCart, returnCart: true, upsell, bundles }),
          { headers }
        );
      } catch (error) {
        console.error('Cart operation error:', error);
        return new Response(
          JSON.stringify({ error: "Cart unavailable" }),
          { status: 500, headers }
        );
      }
    }

    if (intent === "apply_voucher") {
      try {
        const { data: ensured } = await supabaseSrv.rpc('ensure_cart', { 
          p_currency: 'IDR', 
          p_session_id: sessionId, 
          p_user_id: body.user_id || null 
        });
        
        if (ensured?.id) {
          const cart = await fetchCartItems(ensured.id, 'IDR');
          // Build lookup for cart lines → product types
          const lineVariantIds = (cart.items || []).map(i => i.variant_id).filter(Boolean);
          const lineProductIds = (cart.items || []).map(i => i.product_id).filter(Boolean);
          const catsByVariant = new Map<string, string[]>();
          const catsByProduct = new Map<string, string[]>();
          try {
            if (lineVariantIds.length) {
              const { data: pv } = await (supabaseSrv as any)
                .from('products')
                .select('id, variant_id, metadata')
                .in('variant_id', lineVariantIds as any);
              for (const r of pv || []) {
                const cats = extractCategoriesFromProductRow(r);
                if (r?.variant_id && cats.length) catsByVariant.set(String(r.variant_id), cats);
              }
            }
            if (lineProductIds.length) {
              const { data: pp } = await (supabaseSrv as any)
                .from('products')
                .select('id, variant_id, metadata')
                .in('id', lineProductIds as any);
              for (const r of pp || []) {
                const cats = extractCategoriesFromProductRow(r);
                if (r?.id && cats.length) catsByProduct.set(String(r.id), cats);
              }
            }
          } catch {}
          const typesInCart = new Set<string>();
          for (const item of cart.items) {
            const cats = (catsByVariant.get(String(item.variant_id || '')) || catsByProduct.get(String(item.product_id || '')) || []).map((x)=>String(x).toLowerCase());
            for (const c of cats) typesInCart.add(c);
          }

          // Load active vouchers and split into usable vs unusable based on collections/products
          let usable: Array<any> = [];
          let unusable: Array<{ code: string; reason: string }>[] | any = [];
          const now = Date.now();
          try {
            const { data: vs } = await supabaseSrv
              .from('vouchers')
              .select('*')
              .eq('active', true);
            for (const v of vs || []) {
              // base checks
              if (v.expires_at && new Date(v.expires_at).getTime() < now) continue;
              if (typeof v.min_subtotal_cents === 'number' && cart.subtotal_cents < v.min_subtotal_cents) continue;

              const colls: string[] = normalizeCollections(v.applicable_collections);
              const prods: string[] = Array.isArray(v.applicable_products) ? v.applicable_products : [];
              const collsLower = colls;
              const typesArray = Array.from(typesInCart.values());
              const collOk = !collsLower.length || collsLower.includes('all') || typesArray.some((t) => collsLower.includes(t));
              let prodOk = true;
              if (prods.length) {
                const ids = new Set<string>([
                  ...lineVariantIds.map(String),
                  ...lineProductIds.map(String),
                ]);
                prodOk = prods.some((p: any) => ids.has(String(p)));
              }

              // If collections are specified but we couldn't infer any categories from cart, treat as not usable
              const hasCollectionsConstraint = Array.isArray(collsLower) && collsLower.length > 0 && !collsLower.includes('all');
              const hasAnyCartCategory = typesArray.length > 0;
              const isUsable = Boolean(collOk && prodOk && (!hasCollectionsConstraint || hasAnyCartCategory));
              const base = {
                code: v.code,
                description: v.type === 'percent' ? `${v.value}% off` : v.type === 'fixed' ? `${currency(v.value)} off` : 'Free shipping',
                type: v.type,
                value: v.value,
                min_subtotal_cents: v.min_subtotal_cents || 0,
                estimated_savings_cents: v.type === 'percent' ? Math.round((cart.subtotal_cents || 0) * (Number(v.value || 0) / 100)) : Number(v.value || 0)
              };
              if (isUsable) {
                usable.push(base);
              } else {
                let reason = '';
                if (prods.length) reason = `only for selected products`;
                if (collsLower.length && !collsLower.includes('all')) {
                  const readable = colls.join(', ');
                  reason = reason ? `${reason}; requires ${readable}` : `only for ${readable}`;
                }
                if (!reason) reason = 'not applicable to current cart';
                (unusable as any).push({ code: v.code, reason });
              }
            }
          } catch {}

          const codeMatch = (message).match(/[A-Z0-9]{4,}/i);
          const code = codeMatch ? codeMatch[0].toUpperCase() : null;
          let output = code ? `Applied voucher ${code}.` : 'Here are the usable vouchers for your cart.';
          if (!code && (unusable as any).length) {
            const lines = (unusable as any).slice(0, 6).map((u: any) => `- ${u.code}: ${u.reason}`);
            const hintTypes = Array.from(typesInCart.values()).map((s) => s).join(', ') || 'the eligible collection';
            output += `\n\nThese are not usable right now:\n${lines.join('\n')}\n\nTo use them, add items from the required collection(s) and try again.`;
          }
            
          await logEvent(supabaseSrv, sessionId, body.user_id, 'user', message || 'apply voucher');
          await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', output);
          return new Response(
            JSON.stringify({ output, cart, returnCart: true, vouchers: usable }),
            { headers }
          );
        }
      } catch (error) {
        console.error('apply_voucher error:', error);
      }
      
      return new Response(
        JSON.stringify({ output: "Unable to apply voucher." }),
        { headers }
      );
    }

    if (intent === "general") {
      await logEvent(supabaseSrv, sessionId, body.user_id, 'user', message);
      // Let the LLM answer with history (prefer chat histories)
      const history = await loadHistory(sessionId);
      let draft = "How can I help you with skincare products today?";
      try { draft = await (async () => {
        if (!OPENAI_API_KEY) return draft;
        const system = { role: 'system', content: 'You are a helpful skincare shopping assistant. Keep replies concise (1-2 sentences). Never mention external brand or product names; keep advice generic (e.g., "lightweight oil-free moisturizer"). If the user seems to want products, keep the text minimal because the UI will show a product list.' } as any;
        const bodyLLM: any = { model: CHAT_MODEL, messages: [system, ...history.slice(-10), { role: 'user', content: message }], temperature: 0.7, max_tokens: 180 };
        const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(bodyLLM) });
        if (!res.ok) return draft;
        const j = await res.json();
        return j.choices?.[0]?.message?.content || draft;
      })(); } catch {}

      // Product recommendation clarifier: try to produce structured recommendations
      // Narrower detection so non-product questions (e.g., "how many categories ...") don't trigger
      const typeOrConcern = /(moistur|serum|cleanser|sunscreen|toner|mask|spf|acne|oily|dry|sensitive|brighten|brightening|hyperpig|wrinkle|aging|anti-?aging|dark\s?spots?|blemish|pores?|blackheads?|whiteheads?|oil\s?control)/i;
      const buyOrRecommend = /(recommend|suggest|show\b|need|want|looking\s*for|buy|price|budget)/i;
      const looksLikeProductQuery = typeOrConcern.test(message) || buyOrRecommend.test(message);
      const askedClarifierRecentlyLocal = [...history]
        .reverse()
        .slice(0, 6)
        .some((m: any) => m.role === 'assistant' && /(product\s*type|skincare\s*type|skin\s*concerns?|price\s*range|help\s*me\s*recommend|recommend\s+the\s+best)/i.test(String(m.content || '')));
      // Follow-up to clarifier if user provides concerns/budget/type without explicitly asking for products
      const isClarifierFollowup = /(acne|oily|dry|sensitive|brighten|dark\s*spots?|aging|wrinkle|pore|blackheads?|whiteheads?|hydrating|soothing|calming|barrier|redness|under|below|budget|idr|rp|usd|\$\s?\d+|\d+\s?(k|rb|ribu)|\b(serum|moisturizer|moisturiser|cleanser|sunscreen|spf|toner|mask)\b)/i.test(message);
      if (looksLikeProductQuery || (askedClarifierRecentlyLocal && isClarifierFollowup)) {
        // LLM-based specificity check using full chat history
        let shouldAskClarifier = false;
        try {
          const duplicateClarifier = await clarifierAskedRecently(sessionId, 5000);
          const judge = duplicateClarifier ? null : await judgeSpecificityLLM(history, message);
          if (judge && judge.specific === false) {
            shouldAskClarifier = true;
            const wantType = judge?.missing?.product_type;
            const wantConcerns = judge?.missing?.concerns;
            const wantBudget = judge?.missing?.budget;
            const bits: string[] = [];
            if (wantType) bits.push('product type (e.g., serum, moisturizer, cleanser, sunscreen, toner)');
            if (wantConcerns) bits.push('your skin concerns (e.g., oily, acne, brightening, anti-aging)');
            if (wantBudget) bits.push('a budget range');
            const ask = bits.length
              ? `To recommend the best fit, could you share ${bits.join(', ')}?`
              : 'To recommend the best fit, could you share the product type, your skin concerns, and your budget?';
            await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', ask);
            return new Response(JSON.stringify({ output: ask, debug: { backend: 'supabase', stage: 'clarifier_llm' } }), { headers });
          }
          // If the judge is unavailable (no key/timeout) fall back to a simple guard, unless we just asked
          if (!judge && !duplicateClarifier) {
            const lower = (message || '').toLowerCase();
            const typeOnly = /(\bserum\b|moisturizer|moisturiser|cleanser|face\s*wash|sunscreen|\bspf\b|toner|mask|make\s?up|makeup)\b/i.test(lower);
            const hasConcern = /(acne|oily|dry|sensitive|brighten|dark\s*spots?|aging|wrinkle|pore|blackheads?|whiteheads?|hydrating|soothing|calming|barrier|redness)/i.test(lower);
            const hasBudget = /(under|below|budget|idr|rp|usd|price|affordable|expensive|\$\s?\d+|\d+\s?(k|rb|ribu))/i.test(lower);
            if (typeOnly && (!hasConcern || !hasBudget)) {
              const ask = 'To recommend the best fit, could you share your skin concerns (e.g., oily, acne, brightening, anti-aging) and your budget range?';
              await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', ask);
              return new Response(JSON.stringify({ output: ask, debug: { backend: 'supabase', stage: 'clarifier_fallback' } }), { headers });
            }
          }
        } catch {}

        // Hard requirement: if there is no concern mentioned anywhere in the last few user turns
        // and the current message has only a product type, force a one-time clarifier.
        try {
          const duplicateClarifier2 = await clarifierAskedRecently(sessionId, 5000);
          if (!duplicateClarifier2 && !userProvidedAnySpecifics(message)) {
          const recentUserText = [...history].reverse().filter((m:any)=>m.role==='user').slice(0,6).map((m:any)=>String(m.content||'')).join(' \n ');
          const hasAnyConcernInHistory = hasConcern(recentUserText);
          const currentHasType = hasProductTypeText(message);
          const currentHasConcern = hasConcern(message);
          if (currentHasType && !currentHasConcern && !hasAnyConcernInHistory) {
            const ask = 'Could you share your skin concerns (e.g., oily, acne, brightening, anti-aging) and your budget range?';
            await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', ask);
            return new Response(JSON.stringify({ output: ask, debug: { backend: 'supabase', stage: 'clarifier_hard' } }), { headers });
          }
          }
        } catch {}
        const needs = await extractNeeds(message, history);
        // Fill product_type from prior user messages if missing
        if (!needs?.product_type) {
          const inferred = inferProductTypeFromHistory(history);
          if (inferred) needs.product_type = inferred;
        }
        const enrichedQuery = [needs?.product_type, ...(needs?.concerns || []), message].filter(Boolean).join(' ');
        let products = await searchProductsSmart(enrichedQuery, 8);
        // Re-rank by needs
        if (products.length) products = rerankProducts(products, needs).slice(0, 6);

        // Detect if previous assistant asked a clarifier
        const lastAssistant = Array.isArray(history) ? [...history].reverse().find((m: any) => m.role === 'assistant') : null;
        const previouslyAskedClarifier = lastAssistant && /share the product type|skin concerns|price range/i.test(String(lastAssistant.content || ''));

        // If empty, ask for clarifier or fallback to closest matches if already asked before
        if (!products.length) {
          if (previouslyAskedClarifier) {
            // Still empty → closest matches with lower threshold
            let closest = await vectorSearchProducts(enrichedQuery, 6, 0.05);
            if (!closest.length) closest = await keywordSearchProducts(enrichedQuery, 6);
            if (closest.length) {
              const msg = "I couldn't find an exact match for your needs. Here are the closest items we have:";
              await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', msg);
              return new Response(JSON.stringify({ output: msg, products: closest, debug: { backend: 'supabase', stage: 'closest_matches' } }), { headers });
            }
            const msg2 = "I couldn't find a match based on that. Could you rephrase or provide more details?";
            await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', msg2);
            await persistHistoryStructured(sessionId, { role: 'assistant', content: msg2, kind: 'text', clarifier: { needs } });
            return new Response(JSON.stringify({ output: msg2 }), { headers });
          }
          // First time asking clarifier
          // Suggest tags from top related items (if any)
          let tagHint = '';
          try {
            const probe = await vectorSearchProducts(message, 12, 0.15);
            const freq = new Map<string, number>();
            for (const p of probe) {
              (p.tags || []).forEach((t: string) => freq.set(t, (freq.get(t) || 0) + 1));
            }
            const topTags = Array.from(freq.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 5).map(([t])=>t);
            if (topTags.length) tagHint = ` For example: ${topTags.slice(0,3).join(', ')}.`;
          } catch {}
          const duplicateClarifier3 = await clarifierAskedRecently(sessionId, 5000);
          if (!duplicateClarifier3 && !userProvidedAnySpecifics(message)) {
            const ask = `To recommend the best fit, could you share the product type (moisturizer, serum, cleanser, sunscreen, toner), your skin concerns (e.g., oily, acne, brightening), and a price range?${tagHint}`;
            await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', ask);
            return new Response(JSON.stringify({ output: ask, debug: { backend: 'supabase', stage: 'clarifier_first' } }), { headers });
          }
        }

        // Weak matches: if top score is likely low (heuristic) → ask 1 follow-up instead
        // We infer score by recomputing quickly
        // If we have at least one product, prefer returning products rather than another tip

        // If we have matches, return them with a concise reply
        const reply = draft || 'Here are some recommendations based on your needs:';
        await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', reply);
        // Note: Frontend persists structured products; avoid duplicate DB insert here
        return new Response(JSON.stringify({ output: reply, products, debug: { backend: 'supabase', stage: 'products' } }), { headers });
      }
      // Escalate based on the LLM draft only (no keywords)
      try {
        if (OPENAI_API_KEY) {
          const sys = 'Return JSON {"escalate": boolean}. Set escalate=true if the assistant draft does not fully answer/resolve the user\'s last message OR if the user explicitly requests a ticket, a human agent, or customer support contact. Otherwise escalate=false.';
          const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` }, body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: `User: ${message}\nAssistantDraft: ${draft}` }], temperature: 0, response_format: { type: 'json_object' } }) });
          const data = await res.json().catch(() => ({}));
          const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
          if (parsed?.escalate === true) {
            const payload = [{ user_email: body.user_email || 'anonymous@example.com', message, category: 'general', session_id: sessionId, user_Id: body.user_id || 'anonymous', subject: (message || 'Customer support request').slice(0, 80) }];
            try { const r = await fetch(Deno.env.get('TICKET_WEBHOOK_URL') || 'https://primary-production-b68a.up.railway.app/webhook/ticket_create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (!r.ok) { try { console.error('Ticket webhook failed', r.status, await r.text()); } catch {} } } catch (e) { console.error('Ticket webhook error', e); }
            const reply = `I've created a support ticket so a human can assist you shortly. Subject: ${(message || 'Customer support request').slice(0, 80)}.`;
            await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', reply);
            return new Response(JSON.stringify({ output: reply, ticket_created: true }), { headers });
          }
        }
      } catch {}

      // Do NOT auto-show products for greetings, very short messages, or when the user isn't clearly asking about products
      try {
        const trimmed = String(message || '').trim();
        const looksLikeGreeting = /^(hi|hello|hey|halo|hai|yo|hiya|sup)\b/i.test(trimmed);
        // Heuristic: only fallback to products if text clearly indicates shopping intent or mentions a type/concern (avoid generic 'product'/'skincare')
        const productish = /(moistur|serum|cleanser|toner|mask|sunscreen|spf|recommend|suggest|buy|price|budget|under|idr|rp|usd)/i.test(trimmed);
        if (!looksLikeGreeting && trimmed.length >= 6 && productish) {
          const fallbackProducts = await searchProductsSmart(message, 6);
          if (fallbackProducts && fallbackProducts.length) {
            const reply = 'Here are the recommended products below.';
            await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', reply);
            return new Response(JSON.stringify({ output: reply, products: fallbackProducts }), { headers });
          }
        }
      } catch {}

      await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', draft);
      return new Response(JSON.stringify({ output: draft }), { headers });
    }

    if (intent === "ticket") {
      const webhookUrl = Deno.env.get('TICKET_WEBHOOK_URL') || 'https://primary-production-b68a.up.railway.app/webhook/ticket_create';
      let subject = 'Customer support request';
      let category = 'general';
      if (OPENAI_API_KEY) {
        try {
          const sys = `Extract concise subject and category for a customer support ticket from the user's last message. Return JSON {subject:string, category:string}. Categories: product_info, order, payment, shipping, return_refund, account, other.`;
          const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` }, body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: message }], temperature: 0, response_format: { type: 'json_object' } }) });
          const data = await res.json();
          const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
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
      const payload = [{ user_email: body.user_email || 'anonymous@example.com', message, category, session_id: sessionId, user_Id: body.user_id || 'anonymous', subject }];
      try { 
        const r = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); 
        if (!r.ok) { console.error('Ticket webhook failed', r.status, await r.text().catch(()=>'')); }
      } catch (e) { console.error('Ticket webhook error', e); }
      const output = `I've created a support ticket so a human can assist you shortly. Subject: ${subject}.`;
      await logEvent(supabaseSrv, sessionId, body.user_id, 'user', message);
      await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', output);
      return new Response(JSON.stringify({ output, ticket_created: true }), { headers });
    }

    // Fallback with LLM-based draft and escalation
    let fallbackDraft = "How can I help you with skincare products today?";
    try {
      if (OPENAI_API_KEY) {
        const history = await (async () => {
          try {
            const { data } = await (createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!))
              .from('events').select('payload').eq('session_id', sessionId).eq('type', 'message').order('created_at', { ascending: false }).limit(16);
            return (data || []).map((r: any) => ({ role: r.payload?.role || 'user', content: r.payload?.content || '' })).reverse();
          } catch { return []; }
        })();
        const system = { role: 'system', content: 'You are a helpful skincare shopping assistant. Keep replies concise (1-2 sentences).' } as any;
        const bodyLLM: any = { model: CHAT_MODEL, messages: [system, ...history.slice(-10), { role: 'user', content: message }], temperature: 0.7, max_tokens: 180 };
        const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(bodyLLM) });
        if (res.ok) { const j = await res.json(); fallbackDraft = j.choices?.[0]?.message?.content || fallbackDraft; }
        const sys = 'Return JSON {"escalate": boolean}. Set escalate=true if the assistant draft does not fully answer/resolve the user\'s last message OR if the user explicitly requests a ticket, a human agent, or customer support contact. Otherwise escalate=false.';
        const res2 = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` }, body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: `User: ${message}\nAssistantDraft: ${fallbackDraft}` }], temperature: 0, response_format: { type: 'json_object' } }) });
        const data2 = await res2.json().catch(() => ({}));
        const parsed2 = JSON.parse(data2?.choices?.[0]?.message?.content || '{}');
        if (parsed2?.escalate === true) {
          const payload = [{ user_email: body.user_email || 'anonymous@example.com', message, category: 'general', session_id: sessionId, user_Id: body.user_id || 'anonymous', subject: (message || 'Customer support request').slice(0, 80) }];
          try { const r = await fetch(Deno.env.get('TICKET_WEBHOOK_URL') || 'https://primary-production-b68a.up.railway.app/webhook/ticket_create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (!r.ok) { try { console.error('Ticket webhook failed', r.status, await r.text()); } catch {} } } catch (e) { console.error('Ticket webhook error', e); }
          const reply = `I've created a support ticket so a human can assist you shortly. Subject: ${(message || 'Customer support request').slice(0, 80)}.`;
          await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', reply);
          return new Response(JSON.stringify({ output: reply, ticket_created: true }), { headers });
        }
      }
    } catch {}
    await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', fallbackDraft);
    return new Response(JSON.stringify({ output: fallbackDraft }), { headers });
  } catch (err) {
    console.error('Server error:', err);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers }
    );
  }
});
