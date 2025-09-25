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
}

interface Cart {
  items: LineItem[];
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  voucher_code: string | null;
}

type Memory = {
  preferred_types?: string[];        // ["serum","sunscreen",...]
  concerns?: string[];               // ["acne","oily","brightening",...]
  budget_max_cents?: number | null;  // 2500000, etc.
  avoid_ingredients?: string[];      // ["fragrance","alcohol"]
  preferred_ingredients?: string[];  // ["niacinamide","bha"]
};

async function synthesizeMemoryFromHistory(history: any[]): Promise<Memory> {
  if (!OPENAI_API_KEY) return {};
  try {
    const sys = `From the chat history, extract durable shopping preferences for skincare.
Return ONLY JSON:
{
  "preferred_types": string[] | null,    // from explicit mentions (map synonyms), else null
  "concerns": string[] | null,           // e.g. ["acne","oily","sensitive","brightening"]
  "budget_max_cents": number | null,     // if user expresses a max budget; else null
  "avoid_ingredients": string[] | null,  // e.g. ["fragrance","alcohol"]
  "preferred_ingredients": string[] | null
}
Rules:
- Be conservative; do not invent.
- Parse implicit signals (e.g., “prefer fragrance-free” → avoid_ingredients=["fragrance"]).
- If multiple values appear, keep a small, deduplicated list.
- All strings lowercase.`;

    const body = {
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: sys },
        // last 20 turns is fine; you already have them cleanly shaped
        ...history.slice(-20)
      ],
      temperature: 0,
      response_format: { type: "json_object" as const }
    };

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(body)
    });

    if (!res.ok) return {};
    const data = await res.json();
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    return {
      preferred_types: Array.isArray(parsed.preferred_types) ? parsed.preferred_types : undefined,
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns : undefined,
      budget_max_cents: typeof parsed.budget_max_cents === "number" ? parsed.budget_max_cents : undefined,
      avoid_ingredients: Array.isArray(parsed.avoid_ingredients) ? parsed.avoid_ingredients : undefined,
      preferred_ingredients: Array.isArray(parsed.preferred_ingredients) ? parsed.preferred_ingredients : undefined
    };
  } catch {
    return {};
  }
}

const detectIntent = (message: string): string => {
  const lower = message.toLowerCase();
  if (lower.includes('add to cart') || lower.includes('add to bag')) return 'add_line';
  if (lower.includes('clear cart') || lower.includes('empty cart')) return 'delete_cart';
  if (lower.includes('show cart') || lower.includes('view cart')) return 'get_cart_info';
  if (lower.includes('voucher') || lower.includes('coupon')) return 'apply_voucher';
  return 'general';
};

const fetchCartItems = async (cartId: string): Promise<Cart> => {
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
  } catch (error) {
    console.error('Error logging event:', error);
  }
};

// Load conversation history
async function loadHistory(sessionId: string): Promise<Array<{ role: 'user'|'assistant', content: string }>> {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    const { data } = await supabase
      .from('n8n_chat_histories')
      .select('message')
      .eq('session_id', sessionId)
      .order('id', { ascending: true })
      .limit(20);
      
    if (Array.isArray(data) && data.length) {
      return data
        .map((r: any) => ({ role: r.message?.role || 'user', content: r.message?.content || '' }))
        .filter((m: any) => typeof m.content === 'string');
    }
  } catch {}
  
  return [];
}

// Combined LLM validation to reduce API calls
async function validateProductRequest(message: string, history: any[]): Promise<{
  isProductIntent: boolean;
  hasNeeds: boolean;
  needsClarifier: boolean;
  requestedType?: string;
  concerns?: string[];
  allowsProductNames: boolean;
  isInScope: boolean;
  needsTicket: boolean;
  explicitShowRequest: boolean;
  showRequestType?: string;
}> {
  if (!OPENAI_API_KEY) {
    return {
      isProductIntent: true,
      hasNeeds: true,
      needsClarifier: false,
      allowsProductNames: true,
      isInScope: true,
      needsTicket: false,
      explicitShowRequest: false,
    };
  }

  try {
    const sys = `Analyze this skincare chat interaction. Return JSON with:
{
  "isProductIntent": boolean,
  "hasNeeds": boolean,
  "needsClarifier": boolean,
  "requestedType": string|null,
  "concerns": string[],
  "allowsProductNames": boolean,
  "isInScope": boolean,
  "needsTicket": boolean,
  "explicitShowRequest": boolean,
  "showRequestType": string|null
}

Guidelines:
- isProductIntent: true if user seeks product recommendations/suggestions OR explicitly asks to see products
- hasNeeds: true ONLY if user provided BOTH a specific product type (serum, moisturizer, cleanser, sunscreen, toner, mask, makeup, essence) AND skin concerns
- needsClarifier: true if product intent but missing EITHER specific type OR concerns
- requestedType: normalize to serum|moisturizer|cleanser|sunscreen|toner|mask|makeup|essence (MUST be one of these exact types)
- concerns: extract explicit skin concerns (oily, acne, brightening, etc)
- allowsProductNames: true unless asking for generic advice only
- isInScope: true for greetings, skincare/Skintific topics, or general chat; false ONLY for clearly unrelated topics (tech companies, non-skincare subjects)
- needsTicket: true for payment issues, billing, refunds, account problems, or explicit support requests

CRITICAL RULES:
- "skincare", "product", "something" are NOT specific types → requestedType must be null
- If user says "skincare for acne" → isProductIntent=true, hasNeeds=false, needsClarifier=true, requestedType=null
- Only set hasNeeds=true when you detect BOTH explicit type AND concern
- Be strict about type detection - must be exact category names
- Do not recommend products that are not in the database

EXPLICIT SHOW REQUESTS:
- explicitShowRequest: true if user explicitly wants to see products without clarification (e.g., "show me anything", "just want to see products", "one for each category")
- showRequestType: detect what they want to see ("all", "one_each_category", "random", "popular", etc.)
- If explicitShowRequest=true, override needsClarifier to false`;

    const bodyLLM = {
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: sys },
        ...history.slice(-8),
        { role: 'user', content: message }
      ],
      temperature: 0,
      response_format: { type: 'json_object' }
    };

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(bodyLLM)
    });

    if (!res.ok) throw new Error('LLM validation failed');
    
    const data = await res.json();
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
    
    return {
      isProductIntent: Boolean(parsed.isProductIntent),
      hasNeeds: Boolean(parsed.hasNeeds),
      needsClarifier: Boolean(parsed.needsClarifier && !parsed.explicitShowRequest),
      requestedType: typeof parsed.requestedType === 'string' ? parsed.requestedType : undefined,
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
      allowsProductNames: Boolean(parsed.allowsProductNames !== false),
      isInScope: Boolean(parsed.isInScope !== false),
      needsTicket: Boolean(parsed.needsTicket),
      explicitShowRequest: Boolean(parsed.explicitShowRequest),
      showRequestType: typeof parsed.showRequestType === 'string' ? parsed.showRequestType : undefined,
    };
  } catch {
    return {
      isProductIntent: true,
      hasNeeds: true,
      needsClarifier: false,
      allowsProductNames: true,
      isInScope: true,
      needsTicket: false,
    };
  }
}

// add ctx so we can read session/user for loadHistory
async function searchProducts(
  query: string,
  requestedType?: string,
  limit: number = 6,
  ctx?: { sessionId?: string; userId?: string | null }
) {
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 2a) pull history → synthesize memory (no extra tables)
    let mem: Memory = {};
    if (ctx?.sessionId) {
      const history = await loadHistory(ctx.sessionId);
      mem = await synthesizeMemoryFromHistory(history);
    }

    // 2b) DB fetch (wider, then score/filter locally)
    let qb = supabase.from('products').select('id, content, metadata').order('created_at', { ascending: false });

    // Prefer explicit type, else memory’s first preferred type
    const effectiveType = requestedType || mem.preferred_types?.[0];
    if (effectiveType) qb = qb.ilike('metadata->>type', `%${effectiveType}%`);

    const { data: rows } = await qb.limit(limit * 4); // fetch extra for post-filtering
    let products = (rows || []).map((row: any) => {
      const md = row.metadata || {};
      const price = typeof md.price === 'number' ? md.price : (typeof md.price_min === 'number' ? md.price_min : 0);
      const img = md.image_url || (Array.isArray(md.images) && md.images[0]?.src) || null;
      return {
        id: row.id,
        variant_id: md.variant_id || row.variant_id || row.id,
        name: md.title || row.content || 'Product',
        price_cents: Math.round(Number(price) * 100),
        image_url: img || undefined,
        description: typeof md.description === 'string' && md.description ? md.description
                    : (typeof row.content === 'string' ? String(row.content).slice(0, 200) : undefined),
        tags: Array.isArray(md.tags) ? md.tags.filter((t: any) => typeof t === 'string') : [],
        images: Array.isArray(md.images) ? md.images.map((im: any) => im?.src || im).filter(Boolean).slice(0, 5) : undefined,
        benefits: Array.isArray(md.benefits) ? md.benefits : undefined,
        ingredients: Array.isArray(md.ingredients) ? md.ingredients : undefined,
        type: typeof md.type === 'string' ? md.type : undefined
      };
    });

    // 2c) hard excludes from memory (ingredients)
    if (mem.avoid_ingredients?.length) {
      const avoid = new Set(mem.avoid_ingredients.map(s => s.toLowerCase()));
      products = products.filter(p =>
        !(p.ingredients || []).some((ing: string) => avoid.has(String(ing).toLowerCase()))
      );
    }

    // 2d) simple scoring using memory signals
    const concernsL = new Set((mem.concerns || []).map(s => s.toLowerCase()));
    const prefIng = new Set((mem.preferred_ingredients || []).map(s => s.toLowerCase()));
    const budgetMax = mem.budget_max_cents ?? null;

    const score = (p: any) => {
      let s = 0;
      if (effectiveType && String(p.type || '').toLowerCase().includes(String(effectiveType).toLowerCase())) s += 3;

      const tagSet = new Set((p.tags || []).map((t: string) => t.toLowerCase()));
      const benSet = new Set((p.benefits || []).map((b: string) => b.toLowerCase()));
      for (const c of concernsL) if (tagSet.has(c) || benSet.has(c)) s += 1;

      const ingSet = new Set((p.ingredients || []).map((i: string) => i.toLowerCase()));
      for (const pi of prefIng) if (ingSet.has(pi)) s += 0.5;

      if (budgetMax != null) s += (p.price_cents <= budgetMax) ? 1.5 : -2;

      s += Math.random() * 0.1; // tiny jitter
      return s;
    };

    products.sort((a, b) => score(b) - score(a));
    return products.slice(0, limit);
  } catch {
    return [];
  }
}

serve(async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers, status: 204 });
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

    if (intent === "get_cart_info") {
      try {
        let cartId: string | null = null;
        const { data: ensured, error: ensureErr } = await supabaseSrv.rpc('ensure_cart', { 
          p_currency: 'IDR', 
          p_session_id: sessionId, 
          p_user_id: null 
        });
        cartId = ensured?.id || null;
        if (!cartId && (ensureErr as any)?.code === '23505') {
          const { data: existing } = await supabaseSrv
            .from('carts').select('id').eq('status','active')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          cartId = existing?.id || null;
        }
        
        if (cartId) {
          const cart = await fetchCartItems(cartId);
          const output = cart.items.length === 0 
            ? "Your cart is empty."
            : `Your cart has ${cart.items.length} item${cart.items.length > 1 ? 's' : ''}.`;
          
          await logEvent(supabaseSrv, sessionId, body.user_id, 'user', message || 'show cart');
          await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', output);
          
          return new Response(
            JSON.stringify({ output, cart, returnCart: true }),
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

    if (intent === "add_line" || intent === "edit_line" || intent === "delete_line") {
      try {
        let cartId: string | null = null;
        const { data: ensured, error: ensureErr } = await supabaseSrv.rpc('ensure_cart', { 
          p_currency: 'IDR', 
          p_session_id: sessionId, 
          p_user_id: null 
        });
        cartId = ensured?.id || null;
        if (!cartId && (ensureErr as any)?.code === '23505') {
          const { data: existing } = await supabaseSrv
            .from('carts').select('id').eq('status','active')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          cartId = existing?.id || null;
        }
        
        if (!cartId) {
          return new Response(JSON.stringify({ error: "Cart unavailable" }), { status: 500, headers });
        }

        const requestedProductId = body.product_id;
        const requestedVariantId = body.variant_id;
        const requestedProductName = body.product_name || hintedProduct;
        const requestedQty = body.qty || hintedQty || 1;
        const requestedPrice = body.unit_price_cents;
        const requestedImage = body.image_url;
        
        if (intent === 'delete_line') {
          const { data: lines } = await supabaseSrv
            .from('cart_products')
            .select('id')
            .eq('cart_id', cartId)
            .or(`variant_id.eq.${requestedVariantId || 'null'},product_id.eq.${requestedProductId || 'null'},title_snapshot.eq.${requestedProductName || 'null'}`)
            .limit(1);
          
          if (lines && lines.length > 0) {
            await supabaseSrv.from('cart_products').delete().eq('id', lines[0].id);
          }
        } else {
          const { data: existing } = await supabaseSrv
            .from('cart_products')
            .select('id, qty')
            .eq('cart_id', cartId)
            .or(`variant_id.eq.${requestedVariantId || 'null'},product_id.eq.${requestedProductId || 'null'},title_snapshot.eq.${requestedProductName || 'null'}`)
            .limit(1);
          
          const existingLine = existing && existing.length > 0 ? existing[0] : null;
          
          if (existingLine) {
            const newQty = intent === 'add_line' 
              ? (existingLine.qty || 0) + (requestedQty || 1)
              : (requestedQty || 1);
              
            await supabaseSrv.from('cart_products').update({
              qty: Math.max(1, newQty),
              unit_price: (requestedPrice || 0) / 100,
              title_snapshot: requestedProductName || 'Unknown Product',
              image_url: requestedImage || null,
            }).eq('id', existingLine.id);
          } else {
            await supabaseSrv.from('cart_products').insert({
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
        
        const updatedCart = await fetchCartItems(cartId);
        const output = intent === "delete_line" 
          ? `Removed ${requestedProductName}.`
          : intent === "edit_line"
          ? `Updated ${requestedProductName} quantity to ${requestedQty}.`
          : `Added ${requestedProductName} to cart.`;
          
        await logEvent(supabaseSrv, sessionId, body.user_id, 'user', message || intent);
        await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', output);
        
        return new Response(
          JSON.stringify({ output, cart: updatedCart, returnCart: true }),
          { headers }
        );
      } catch (error) {
        console.error('Cart operation error:', error);
        return new Response(JSON.stringify({ error: "Cart unavailable" }), { status: 500, headers });
      }
    }

    if (intent === "delete_cart") {
      try {
        const { data: bySession } = await supabaseSrv
          .from('carts')
          .select('id')
          .eq('status', 'active')
          .eq('session_id', sessionId);
          
        const cartIds = (bySession || []).map(r => r.id).filter(Boolean);
        
        if (cartIds.length) {
          await supabaseSrv.from('cart_products').delete().in('cart_id', cartIds as any);
        }
        
        const output = "Cart cleared.";
        await logEvent(supabaseSrv, sessionId, body.user_id, 'user', message || 'clear cart');
        await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', output);
        
        return new Response(JSON.stringify({
          output,
          cart: { items: [], subtotal_cents: 0, discount_cents: 0, total_cents: 0, voucher_code: null },
          returnCart: true
        }), { headers });
      } catch (error) {
        console.error('delete_cart error:', error);
        return new Response(JSON.stringify({ 
          output: "Cart cleared.", 
          cart: { items: [], subtotal_cents: 0, discount_cents: 0, total_cents: 0, voucher_code: null } 
        }), { headers });
      }
    }

    if (intent === "general") {
      await logEvent(supabaseSrv, sessionId, body.user_id, 'user', message);
      
      // Load conversation history
      const history = await loadHistory(sessionId);
      
      // Single LLM call to validate everything
      const validation = await validateProductRequest(message, history);
      
      // Handle ticket requests
      if (validation.needsTicket) {
        const webhookUrl = Deno.env.get('TICKET_WEBHOOK_URL') || 'https://primary-production-b68a.up.railway.app/webhook/ticket_create';
        const payload = [{
          user_email: body.user_email || 'anonymous@example.com',
          message,
          category: 'general',
          session_id: sessionId,
          user_Id: body.user_id || 'anonymous',
          subject: (message || 'Customer support request').slice(0, 80)
        }];
        
        try {
          const r = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!r.ok) {
            console.error('Ticket webhook failed', r.status, await r.text().catch(() => ''));
          }
        } catch (e) {
          console.error('Ticket webhook error', e);
        }
        
        const output = `I've created a support ticket so a human can assist you shortly. Subject: ${(message || 'Customer support request').slice(0, 80)}.`;
        await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', output);
        return new Response(JSON.stringify({ output, ticket_created: true }), { headers });
      }
      
      // Handle out-of-scope questions
      if (!validation.isInScope) {
        const output = 'I can help with Skintific products and our shop (cart, vouchers, orders). I don\'t have information about other topics.';
        await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', output);
        return new Response(JSON.stringify({ output }), { headers });
      }
      
      // Handle product requests
      if (validation.isProductIntent) {
        // Handle explicit show requests first
        if (validation.explicitShowRequest) {
          let products: any[] = [];
          
          if (validation.showRequestType === 'one_each_category') {
            // Show one product from each category
            const categories = ['serum', 'moisturizer', 'cleanser', 'sunscreen', 'toner', 'mask'];
            for (const cat of categories) {
            const catProducts = await searchProducts('', cat, 1, { sessionId, userId: body.user_id });
              products.push(...catProducts);
            }
          } else {
            // Default: show recent/popular products
            products = await searchProducts(message, validation.requestedType, 6, { sessionId, userId: body.user_id });
          }
          
          if (products.length > 0) {
            const reply = 'Here are the recommended products below.';
            await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', reply);
            return new Response(JSON.stringify({ output: reply, products }), { headers });
          }
        }
        
        if (validation.needsClarifier) {
          // Generate dynamic clarifier question
          let ask = 'To recommend the best fit, could you share the product type and your skin concerns?';
          if (OPENAI_API_KEY) {
            try {
              const missing: string[] = [];
              if (!validation.requestedType) missing.push('product type (serum, moisturizer, cleanser, etc.)');
              if (!validation.concerns?.length) missing.push('skin concerns (oily, acne, brightening, etc.)');
              
              const clarifierSys = `Generate a short, friendly clarifying question for a skincare assistant. Ask ONLY for the missing details: ${missing.join(' and ')}. Be conversational and avoid templates. One sentence only.`;
              const clarifierBody = {
                model: CHAT_MODEL,
                messages: [
                  { role: 'system', content: clarifierSys },
                  ...history,
                  { role: 'user', content: message }
                ],
                temperature: 0.3,
                max_tokens: 60
              };
              
              const clarifierRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
                body: JSON.stringify(clarifierBody)
              });
              
              if (clarifierRes.ok) {
                const clarifierData = await clarifierRes.json();
                const dynamicAsk = clarifierData?.choices?.[0]?.message?.content?.trim();
                if (dynamicAsk && dynamicAsk.length > 0) {
                  ask = dynamicAsk;
                }
              }
            } catch {}
          }
          
          await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', ask);
          return new Response(JSON.stringify({ output: ask }), { headers });
        }
        
        if (validation.hasNeeds && validation.allowsProductNames) {
          const products = await searchProducts(message, validation.requestedType, 6);
          if (products.length > 0) {
            const reply = 'Here are the recommended products below.';
            await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', reply);
            return new Response(JSON.stringify({ output: reply, products }), { headers });
          }
        }
      }
      
      // Generate contextual response
      let draft = "How can I help you with skincare products today?";
      if (OPENAI_API_KEY) {
        try {
          const system = { role: 'system', content: 'You are a helpful skincare shopping assistant for Skintific. Keep replies concise (1-2 sentences). Never mention external brands.' };
          const bodyLLM = { 
            model: CHAT_MODEL, 
            messages: [system, ...history.slice(-6), { role: 'user', content: message }], 
            temperature: 0.7, 
            max_tokens: 180 
          };
          const res = await fetch('https://api.openai.com/v1/chat/completions', { 
            method: 'POST', 
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, 
            body: JSON.stringify(bodyLLM) 
          });
          if (res.ok) { 
            const j = await res.json(); 
            draft = j.choices?.[0]?.message?.content || draft; 
          }
        } catch {}
      }
      
      await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', draft);
      return new Response(JSON.stringify({ output: draft }), { headers });
    }

    if (intent === "get_upsell") {
      try {
        let cartId: string | null = null;
        const { data: ensured, error: ensureErr } = await supabaseSrv.rpc('ensure_cart', {
          p_currency: 'IDR',
          p_session_id: sessionId,
          p_user_id: null,
        });
        cartId = ensured?.id || null;
        if (!cartId && (ensureErr as any)?.code === '23505') {
          const { data: existing } = await supabaseSrv
            .from('carts').select('id').eq('status','active')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          cartId = existing?.id || null;
        }
        
        if (cartId) {
          const cart = await fetchCartItems(cartId);
          if (!Array.isArray(cart.items) || cart.items.length === 0) {
            return new Response(JSON.stringify({ output: '', bundles: [] }), { headers });
          }
          
          // Generate bundle: cart item + 2 random products from different categories
          const cartItem = cart.items[0];
          
          // Get random products from different categories
          const { data: allProducts } = await supabaseSrv
            .from('products')
            .select('id, content, metadata')
            .order('created_at', { ascending: false })
            .limit(50);
            
          const available = (allProducts || []).map((row: any) => {
            const md = row.metadata || {};
            const price = typeof md.price === 'number' ? md.price : (typeof md.price_min === 'number' ? md.price_min : 0);
            const img = md.image_url || (Array.isArray(md.images) && md.images[0]?.src) || null;
            return {
              id: row.id,
              name: md.title || row.content || 'Product',
              price_cents: Math.round(Number(price) * 100),
              image_url: img || undefined,
              type: typeof md.type === 'string' ? md.type.toLowerCase() : 'unknown'
            };
          });
          
          // Filter out cart items and group by category
          const cartIds = new Set(cart.items.map(item => item.product_id).filter(Boolean));
          const byCategory = new Map<string, any[]>();
          
          for (const p of available) {
            if (cartIds.has(p.id)) continue;
            const cat = p.type || 'unknown';
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat)!.push(p);
          }
          
          // Pick 2 random products from different categories
          const categories = Array.from(byCategory.keys()).filter(c => c !== 'unknown');
          const shuffledCats = categories.sort(() => Math.random() - 0.5);
          const complementary: any[] = [];
          
          for (const cat of shuffledCats) {
            if (complementary.length >= 2) break;
            const products = byCategory.get(cat) || [];
            if (products.length > 0) {
              const random = products[Math.floor(Math.random() * products.length)];
              complementary.push(random);
            }
          }
          
          // Bundle: cart item + complementary products
          const bundleItems = [
            {
              id: cartItem.product_id,
              name: cartItem.product_name,
              price_cents: cartItem.unit_price_cents,
              image_url: cartItem.image_url
            },
            ...complementary
          ].slice(0, 3);
          
          const originalPrice = bundleItems.reduce((sum, item) => sum + (item.price_cents || 0), 0);
          const bundlePrice = Math.round(originalPrice * 0.9);
          
          const bundles = [{
            id: `bundle-${Date.now()}`,
            title: 'Smart Routine Bundle',
            description: 'Complete routine with different product types at 10% off.',
            items: bundleItems,
            price_cents: bundlePrice,
            original_price_cents: originalPrice,
            discount_percent: 10
          }];
          
          return new Response(JSON.stringify({ output: '', bundles }), { headers });
        }
      } catch (e) {
        console.error('get_upsell error:', e);
      }
      return new Response(JSON.stringify({ bundles: [] }), { headers });
    }

    if (intent === "add_bundle") {
      try {
        let cartId: string | null = null;
        const { data: ensured, error: ensureErr } = await supabaseSrv.rpc('ensure_cart', { 
          p_currency: 'IDR', 
          p_session_id: sessionId, 
          p_user_id: null 
        });
        cartId = ensured?.id || null;
        if (!cartId && (ensureErr as any)?.code === '23505') {
          const { data: existing } = await supabaseSrv
            .from('carts').select('id').eq('status','active')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          cartId = existing?.id || null;
        }
        
        if (!cartId) {
          return new Response(JSON.stringify({ error: 'Cart unavailable' }), { status: 500, headers });
        }

        const items = Array.isArray((body as any)?.items) ? (body as any).items : [];
        const discountPercent = Number((body as any)?.discount_percent || 10);
        
        // Load existing cart lines once to decide update vs insert
        const { data: existingLines } = await supabaseSrv
          .from('cart_products')
          .select('id, product_id, variant_id, qty, title_snapshot, unit_price, image_url')
          .eq('cart_id', cartId);
        const lines = Array.isArray(existingLines) ? existingLines : [];

        const findExisting = (it: any) => {
          const idKey = String(it.id || '').toLowerCase();
          const varKey = String(it.variant_id || '').toLowerCase();
          const title = String(it.name || '').toLowerCase();
          return lines.find((l: any) =>
            (String(l.product_id || '').toLowerCase() === idKey) ||
            (String(l.variant_id || '').toLowerCase() === varKey) ||
            (String(l.title_snapshot || '').toLowerCase() === title)
          );
        };

        for (const item of items) {
          const name = String(item.name || 'Bundle Item');
          const priceCents = Number(item.price_cents || 0);
          const discounted = Math.max(0, Math.round(priceCents * (100 - discountPercent) / 100));

          const existing = findExisting(item);
          if (existing) {
            const newTitle = (String(existing.title_snapshot || '') || name).includes('(Bundle Discount)')
              ? existing.title_snapshot
              : `${existing.title_snapshot || name} (Bundle Discount)`;
            await supabaseSrv
              .from('cart_products')
              .update({
                // Keep quantity unchanged; only price/label/image
                unit_price: discounted / 100,
                title_snapshot: newTitle,
                image_url: item.image_url || existing.image_url || null,
              })
              .eq('id', existing.id);
          } else {
            await supabaseSrv.from('cart_products').insert({
              cart_id: cartId,
              product_id: item.id || name,
              variant_id: item.variant_id || item.id || name,
              qty: 1,
              unit_price: discounted / 100,
              title_snapshot: `${name} (Bundle Discount)`,
              image_url: item.image_url,
            });
          }
        }
        
        const updatedCart = await fetchCartItems(cartId);
        await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', 'Bundle added to cart.');
        return new Response(JSON.stringify({ 
          output: 'Bundle added to cart.', 
          cart: updatedCart, 
          returnCart: true 
        }), { headers });
      } catch (e) {
        console.error('add_bundle error:', e);
        return new Response(JSON.stringify({ error: 'Unable to add bundle' }), { status: 500, headers });
      }
    }

    return new Response(
      JSON.stringify({ error: "Intent not supported" }),
      { status: 400, headers }
    );
  } catch (err) {
    console.error('Server error:', err);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers }
    );
  }
});