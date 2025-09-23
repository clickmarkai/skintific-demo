import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageCircle, Send, X, Minimize2, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import TypingIndicator from "@/components/TypingIndicator";
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
// Using custom free-scroll container for product carousel

interface Message {
  id: number;
  text: string;
  isUser: boolean;
  timestamp: Date;
  // Optional rich content kinds returned by our backend
  kind?: "text" | "products" | "cart" | "ticket" | "vouchers";
  products?: Array<{
    id?: string;
    variant_id?: string;
    name: string;
    price_cents?: number;
    price?: number;
    image_url?: string;
    images?: string[];
    benefits?: string[];
    ingredients?: string[];
    tags?: string[];
    description?: string;
  }>;
  cart?: {
    items: Array<{
      product_name: string;
      qty: number;
      unit_price_cents?: number;
      image_url?: string;
      product_id?: string;
      variant_id?: string;
    }>;
    subtotal_cents: number;
    discount_cents: number;
    total_cents: number;
    voucher_code?: string | null;
  };
  vouchers?: Array<{
    code: string;
    description?: string;
    discount_type?: string;
    discount_value?: number;
    min_spend?: number;
    estimated_savings_cents?: number;
  }>;
  ticketId?: string;
}

type AnimPhase = "in" | "out" | null;

const ChatWidget = () => {
  const [isOpen, setIsOpen] = useState(() => {
    try { return localStorage.getItem('chat_open') === '1'; } catch { return false; }
  });
  const [sessionId] = useState(() => {
    try {
      const existing = localStorage.getItem('chat_session_id');
      if (existing) return existing;
      const fresh = crypto.randomUUID();
      localStorage.setItem('chat_session_id', fresh);
      return fresh;
    } catch {
      return crypto.randomUUID();
    }
  });
  const [isMinimized, setIsMinimized] = useState(() => {
    try { return localStorage.getItem('chat_min') === '1'; } catch { return false; }
  });
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      text: "Hello! How can I help you today?",
      isUser: false,
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const productScrollRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const scrollProducts = (id: number, direction: "left" | "right") => {
    const container = productScrollRefs.current[id];
    if (!container) return;
    const delta = Math.max(240, Math.floor(container.clientWidth * 0.9));
    container.scrollBy({ left: direction === "left" ? -delta : delta, behavior: "smooth" });
  };

  // NEW: animation mount + phase
  const [mounted, setMounted] = useState(false);
  const [anim, setAnim] = useState<AnimPhase>(null);
  const ANIM_MS = 220; // keep snappy
  const [historyLoaded, setHistoryLoaded] = useState(false);
  useEffect(() => { try { localStorage.setItem('chat_open', isOpen ? '1' : '0'); } catch {} }, [isOpen]);
  useEffect(() => { try { localStorage.setItem('chat_min', isMinimized ? '1' : '0'); } catch {} }, [isMinimized]);

  // Backend URL: use our Netlify Function by default; no fallback to Railway
  const SUPABASE_URL_ENV = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
  const SUPABASE_FUNCTION_URL =
    (import.meta as any).env?.VITE_SUPABASE_FUNCTION_URL ||
    (SUPABASE_URL_ENV ? SUPABASE_URL_ENV.replace('.supabase.co', '.functions.supabase.co') + '/chat' : undefined);
  const CART_URL = (import.meta as any).env?.VITE_CART_URL || '/cart';
  if ((import.meta as any).env?.DEV) {
    // Helpful to verify which endpoint the UI uses
    // eslint-disable-next-line no-console
    console.info(
      "[Chat] Using Supabase endpoint:",
      supabase ? "supabase.functions.invoke('chat')" : (SUPABASE_FUNCTION_URL || "(missing)")
    );
  }

  const formatCurrency = (cents?: number) => {
    if (typeof cents !== "number") return "$0.00";
    return `$${(cents / 100).toFixed(2)}`;
  };

  const extractCartCents = (cart: any) => {
    if (!cart) return { subtotal: 0, discount: 0, total: 0 };
    const hasCents = typeof cart.subtotal_cents === 'number' || typeof cart.total_cents === 'number';
    if (hasCents) {
      return {
        subtotal: (cart.subtotal_cents as number) ?? 0,
        discount: (cart.discount_cents as number) ?? 0,
        total: (cart.total_cents as number) ?? 0,
      };
    }
    // 1Cube cart_get returns dollars (subtotal, discount_amount, estimated_total)
    const dollarsSubtotal = typeof cart.subtotal === 'number' ? cart.subtotal : 0;
    const dollarsDiscount = typeof cart.discount_amount === 'number' ? cart.discount_amount : 0;
    const dollarsTotal = typeof cart.estimated_total === 'number' ? cart.estimated_total : 0;
    return {
      subtotal: Math.round(dollarsSubtotal * 100),
      discount: Math.round(dollarsDiscount * 100),
      total: Math.round(dollarsTotal * 100),
    };
  };

  const shortId = (id: string) => id.replace(/-/g, "").toUpperCase().slice(0, 8);

  const getCurrentSessionId = async (): Promise<string> => {
    // Keep the new ephemeral session for this browser load
    return sessionId;
  };

  // Load persisted history from Supabase (n8n_chat_histories)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!supabase) { setHistoryLoaded(true); return; }
        const { data } = await (supabase as any)
          .from('n8n_chat_histories')
          .select('id, message')
          .eq('session_id', sessionId)
          .order('id', { ascending: true })
          .limit(200);
        const initialGreeting = "Hello! How can I help you today?";
        if (!cancelled && Array.isArray(data) && data.length) {
          const restored: Message[] = data.map((row: any, idx: number) => {
            const m = (row.message || {}) as any;
            const role = String(m.role || 'assistant');
            const content = String(m.content || '');
            const kind = m.kind as Message['kind'] | undefined;
            const msg: Message = {
              id: Number(row.id) || Date.now() + idx,
              text: content,
              isUser: role === 'user',
              timestamp: new Date(),
              kind: kind || 'text',
            } as Message;
            if (kind === 'products' && Array.isArray(m.products)) {
              msg.products = m.products;
            }
            if (kind === 'cart' && m.cart) {
              msg.cart = m.cart;
            }
            if (kind === 'vouchers' && Array.isArray(m.vouchers)) {
              msg.vouchers = m.vouchers;
            }
            if (kind === 'ticket' && typeof m.ticket_id === 'string') {
              msg.ticketId = shortId(m.ticket_id);
            }
            return msg;
          });
          const hasGreeting = restored.some((m) => !m.isUser && typeof m.text === 'string' && /hello/i.test(m.text) && /help/i.test(m.text));
          if (!hasGreeting) {
            restored.unshift({ id: Date.now() - 1, text: initialGreeting, isUser: false, timestamp: new Date(), kind: 'text' });
            try { await (supabase as any).from('n8n_chat_histories').insert({ session_id: sessionId, message: { role: 'assistant', content: initialGreeting } }); } catch {}
          }
          setMessages(restored);
        } else if (!cancelled) {
          // No history — persist the greeting so it appears on future refreshes
          try { await (supabase as any).from('n8n_chat_histories').insert({ session_id: sessionId, message: { role: 'assistant', content: initialGreeting } }); } catch {}
        }
      } catch {}
      setHistoryLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  // If history includes a cart snapshot, ensure it renders on mount
  useEffect(() => {
    if (!historyLoaded) return;
    const hasCart = messages.some((m) => m.kind === 'cart');
    if (!hasCart && supabase) {
      (async () => {
        try {
          const { data } = await (supabase as any)
            .from('n8n_chat_histories')
            .select('id, message')
            .eq('session_id', sessionId)
            .order('id', { ascending: false })
            .limit(50);
          const cartMsg = (data || []).map((r: any) => r.message).find((m: any) => m?.kind === 'cart' && m?.cart);
          if (cartMsg) {
            upsertCartMessage({ text: String(cartMsg.content || 'Cart updated.'), cart: cartMsg.cart });
          }
        } catch {}
      })();
    }
  }, [historyLoaded]);

  useEffect(() => {
    if (isOpen) {
      // mount then animate in on next frame (ensures transition runs)
      setMounted(true);
      requestAnimationFrame(() => setAnim("in"));
    } else if (mounted) {
      // animate out then unmount
      setAnim("out");
      const t = setTimeout(() => {
        setMounted(false);
        setAnim(null);
      }, ANIM_MS);
      return () => clearTimeout(t);
    }
  }, [isOpen, mounted]);

  // Auto-scroll to bottom on new message/minimize changes
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, isMinimized]);

  // After the assistant finishes responding (input re-enabled), re-focus the input automatically
  useEffect(() => {
    if (!isLoading && isOpen && !isMinimized) {
      try { inputRef.current?.focus({ preventScroll: true } as any); } catch { inputRef.current?.focus(); }
    }
  }, [isLoading, isOpen, isMinimized]);

  const sendMessage = async () => {
    if (!inputValue.trim()) return;

    const newMessage: Message = {
      id: Date.now(),
      text: inputValue,
      isUser: true,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, newMessage]);
    const messageText = inputValue;
    // Persist user message
    try {
      if (supabase) {
        await (supabase as any).from('n8n_chat_histories').insert({ session_id: sessionId, message: { role: 'user', content: messageText } });
      }
    } catch {}
    setInputValue("");
    setIsLoading(true);

    try {
      // Always use our stable browser conversation id
      const currentSessionId = sessionId;

      let data: any;
      if (supabase) {
        const { data: fnData, error: fnErr } = await (supabase as any).functions.invoke('chat', {
          body: {
            message: messageText,
            timestamp: new Date().toISOString(),
            user_id: user?.id || "anonymous",
            user_email: user?.email || "anonymous@example.com",
            session_id: currentSessionId,
            source: "chat_widget",
          },
        });
        if (fnErr) throw fnErr;
        data = fnData;
      } else {
        if (!SUPABASE_FUNCTION_URL) throw new Error("Supabase Function URL missing");
        const response = await fetch(SUPABASE_FUNCTION_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: messageText,
            timestamp: new Date().toISOString(),
            user_id: user?.id || "anonymous",
            user_email: user?.email || "anonymous@example.com",
            session_id: currentSessionId,
            source: "chat_widget",
          }),
        });
        if (!response.ok) throw new Error("Network response was not ok");
        data = await response.json();
      }

      // Build a rich message if backend provides structured data; remain backward-compatible
      const botResponse: Message = {
        id: Date.now() + 1,
        text: data?.output || "No response from bot.",
        isUser: false,
        timestamp: new Date(),
        kind: "text",
      };

      if (Array.isArray(data?.products)) {
        botResponse.kind = "products";
        botResponse.products = data.products;
        // Add a short heading for clarity while keeping carousel behavior
        botResponse.text = data?.output && data.output.trim()
          ? data.output
          : "Here are the recommended products below.";
      }
      if (Array.isArray(data?.vouchers)) {
        botResponse.kind = "vouchers";
        botResponse.vouchers = data.vouchers;
        // Add a heading for vouchers list
        botResponse.text = data?.output && data.output.trim()
          ? data.output
          : "Below are the currently working vouchers.";
      }
      if (data?.cart) {
        botResponse.kind = "cart";
        botResponse.cart = data.cart;
      }
      if (typeof data?.ticket_id === "string" && data.ticket_id) {
        botResponse.kind = "ticket";
        botResponse.ticketId = shortId(data.ticket_id);
        if (!botResponse.text || botResponse.text === "No response from bot.") {
          botResponse.text = `All set — I’ve opened ticket #${botResponse.ticketId}.`;
        }
      }

      setMessages((prev) => [...prev, botResponse]);
      // Persist assistant message with structured payload so carousels restore after refresh
      try {
        if (supabase) {
          const persisted: any = { role: 'assistant', content: botResponse.text };
          if (botResponse.kind) persisted.kind = botResponse.kind;
          if (Array.isArray(data?.products)) persisted.products = data.products;
          if (Array.isArray(data?.vouchers)) persisted.vouchers = data.vouchers;
          if (data?.cart) persisted.cart = data.cart;
          if (typeof data?.ticket_id === 'string') persisted.ticket_id = data.ticket_id;
          await (supabase as any).from('n8n_chat_histories').insert({ session_id: sessionId, message: persisted });
        }
      } catch {}
      // Persist a minimal plain text copy (optional)
      try {
        if (supabase) {
          await (supabase as any).from('n8n_chat_histories').insert({ session_id: sessionId, message: { role: 'assistant', content: botResponse.text } });
        }
      } catch {}
    } catch (error) {
      console.error("Error sending message:", error);
      // Fallback: only show product suggestions if the user asked for products
      try {
        const wantsProducts = /\b(recommend|product|products|moist|moistur|serum|sunscreen|spf|cleanser|toner|mask|cream|lotion|gel|acne|brighten|hydrating)\b/i.test(messageText);
        if (wantsProducts && supabase) {
          const { data: list } = await supabase
            .from('products')
            .select('id, content, metadata')
            .order('created_at', { ascending: false })
            .limit(6);
          const products = (list || []).map((row: any) => {
            const md = row.metadata || {};
            const name = md.title || row.content || 'Product';
            const price = typeof md.price === 'number' ? md.price : (typeof md.price_min === 'number' ? md.price_min : 0);
            const img = md.image_url || (Array.isArray(md.images) && md.images[0]?.src) || undefined;
            const tags = Array.isArray(md.tags) ? md.tags : undefined;
            return { id: row.id, name, price: Number(price), image_url: img, tags } as any;
          });
          if (products.length) {
            const fallback: Message = {
              id: Date.now() + 1,
              text: 'Here are some popular options to get you started:',
              isUser: false,
              timestamp: new Date(),
              kind: 'products',
              products,
            } as any;
            setMessages((prev) => [...prev, fallback]);
            return;
          }
        }
      } catch {}
      toast({ title: "Message processing", description: "Your message could not be processed. Please try again." });
    } finally {
      setIsLoading(false);
    }
  };

  // Update the most recent cart message in-place (no new chat bubble). If none exists, append one.
  const upsertCartMessage = async (payload: { text?: string; cart?: any }) => {
    setMessages((prev) => {
      const next = [...prev];
      let idx = -1;
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].kind === "cart") { idx = i; break; }
      }
      if (idx >= 0) {
        const updated: Message = {
          ...next[idx],
          text: payload.text || next[idx].text,
          cart: payload.cart ?? next[idx].cart,
          timestamp: new Date(),
        };
        next[idx] = updated;
        return next;
      }
      const newMsg: Message = {
        id: Date.now() + 1,
        text: payload.text || "",
        isUser: false,
        timestamp: new Date(),
        kind: "cart",
        cart: payload.cart as any,
      };
      return [...next, newMsg];
    });
    // Persist cart snapshot outside React state updater (no await inside setState)
    try {
      if (supabase) {
        const snapshot = payload.cart;
        await (supabase as any).from('n8n_chat_histories').insert({ session_id: sessionId, message: { role: 'assistant', content: payload.text || 'Cart updated.', kind: 'cart', cart: snapshot } });
      }
    } catch {}
  };

  const addToCart = async (
    productName: string,
    qty = 1,
    unitPriceCents?: number,
    productId?: string,
    variantId?: string,
    imageUrl?: string
  ) => {
    setIsLoading(true);
    // Optimistic: show an in-place status so the user sees immediate feedback
    upsertCartMessage({ text: `Adding ${productName}…` });
    try {
      const currentSessionId = await getCurrentSessionId();
      let data: any;
      const payload = {
        message: "", // avoid triggering LLM routes
        intent: "add_line",
        product_name: productName,
        qty,
        unit_price_cents: unitPriceCents,
        product_id: productId,
        variant_id: variantId,
        image_url: imageUrl,
        timestamp: new Date().toISOString(),
        user_id: user?.id || "anonymous",
        user_email: user?.email || "anonymous@example.com",
        session_id: currentSessionId,
        source: "chat_widget",
      } as any;

      if (supabase) {
        // Quick client-side fix: ensure cart and write directly to cart_products
        try {
          let cartId: string;
          
          // First, try to find an existing cart for this user or session
          const { data: existingCarts, error: findErr } = await (supabase as any)
            .from('carts')
            .select('id')
            .or(`user_id.eq.${user?.id || 'null'},session_id.eq.${currentSessionId}`)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1);
          
          if (!findErr && existingCarts && existingCarts.length > 0) {
            cartId = existingCarts[0].id;
          } else {
            // If no cart exists, try to create one
            const { data: ensured, error: ensureErr } = await (supabase as any).rpc('ensure_cart', { 
              p_currency: 'IDR', 
              p_session_id: currentSessionId, 
              p_user_id: user?.id || null 
            });
            
            if (ensureErr) {
              // If ensure_cart fails due to constraint, find the existing cart
              if (ensureErr.code === '23505') {
                const { data: userCarts } = await (supabase as any)
                  .from('carts')
                  .select('id')
                  .eq('user_id', user?.id)
                  .eq('status', 'active')
                  .order('created_at', { ascending: false })
                  .limit(1);
                
                if (userCarts && userCarts.length > 0) {
                  cartId = userCarts[0].id;
                } else {
                  throw new Error('Cart conflict but no active cart found');
                }
              } else {
                throw ensureErr;
              }
            } else if (!ensured?.id) {
              throw new Error('ensure_cart failed');
            } else {
              cartId = (ensured as any).id as string;
            }
          }
          const resolvedVariantId = variantId ?? productId ?? productName;
          // Check if line exists
          const { data: existing } = await (supabase as any)
            .from('cart_products')
            .select('id, qty')
            .eq('cart_id', cartId)
            .or(`variant_id.eq.${resolvedVariantId},product_id.eq.${productId},title_snapshot.eq.${productName}`)
            .order('updated_at', { ascending: false })
            .limit(1);
          const row = (existing || [])[0] || null;
          if (row) {
            await (supabase as any)
              .from('cart_products')
              .update({
                qty: Math.max(1, (row.qty || 0) + (qty || 1)),
                title_snapshot: productName,
                unit_price: (unitPriceCents || 0) / 100,
                image_url: imageUrl || null,
                variant_id: resolvedVariantId,
                product_id: productId || productName,
              })
              .eq('id', row.id);
          } else {
            await (supabase as any)
              .from('cart_products')
              .insert({
                cart_id: cartId,
                product_id: productId || productName,
                variant_id: resolvedVariantId,
                qty: Math.max(1, qty || 1),
                unit_price: (unitPriceCents || 0) / 100,
                title_snapshot: productName,
                image_url: imageUrl || null,
              });
          }
          // Read back cart lines and compute totals
          const { data: lines } = await (supabase as any)
            .from('cart_products')
            .select('title_snapshot, qty, unit_price, image_url, product_id, variant_id')
            .eq('cart_id', cartId)
            .order('updated_at', { ascending: false });
          const items = (lines || []).map((l: any) => ({
            product_name: l.title_snapshot || l.product_id,
            qty: l.qty || 0,
            unit_price_cents: Math.round((l.unit_price || 0) * 100),
            image_url: l.image_url || undefined,
            product_id: l.product_id as string | undefined,
            variant_id: l.variant_id as string | undefined,
          }));
          const subtotal = items.reduce((s: number, it: any) => s + (it.unit_price_cents || 0) * (it.qty || 0), 0);
          data = {
            output: `Added ${productName}.`,
            cart: {
              items,
              subtotal_cents: subtotal,
              discount_cents: 0,
              total_cents: subtotal,
              voucher_code: null,
            },
          };
        } catch (clientPathErr) {
          // Fallback to edge function if direct path fails
          const { data: fnData, error: fnErr } = await (supabase as any).functions.invoke('chat', { body: payload });
          if (fnErr) throw fnErr;
          data = fnData;
        }
      } else {
        if (!SUPABASE_FUNCTION_URL) throw new Error("Supabase Function URL missing");
        const response = await fetch(SUPABASE_FUNCTION_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error("Network response was not ok");
        data = await response.json();
      }

      // Fallback: if no cart returned, explicitly fetch the cart snapshot
      if (!data?.cart) {
        const cartPayload: any = {
          message: "",
          intent: "get_cart_info",
          session_id: currentSessionId,
          user_id: user?.id || "anonymous",
          user_email: user?.email || "anonymous@example.com",
          timestamp: new Date().toISOString(),
          source: "chat_widget",
        };
        try {
          if (supabase) {
            const { data: cartData } = await (supabase as any).functions.invoke('chat', { body: cartPayload });
            if (cartData) data = { ...(data || {}), ...cartData };
          } else if (SUPABASE_FUNCTION_URL) {
            const r = await fetch(SUPABASE_FUNCTION_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cartPayload) });
            if (r.ok) data = { ...(data || {}), ...(await r.json()) };
          }
        } catch {}
      }

      if (data?.cart) {
        upsertCartMessage({ text: data?.output || `Added ${productName}.`, cart: data.cart });
      } else {
        const botResponse: Message = {
          id: Date.now() + 1,
          text: data?.output || `Added ${productName}.`,
          isUser: false,
          timestamp: new Date(),
          kind: "text",
        };
        setMessages((prev) => [...prev, botResponse]);
        try { if (supabase) { await (supabase as any).from('n8n_chat_histories').insert({ session_id: currentSessionId, message: { role: 'assistant', content: botResponse.text } }); } } catch {}
      }
    } catch (error) {
      console.error("Error adding to cart:", error);
      toast({ title: "Cart", description: "Could not add item to cart. Try again." });
    } finally {
      setIsLoading(false);
    }
  };

  const clearCart = async () => {
    setIsLoading(true);
    upsertCartMessage({ text: `Clearing cart…` });
    try {
      const currentSessionId = await getCurrentSessionId();
      let data: any;
      const payload: any = {
        message: "",
        intent: "delete_cart",
        session_id: currentSessionId,
        user_id: user?.id || "anonymous",
        user_email: user?.email || "anonymous@example.com",
        timestamp: new Date().toISOString(),
        source: "chat_widget",
      };
      if (supabase) {
        const { data: fnData, error: fnErr } = await (supabase as any).functions.invoke('chat', { body: payload });
        if (fnErr) throw fnErr;
        data = fnData;
      } else {
        if (!SUPABASE_FUNCTION_URL) throw new Error("Supabase Function URL missing");
        const response = await fetch(SUPABASE_FUNCTION_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error("Network response was not ok");
        data = await response.json();
      }
      if (data?.cart) {
        upsertCartMessage({ text: data?.output || `Cart cleared.`, cart: data.cart });
      } else {
        const botResponse: Message = {
          id: Date.now() + 1,
          text: data?.output || `Cart cleared.`,
          isUser: false,
          timestamp: new Date(),
          kind: "text",
        };
        setMessages((prev) => [...prev, botResponse]);
      }
    } catch (error) {
      console.error("Error clearing cart:", error);
      toast({ title: "Cart", description: "Could not clear cart. Try again." });
    } finally {
      setIsLoading(false);
    }
  };

  const applyVoucher = async (code: string) => {
    setIsLoading(true);
    upsertCartMessage({ text: `Applying ${code}…` });
    try {
      const currentSessionId = await getCurrentSessionId();
      const payload: any = {
        message: `apply voucher ${code}`,
        intent: "apply_voucher",
        voucher_name: code,
        session_id: currentSessionId,
        user_id: user?.id || "anonymous",
        user_email: user?.email || "anonymous@example.com",
        timestamp: new Date().toISOString(),
        source: "chat_widget",
      };
      let data: any;
      if (supabase) {
        const { data: fnData, error: fnErr } = await (supabase as any).functions.invoke('chat', { body: payload });
        if (fnErr) throw fnErr;
        data = fnData;
      } else {
        if (!SUPABASE_FUNCTION_URL) throw new Error("Supabase Function URL missing");
        const response = await fetch(SUPABASE_FUNCTION_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error("Network response was not ok");
        data = await response.json();
      }

      if (data?.cart) {
        upsertCartMessage({ text: data?.output || `Applied ${code}.`, cart: data.cart });
      } else {
        const botResponse: Message = {
          id: Date.now() + 1,
          text: data?.output || `Applied ${code}.`,
          isUser: false,
          timestamp: new Date(),
          kind: "text",
        };
        setMessages((prev) => [...prev, botResponse]);
        try { if (supabase) { await (supabase as any).from('n8n_chat_histories').insert({ session_id: currentSessionId, message: { role: 'assistant', content: botResponse.text } }); } } catch {}
      }
    } catch (e) {
      toast({ title: "Voucher", description: "Could not apply voucher." });
    } finally {
      setIsLoading(false);
    }
  };

  const updateLineQty = async (line: { product_name: string; product_id?: string; variant_id?: string; unit_price_cents?: number; image_url?: string }, qty: number) => {
    setIsLoading(true);
    upsertCartMessage({ text: `Updating ${line.product_name}…` });
    try {
      const currentSessionId = await getCurrentSessionId();
      const payload: any = {
        message: "",
        intent: "edit_line",
        product_name: line.product_name,
        product_id: line.product_id,
        variant_id: line.variant_id,
        unit_price_cents: (line as any).unit_price_cents,
        image_url: (line as any).image_url,
        qty,
        session_id: currentSessionId,
        user_id: user?.id || "anonymous",
        user_email: user?.email || "anonymous@example.com",
        timestamp: new Date().toISOString(),
        source: "chat_widget",
      };
      let data: any;
      if (supabase) {
        const { data: fnData, error: fnErr } = await (supabase as any).functions.invoke('chat', { body: payload });
        if (fnErr) throw fnErr;
        data = fnData;
      } else {
        if (!SUPABASE_FUNCTION_URL) throw new Error("Supabase Function URL missing");
        const response = await fetch(SUPABASE_FUNCTION_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error("Network response was not ok");
        data = await response.json();
      }
      if (!data?.cart) {
        const cartPayload: any = { message: "", intent: "get_cart_info", session_id: currentSessionId, user_id: user?.id || "anonymous", user_email: user?.email || "anonymous@example.com", timestamp: new Date().toISOString(), source: "chat_widget" };
        try {
          if (supabase) {
            const { data: cartData } = await (supabase as any).functions.invoke('chat', { body: cartPayload });
            if (cartData) data = { ...(data || {}), ...cartData };
          } else if (SUPABASE_FUNCTION_URL) {
            const r = await fetch(SUPABASE_FUNCTION_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cartPayload) });
            if (r.ok) data = { ...(data || {}), ...(await r.json()) };
          }
        } catch {}
      }
      if (data?.cart) {
        upsertCartMessage({ text: data?.output || `Updated ${line.product_name}.`, cart: data.cart });
      } else {
        const botResponse: Message = {
          id: Date.now() + 1,
          text: data?.output || `Updated ${line.product_name}.`,
          isUser: false,
          timestamp: new Date(),
          kind: "text",
        };
        setMessages((prev) => [...prev, botResponse]);
        try { if (supabase) { await (supabase as any).from('n8n_chat_histories').insert({ session_id: currentSessionId, role: 'assistant', content: botResponse.text }); } } catch {}
      }
    } catch (e) {
      toast({ title: "Cart", description: "Could not update quantity" });
    } finally {
      setIsLoading(false);
    }
  };

  const deleteLine = async (line: { product_name: string; product_id?: string; variant_id?: string }) => {
    setIsLoading(true);
    upsertCartMessage({ text: `Removing ${line.product_name}…` });
    try {
      const currentSessionId = await getCurrentSessionId();
      const payload: any = {
        message: "",
        intent: "delete_line",
        product_name: line.product_name,
        product_id: line.product_id,
        variant_id: line.variant_id,
        session_id: currentSessionId,
        user_id: user?.id || "anonymous",
        user_email: user?.email || "anonymous@example.com",
        timestamp: new Date().toISOString(),
        source: "chat_widget",
      };
      let data: any;
      if (supabase) {
        const { data: fnData, error: fnErr } = await (supabase as any).functions.invoke('chat', { body: payload });
        if (fnErr) throw fnErr;
        data = fnData;
      } else {
        if (!SUPABASE_FUNCTION_URL) throw new Error("Supabase Function URL missing");
        const response = await fetch(SUPABASE_FUNCTION_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error("Network response was not ok");
        data = await response.json();
      }
      if (!data?.cart) {
        const cartPayload: any = { message: "", intent: "get_cart_info", session_id: currentSessionId, user_id: user?.id || "anonymous", user_email: user?.email || "anonymous@example.com", timestamp: new Date().toISOString(), source: "chat_widget" };
        try {
          if (supabase) {
            const { data: cartData } = await (supabase as any).functions.invoke('chat', { body: cartPayload });
            if (cartData) data = { ...(data || {}), ...cartData };
          } else if (SUPABASE_FUNCTION_URL) {
            const r = await fetch(SUPABASE_FUNCTION_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cartPayload) });
            if (r.ok) data = { ...(data || {}), ...(await r.json()) };
          }
        } catch {}
      }
      if (data?.cart) {
        upsertCartMessage({ text: data?.output || `Removed ${line.product_name}.`, cart: data.cart });
      } else {
        const botResponse: Message = {
          id: Date.now() + 1,
          text: data?.output || `Removed ${line.product_name}.`,
          isUser: false,
          timestamp: new Date(),
          kind: "text",
        };
        setMessages((prev) => [...prev, botResponse]);
        try { if (supabase) { await (supabase as any).from('n8n_chat_histories').insert({ session_id: currentSessionId, role: 'assistant', content: botResponse.text }); } } catch {}
      }
    } catch (e) {
      toast({ title: "Cart", description: "Could not remove item" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Compute animation classes (no fade)
  const animClasses =
    anim === "in"
      ? "translate-y-0 scale-100 ease-out"
      : "translate-y-4 scale-0 ease-in";

  return (
    <>
      {/* Floating Chat Button */}
      {!isOpen && (
        <Button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90 shadow-lg hover:shadow-xl transition-all duration-200 z-50"
          size="icon"
        >
          <MessageCircle className="h-6 w-6 text-white" />
        </Button>
      )}

      {/* Chat Window (slide/scale only, no fade) */}
      {mounted && (
        <div
          className={`fixed bottom-6 right-6 z-[9999] transform transition-transform duration-200 ${animClasses}`}
        >
          <Card className="w-[25rem] h-[600px] shadow-2xl border-border bg-white">
            {/* Header */}
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-gradient-to-r from-primary to-blue-600 text-white rounded-t-lg">
              <CardTitle className="text-sm font-medium">Customer Support</CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsMinimized((v) => !v)}
                  className="h-6 w-6 text-white hover:bg-white/20"
                  title={isMinimized ? "Expand" : "Minimize"}
                >
                  <Minimize2 className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsOpen(false)}
                  className="h-6 w-6 text-white hover:bg-white/20"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </CardHeader>

            {!isMinimized && (
              <CardContent className="flex flex-col h-[calc(100%-60px)] p-0">
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                          message.isUser
                            ? "bg-primary text-white"
                            : "bg-gray-100 text-gray-800 border border-gray-200"
                        }`}
                      >
                        {message.isUser ? (
                          <span className="whitespace-pre-wrap">{message.text}</span>
                        ) : (
                          <>
                            {/* Bot messages - markdown text */}
                            <ReactMarkdown
                              components={{
                                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                                em: ({ children }) => <em className="italic">{children}</em>,
                                ul: ({ children }) => <ul className="list-disc ml-4 mb-2">{children}</ul>,
                                ol: ({ children }) => <ol className="list-decimal ml-4 mb-2">{children}</ol>,
                                li: ({ children }) => <li className="mb-1">{children}</li>,
                                a: ({ href, children }) => (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 underline"
                                  >
                                    {children}
                                  </a>
                                ),
                                img: ({ src, alt }) => (
                                  <img
                                    src={src}
                                    alt={alt}
                                    className="max-w-full h-auto rounded-md shadow-sm my-2 cursor-pointer hover:shadow-md transition-shadow"
                                    onClick={() => window.open(src as string, '_blank')}
                                  />
                                ),
                                code: ({ children }) => (
                                  <code className="bg-gray-200 px-1 py-0.5 rounded text-xs font-mono">
                                    {children}
                                  </code>
                                ),
                                blockquote: ({ children }) => (
                                  <blockquote className="border-l-4 border-gray-300 pl-4 italic">
                                    {children}
                                  </blockquote>
                                ),
                              }}
                            >
                              {message.text}
                            </ReactMarkdown>

                            {/* Rich content renderers */}
                            {message.kind === "products" && message.products && (
                              <div className="relative mt-3 -mx-2">
                                <div
                                  ref={(el) => { productScrollRefs.current[message.id] = el; }}
                                  className="flex gap-3 overflow-x-auto px-2 pb-2 snap-x snap-mandatory no-scrollbar"
                                >
                                  {message.products.map((p, idx) => (
                                    <div key={idx} className="flex-none w-[260px] snap-start p-3 border rounded-lg bg-white">
                                      <div className="space-y-2">
                                        {p.image_url && (
                                          <img
                                            src={p.image_url}
                                            alt={p.name}
                                            className="w-full h-36 rounded object-cover border"
                                            loading="lazy"
                                            onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/placeholder.svg'; }}
                                          />
                                        )}
                                        <div className="font-semibold leading-tight line-clamp-2">{p.name}</div>
                                        <div className="text-xs text-gray-600">{p.price_cents != null ? formatCurrency(p.price_cents) : (p.price != null ? `$${p.price.toFixed(2)}` : "")}</div>
                                        {p.tags && p.tags.length > 0 && (
                                          <div className="mt-1 flex flex-wrap gap-1">
                                            {p.tags.slice(0, 3).map((t, i) => (
                                              <span key={i} className="px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 text-[10px]">{t}</span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      {(p.description || (p.benefits && p.benefits.length > 0)) && (
                                        <div className="mt-2 text-xs text-gray-700">
                                          {p.description ? (
                                            <p className="line-clamp-3">{p.description}</p>
                                          ) : (
                                            <ul className="list-disc ml-4">
                                              {p.benefits!.slice(0, 3).map((b, i) => (<li key={i}>{b}</li>))}
                                            </ul>
                                          )}
                                        </div>
                                      )}
                                      {p.images && p.images.length > 1 && (
                                        <div className="mt-2 flex gap-2 overflow-x-auto">
                                          {p.images.slice(0, 3).map((src, i) => (
                                            <img
                                              key={i}
                                              src={src}
                                              alt={`${p.name}-${i}`}
                                              className="h-14 w-14 rounded object-cover border flex-none"
                                              loading="lazy"
                                              onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/placeholder.svg'; }}
                                            />
                                          ))}
                                        </div>
                                      )}
                                      <div className="mt-3">
                                        <Button size="sm" className="w-full" onClick={() => addToCart(p.name, 1, p.price_cents, p.id as any, (p as any).variant_id, p.image_url)}>
                                          Add to cart
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-white/90 shadow"
                                  aria-label="Scroll left"
                                  onClick={() => scrollProducts(message.id, "left")}
                                >
                                  <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-white/90 shadow"
                                  aria-label="Scroll right"
                                  onClick={() => scrollProducts(message.id, "right")}
                                >
                                  <ChevronRight className="h-4 w-4" />
                                </Button>
                              </div>
                            )}

                            {message.kind === "vouchers" && message.vouchers && (
                              <div className="mt-3 -mx-2">
                                <div className="flex gap-3 overflow-x-auto px-2 pb-2 snap-x snap-mandatory">
                                  {message.vouchers.map((v, idx) => (
                                    <div key={idx} className="flex-none w-[260px] snap-start p-3 border rounded-lg bg-white">
                                      <div className="font-semibold">{v.code}</div>
                                      <div className="text-xs text-gray-600 mt-1 line-clamp-2">{v.description || "Voucher"}</div>
                                      <div className="text-xs text-gray-700 mt-1">
                                        {v.discount_type === 'percentage' ? `${v.discount_value}% off` : v.discount_type === 'fixed' ? `$${(v.discount_value || 0).toFixed(2)} off` : ''}
                                        {v.min_spend ? ` • Min spend $${(v.min_spend || 0).toFixed(2)}` : ''}
                                      </div>
                                      {typeof v.estimated_savings_cents === 'number' && (
                                        <div className="text-xs text-green-700 mt-1">Save ~${((v.estimated_savings_cents || 0)/100).toFixed(2)}</div>
                                      )}
                                      <div className="mt-3">
                                        <Button size="sm" className="w-full" onClick={() => applyVoucher(v.code)}>
                                          Apply {v.code}
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {message.kind === "cart" && message.cart && (
                              <div className="mt-3 text-xs">
                                <div className="divide-y">
                                  {message.cart.items?.map((it, i) => (
                                    <div key={i} className="py-3 flex items-center gap-3">
                                      {it.image_url && (
                                        <img
                                          src={it.image_url}
                                          alt={it.product_name}
                                          className="w-12 h-12 rounded-md object-cover border"
                                          loading="lazy"
                                          onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/placeholder.svg'; }}
                                        />
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <div className="font-medium truncate" title={it.product_name}>{it.product_name}</div>
                                        <div className="mt-1 flex items-center gap-3 text-xs text-gray-600">
                                          <div className="inline-flex items-center rounded-md border bg-white">
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6"
                                              aria-label="Decrease quantity"
                                              onClick={() => updateLineQty({ product_name: it.product_name, product_id: (it as any).product_id, variant_id: (it as any).variant_id, unit_price_cents: (it as any).unit_price_cents, image_url: (it as any).image_url }, Math.max(0, (it.qty || 0) - 1))}
                                            >
                                              -
                                            </Button>
                                            <span className="w-6 text-center font-medium text-gray-800">{it.qty || 0}</span>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6"
                                              aria-label="Increase quantity"
                                              onClick={() => updateLineQty({ product_name: it.product_name, product_id: (it as any).product_id, variant_id: (it as any).variant_id, unit_price_cents: (it as any).unit_price_cents, image_url: (it as any).image_url }, (it.qty || 0) + 1)}
                                            >
                                              +
                                            </Button>
                                          </div>
                                          <Button
                                            variant="link"
                                            size="sm"
                                            className="h-auto p-0 text-red-600"
                                            onClick={() => deleteLine({ product_name: it.product_name, product_id: (it as any).product_id, variant_id: (it as any).variant_id })}
                                          >
                                            Remove
                                          </Button>
                                        </div>
                                      </div>
                                      <div className="text-sm font-medium text-gray-700">
                                        {formatCurrency((it.unit_price_cents || 0) * (it.qty || 0))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="mt-2 border-t pt-2 space-y-1">
                                  {(() => { const c = extractCartCents(message.cart); return (
                                    <>
                                      <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(c.subtotal)}</span></div>
                                      <div className="flex justify-between"><span>Discount</span><span>-{formatCurrency(c.discount)}</span></div>
                                      <div className="flex justify-between font-semibold"><span>Total</span><span>{formatCurrency(c.total)}</span></div>
                                    </>
                                  ); })()}
                                  {message.cart.voucher_code ? (
                                    <div className="text-green-600 mt-1">Voucher applied: <strong>{message.cart.voucher_code}</strong></div>
                                  ) : null}
                                  <div className="mt-3 grid grid-cols-2 gap-2">
                                    <Button variant="destructive" size="sm" className="w-full" onClick={clearCart}>
                                      Clear cart
                                    </Button>
                                    <Link
                                      to={CART_URL}
                                      className="inline-flex items-center justify-center rounded-md border bg-primary text-white text-sm py-1.5 w-full"
                                    >
                                      Go to cart
                                    </Link>
                                  </div>
                                </div>
                              </div>
                            )}

                            {message.kind === "ticket" && message.ticketId && (
                              <div className="mt-2 text-xs text-gray-700">Ticket <span className="font-semibold">#{message.ticketId}</span> created.</div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {isLoading && <TypingIndicator />}
                  {/* Scroll anchor */}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="p-4 border-t border-gray-200 bg-white">
                  <div className="flex space-x-2">
                    <Input
                      ref={inputRef}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Type your message..."
                      className="flex-1 border-gray-300 focus:border-primary"
                      disabled={isLoading}
                    />
                    <Button
                      onClick={sendMessage}
                      disabled={isLoading || !inputValue.trim()}
                      size="icon"
                      className="bg-primary hover:bg-primary/90"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      )}
    </>
  );
};

export default ChatWidget;