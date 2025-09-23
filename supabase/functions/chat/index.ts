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
    const intent = hintedIntent || detectIntent(message);

    const supabaseSrv = createClient(
      Deno.env.get('VITE_SUPABASE_URL')!,
      Deno.env.get('VITE_SUPABASE_SERVICE_ROLE_KEY')!
    );

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
      const output = "I can help you browse skincare products, manage your cart, or answer questions. What would you like to do?";
      await logEvent(supabaseSrv, sessionId, body.user_id, 'user', message);
      await logEvent(supabaseSrv, sessionId, body.user_id, 'assistant', output);
      
      return new Response(
        JSON.stringify({ output }),
        { headers }
      );
    }

    // Fallback
    return new Response(
      JSON.stringify({ output: "How can I help you with skincare products today?" }),
      { headers }
    );
  } catch (err) {
    console.error('Server error:', err);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers }
    );
  }
});
