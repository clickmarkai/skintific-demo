import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.2';

const VITE_OPENAI_API_KEY = Deno.env.get('VITE_OPENAI_API_KEY');
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

const currency = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const detectIntent = (message: string): string => {
  const lower = message.toLowerCase();
  if (/\b(add|want|need|buy|get me|purchase)\b/.test(lower) && !/\b(remove|delete|cancel)\b/.test(lower)) return "add_line";
  if (/\b(change|update|modify|set|edit)\s+(qty|quantity)\b/.test(lower)) return "edit_line";
  if (/\b(remove|delete|cancel|take out)\b/.test(lower)) return "delete_line";
  if (/\b(clear|empty|reset)\s+(cart|bag)\b/.test(lower)) return "delete_cart";
  if (/\b(cart|bag|total|summary|order)\b/.test(lower) && /\b(show|view|check|what|see|look)\b/.test(lower)) return "get_cart_info";
  if (/\b(voucher|coupon|discount|promo|code|apply)\b/.test(lower)) return "apply_voucher";
  if (/\b(checkout|pay|purchase|buy now|complete order)\b/.test(lower)) return "checkout";
  if (/\b(help|support|issue|problem|complaint|refund|return)\b/.test(lower)) return "ticket";
  if (/\b(hi|hello|hey|recommend|suggest|product|moisturi|serum|cleanser|sunscreen|toner|skincare)\b/.test(lower)) return "general";
  return "general";
};

const fetchCartItems = async (cartId: string, currency: string = 'IDR'): Promise<Cart> => {
  try {
    const supabase = createClient(
      Deno.env.get('VITE_SUPABASE_URL')!,
      Deno.env.get('VITE_SUPABASE_SERVICE_ROLE_KEY')!
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
    // Persist to n8n chat history table
    try {
      await supabase.from('n8n_chat_histories').insert({ session_id: sessionId, message: { role, content } });
    } catch {}
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
      Deno.env.get('VITE_SUPABASE_URL')!,
      Deno.env.get('VITE_SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Escalate using LLM classification only (no regex gates)
    async function classifyNeedsHumanLLM(msg: string): Promise<boolean> {
      if (!VITE_OPENAI_API_KEY) return false;
      try {
        const sys = "Decide if this user request should be escalated to a human agent. Reply with pure JSON: { escalate: boolean }. Escalate if it concerns payment problems, billing, refunds, duplicate charges, missing confirmations/emails, account security, or anything requiring manual intervention beyond product recommendations, vouchers, cart or pricing.";
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VITE_OPENAI_API_KEY}` },
          body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: msg }], temperature: 0, response_format: { type: 'json_object' } })
        });
        const data = await res.json();
        const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
        return Boolean(parsed.escalate);
      } catch (_) { return false; }
    }
    // Escalate to ticket unless cart/voucher based solely on LLM
    const needsHuman = await classifyNeedsHumanLLM(message);
    if (needsHuman && intent !== 'apply_voucher' && intent !== 'get_cart_info') {
      intent = 'ticket';
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

    if (intent === "delete_cart") {
      try {
        const { data: cartData } = await supabaseSrv
          .from('carts')
          .select('id')
          .or(`session_id.eq.${sessionId},user_id.eq.${body.user_id || 'null'}`)
          .eq('status', 'active')
          .single();
        
        if (cartData?.id) {
          await supabaseSrv
            .from('cart_products')
            .delete()
            .eq('cart_id', cartData.id);
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
        
        return new Response(
          JSON.stringify({ output, cart: updatedCart, returnCart: true }),
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
          const codeMatch = (message).match(/[A-Z0-9]{4,}/i);
          const code = codeMatch ? codeMatch[0].toUpperCase() : null;
          
          const output = code 
            ? `Applied voucher ${code}.`
            : "No voucher code provided.";
            
          await logEvent(supabaseSrv, sessionId, body.user_id, 'user', message || 'apply voucher');
          await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', output);
          
          return new Response(
            JSON.stringify({ output, cart, returnCart: true }),
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
      // Let the LLM answer with history
      const history = await (async () => {
        try {
          const { data } = await (createClient(Deno.env.get('VITE_SUPABASE_URL')!, Deno.env.get('VITE_SUPABASE_SERVICE_ROLE_KEY')!))
            .from('events').select('payload').eq('session_id', sessionId).eq('type', 'message').order('created_at', { ascending: false }).limit(16);
          return (data || []).map((r: any) => ({ role: r.payload?.role || 'user', content: r.payload?.content || '' })).reverse();
        } catch { return []; }
      })();
      let draft = "How can I help you with skincare products today?";
      try { draft = await (async () => {
        if (!VITE_OPENAI_API_KEY) return draft;
        const system = { role: 'system', content: 'You are a helpful skincare shopping assistant. Keep replies concise (1-2 sentences).' } as any;
        const bodyLLM: any = { model: CHAT_MODEL, messages: [system, ...history.slice(-10), { role: 'user', content: message }], temperature: 0.7, max_tokens: 180 };
        const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${VITE_OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(bodyLLM) });
        if (!res.ok) return draft;
        const j = await res.json();
        return j.choices?.[0]?.message?.content || draft;
      })(); } catch {}
      // Escalate based on the LLM draft only (no keywords)
      try {
        if (VITE_OPENAI_API_KEY) {
          const sys = "Return JSON {\\"escalate\\": boolean}. Set escalate=true if the assistant draft does not fully answer/resolve the user's last message OR if the user explicitly requests a ticket, a human agent, or customer support contact. Otherwise escalate=false.";
          const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VITE_OPENAI_API_KEY}` }, body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: `User: ${message}\nAssistantDraft: ${draft}` }], temperature: 0, response_format: { type: 'json_object' } }) });
          const data = await res.json().catch(() => ({}));
          const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
          if (parsed?.escalate === true) {
            const payload = [{ user_email: body.user_email || 'anonymous@example.com', message, category: 'general', session_id: sessionId, user_Id: body.user_id || 'anonymous', subject: (message || 'Customer support request').slice(0, 80) }];
            try { const r = await fetch(Deno.env.get('TICKET_WEBHOOK_URL') || 'https://primary-production-b68a.up.railway.app/webhook/ticket_create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (!r.ok) { try { console.error('Ticket webhook failed', r.status, await r.text()); } catch {} } } catch (e) { console.error('Ticket webhook error', e); }
            const reply = `I’ve created a support ticket so a human can assist you shortly. Subject: ${(message || 'Customer support request').slice(0, 80)}.`;
            await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', reply);
            return new Response(JSON.stringify({ output: reply, ticket_created: true }), { headers });
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
      if (VITE_OPENAI_API_KEY) {
        try {
          const sys = `Extract concise subject and category for a customer support ticket from the user's last message. Return JSON {subject:string, category:string}. Categories: product_info, order, payment, shipping, return_refund, account, other.`;
          const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VITE_OPENAI_API_KEY}` }, body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: message }], temperature: 0, response_format: { type: 'json_object' } }) });
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
      const output = `I’ve created a support ticket so a human can assist you shortly. Subject: ${subject}.`;
      await logEvent(supabaseSrv, sessionId, body.user_id, 'user', message);
      await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', output);
      return new Response(JSON.stringify({ output, ticket_created: true }), { headers });
    }

    // Fallback with LLM-based draft and escalation
    let fallbackDraft = "How can I help you with skincare products today?";
    try {
      if (VITE_OPENAI_API_KEY) {
        const history = await (async () => {
          try {
            const { data } = await (createClient(Deno.env.get('VITE_SUPABASE_URL')!, Deno.env.get('VITE_SUPABASE_SERVICE_ROLE_KEY')!))
              .from('events').select('payload').eq('session_id', sessionId).eq('type', 'message').order('created_at', { ascending: false }).limit(16);
            return (data || []).map((r: any) => ({ role: r.payload?.role || 'user', content: r.payload?.content || '' })).reverse();
          } catch { return []; }
        })();
        const system = { role: 'system', content: 'You are a helpful skincare shopping assistant. Keep replies concise (1-2 sentences).' } as any;
        const bodyLLM: any = { model: CHAT_MODEL, messages: [system, ...history.slice(-10), { role: 'user', content: message }], temperature: 0.7, max_tokens: 180 };
        const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${VITE_OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(bodyLLM) });
        if (res.ok) { const j = await res.json(); fallbackDraft = j.choices?.[0]?.message?.content || fallbackDraft; }
        const sys = "Return JSON {\\"escalate\\": boolean}. Set escalate=true if the assistant draft does not fully answer/resolve the user's last message OR if the user explicitly requests a ticket, a human agent, or customer support contact. Otherwise escalate=false.";
        const res2 = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VITE_OPENAI_API_KEY}` }, body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: `User: ${message}\nAssistantDraft: ${fallbackDraft}` }], temperature: 0, response_format: { type: 'json_object' } }) });
        const data2 = await res2.json().catch(() => ({}));
        const parsed2 = JSON.parse(data2?.choices?.[0]?.message?.content || '{}');
        if (parsed2?.escalate === true) {
          const payload = [{ user_email: body.user_email || 'anonymous@example.com', message, category: 'general', session_id: sessionId, user_Id: body.user_id || 'anonymous', subject: (message || 'Customer support request').slice(0, 80) }];
          try { const r = await fetch(Deno.env.get('TICKET_WEBHOOK_URL') || 'https://primary-production-b68a.up.railway.app/webhook/ticket_create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (!r.ok) { try { console.error('Ticket webhook failed', r.status, await r.text()); } catch {} } } catch (e) { console.error('Ticket webhook error', e); }
          const reply = `I’ve created a support ticket so a human can assist you shortly. Subject: ${(message || 'Customer support request').slice(0, 80)}.`;
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
