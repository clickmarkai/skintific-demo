import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageCircle, Send, X, Minimize2, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
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
  kind?: "text" | "products" | "cart" | "ticket" | "vouchers" | "bundles";
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
  bundles?: Array<{
    id: string;
    title: string;
    description?: string;
    items: Array<{
      id?: string;
      variant_id?: string;
      name: string;
      price_cents?: number;
      image_url?: string;
    }>;
    price_cents: number;
    original_price_cents?: number;
    discount_percent?: number;
  }>;
  ticketId?: string;
}

type AnimPhase = "in" | "out" | null;

const ChatWidget = () => {
  const [isOpen, setIsOpen] = useState(() => {
    try { return localStorage.getItem('chat_open') === '1'; } catch { return false; }
  });
  const [sessionId, setSessionId] = useState(() => {
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const productScrollRefs = useRef<Record<number, HTMLDivElement | null>>({});
  // Simple notification sound using Web Audio
  const audioCtxRef = useRef<any>(null);
  // Prevent AI text animation from re-triggering on tab switch/re-render
  const animatedTextStartedRef = useRef<Set<any>>(new Set());
  // Typewriter counts for assistant text
  const aiCountsRef = useRef<Record<any, number>>({});
  const TYPE_INTERVAL_MS = 18;

  // Start typewriter for the newest assistant text message
  useEffect(() => {
    const lastAssistant = [...messages].reverse().find((m) => !m.isUser && (!m.kind || m.kind === 'text')) as any;
    if (!lastAssistant || !lastAssistant.text) return;
    const id = lastAssistant.id;
    if ((aiCountsRef.current[id] || 0) >= String(lastAssistant.text).length) return;
    let i = aiCountsRef.current[id] || 0;
    const limit = String(lastAssistant.text).length;
    const timer = window.setInterval(() => {
      i = Math.min(i + 1, limit);
      aiCountsRef.current[id] = i;
      // force rerender
      try { (setMessages as any)((prev: any) => [...prev]); } catch {}
      if (i >= limit) window.clearInterval(timer);
    }, TYPE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [messages]);

  const renderAnimatedText = (id: any, text: string) => {
    const total = String(text || '').length;
    const count = Math.max(0, Math.min(aiCountsRef.current[id] ?? total, total));
    const visible = String(text || '').slice(0, count);
    const rest = String(text || '').slice(count);
    const lines = visible.split('\n');
    return (
      <span>
        {lines.map((line, li) => (
          <span key={`line-${li}`}>
            {line.split(/(\s+)/).map((token, wi) => (
              token.trim().length === 0 ? (
                <span key={`sp-${li}-${wi}`}>{token}</span>
              ) : (
                <span key={`w-${li}-${wi}`} className="ai-word">
                  {token.split('').map((ch, ci) => (
                    <span key={`ch-${li}-${wi}-${ci}`} className="ai-fade-char">{ch}</span>
                  ))}
                </span>
              )
            ))}
            {li < lines.length - 1 ? <br /> : null}
          </span>
        ))}
        {rest ? <span style={{ opacity: 0 }}>{rest}</span> : null}
      </span>
    );
  };

  // Mark latest assistant text as animated after a duration so it won't restart on tab switches
  useEffect(() => {
    const lastAssistant = [...messages].reverse().find((m) => !m.isUser && (!m.kind || m.kind === 'text')) as any;
    if (!lastAssistant) return;
    if (animatedTextStartedRef.current.has(lastAssistant.id)) return;
    const len = String(lastAssistant.text || '').length;
    const total = Math.min(6000, Math.max(800, len * 18));
    const t = window.setTimeout(() => {
      animatedTextStartedRef.current.add(lastAssistant.id);
    }, total + 50);
    return () => window.clearTimeout(t);
  }, [messages]);
  const playNotify = () => {
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      let ctx = audioCtxRef.current as AudioContext | null;
      if (!ctx) {
        ctx = new AudioCtx();
        audioCtxRef.current = ctx;
      }
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      // Two quick tones for a clearer, louder ping
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      // brief second chirp
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1320, ctx.currentTime + 0.15);
      gain2.gain.setValueAtTime(0.0001, ctx.currentTime + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.17);
      gain2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
      osc2.connect(gain2).connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.15);
      osc.stop(ctx.currentTime + 0.3);
      osc2.stop(ctx.currentTime + 0.32);
    } catch {}
  };

  // Unlock Web Audio after first user interaction so the beep can play
  useEffect(() => {
    const unlock = () => {
      try {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        let ctx = audioCtxRef.current as AudioContext | null;
        if (!ctx) {
          ctx = new AudioCtx();
          audioCtxRef.current = ctx;
        }
        if (ctx.state === 'suspended') ctx.resume();
        // create an inaudible short sound to fully unlock on iOS
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.01);
      } catch {}
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  const [vouchersShown, setVouchersShown] = useState<boolean>(() => {
    try {
      const sid = localStorage.getItem('chat_session_id');
      const key = sid ? `chat_vouchers_shown_${sid}` : 'chat_vouchers_shown';
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });

  // Start a brand new chat session (reset session_id and local UI state)
  const handleNewChatSession = () => {
    try {
      const prev = localStorage.getItem('chat_session_id') || '';
      if (prev) {
        try { localStorage.removeItem(`chat_vouchers_shown_${prev}`); } catch {}
      }
      const fresh = crypto.randomUUID();
      localStorage.setItem('chat_session_id', fresh);
      // Optional: keep global session_id in sync if used elsewhere
      try { localStorage.setItem('session_id', fresh); } catch {}
      setSessionId(fresh);
      setVouchersShown(false);
      lastCartHashRef.current = null;
      setMessages([{ id: Date.now(), text: 'Hello! How can I help you today?', isUser: false, timestamp: new Date(), kind: 'text' } as any]);
      // Also close any modals and reset preview
      setShowBundleModal(false);
      setImgPreview(null);
    } catch {}
  };

  // Navigate helper: ensure bundle modal opens on cart page
  const handleGoToCart = () => {
    try { localStorage.setItem('chat_show_bundles', '1'); } catch {}
  };

  // Bundles modal inside chat
  const [showBundleModal, setShowBundleModal] = useState(false);
  const [bundleOffers, setBundleOffers] = useState<any[]>([]);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleAdding, setBundleAdding] = useState(false);
	const [bundleMounted, setBundleMounted] = useState(false);
	const [bundleAnim, setBundleAnim] = useState<AnimPhase>(null);
  // Image preview modal state
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [imgPreviewMounted, setImgPreviewMounted] = useState(false);
  const [imgAnim, setImgAnim] = useState<AnimPhase>(null);
  const lastCartHashRef = useRef<string | null>(null);
  const suppressCartSyncUntilRef = useRef<number>(0);

  const calcCartHash = (cart: any): string => {
    try {
      const items = Array.isArray(cart?.items) ? cart.items : [];
      const core = items.map((it: any) => ({ n: it.product_name, q: it.qty, p: it.unit_price_cents })).sort((a: any,b: any)=> (a.n||'').localeCompare(b.n||''));
      return JSON.stringify(core);
    } catch { return Math.random().toString(); }
  };

  // Broadcast + listen for cross-tab/app cart updates for sync between chat and cart page
  const markCartUpdated = (suppressMs: number = 0) => {
    try {
      if (suppressMs > 0) suppressCartSyncUntilRef.current = Date.now() + suppressMs;
      const ts = Date.now().toString();
      localStorage.setItem('cart_updated_at', ts);
      window.dispatchEvent(new CustomEvent('cart:updated', { detail: ts }));
    } catch {}
  };

  const refreshCartFromServer = async () => {
    try {
      // Allow external updates to override suppression (from cart page bundle adds)
      const now = Date.now();
      if (now < suppressCartSyncUntilRef.current) {
        console.log('Suppressing cart sync for', suppressCartSyncUntilRef.current - now, 'ms');
        return;
      }
      
      const currentSessionId = await getCurrentSessionId();
      let data: any = null;
      if (supabase) {
        const { data: d } = await (supabase as any).functions.invoke('chat', { body: { intent: 'get_cart_info', session_id: currentSessionId, user_id: user?.id || 'anonymous' } });
        data = d;
      } else if (SUPABASE_FUNCTION_URL) {
        const r = await fetch(SUPABASE_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'get_cart_info', session_id: currentSessionId, user_id: user?.id || 'anonymous' }) });
        if (r.ok) data = await r.json();
      }
      if (data?.cart) {
        upsertCartMessage({ text: 'Cart updated.', cart: data.cart });
      }
    } catch {}
  };

  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === 'cart_updated_at') { refreshCartFromServer(); } };
    const onCustom = () => refreshCartFromServer();
    window.addEventListener('storage', onStorage);
    window.addEventListener('cart:updated', onCustom as any);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('cart:updated', onCustom as any);
    };
  }, []);
  const openBundleModal = async () => {
    try {
      setBundleLoading(true);
      const currentSessionId = await getCurrentSessionId();
      let data: any;
      if (supabase) {
        const { data: fnData } = await (supabase as any).functions.invoke('chat', { body: { intent: 'get_cart_info', session_id: currentSessionId, user_id: user?.id || 'anonymous' } });
        data = fnData;
      } else if (SUPABASE_FUNCTION_URL) {
        const r = await fetch(SUPABASE_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'get_cart_info', session_id: currentSessionId, user_id: user?.id || 'anonymous' }) });
        if (r.ok) data = await r.json();
      }
      let bundles = Array.isArray(data?.bundles) ? data.bundles : [];
      if (!bundles.length) {
        // Try dedicated upsell endpoint as a fallback
        try {
          if (supabase) {
            const { data: u } = await (supabase as any).functions.invoke('chat', { body: { intent: 'get_upsell', session_id: currentSessionId, user_id: user?.id || 'anonymous' } });
            if (Array.isArray(u?.bundles)) bundles = u.bundles;
          } else if (SUPABASE_FUNCTION_URL) {
            const r2 = await fetch(SUPABASE_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'get_upsell', session_id: currentSessionId, user_id: user?.id || 'anonymous' }) });
            if (r2.ok) {
              const u = await r2.json();
              if (Array.isArray(u?.bundles)) bundles = u.bundles;
            }
          }
        } catch {}
      }
      if (!bundles.length) {
        // Last-resort local bundle based on chat state
        try {
          // Find latest cart items from messages
          const lastCart = [...messages].reverse().find((m) => m.kind === 'cart' && m.cart && Array.isArray(m.cart.items) && m.cart.items.length);
          const anchorLine = lastCart?.cart?.items?.[0];
          // Candidate products from last product messages
          const candidates: any[] = [];
          for (let i = messages.length - 1; i >= 0 && candidates.length < 6; i--) {
            const m = messages[i];
            if (m.kind === 'products' && Array.isArray(m.products)) {
              for (const p of m.products) {
                candidates.push(p);
                if (candidates.length >= 6) break;
              }
            }
          }
          if (anchorLine && candidates.length) {
            const anchor = {
              id: anchorLine.product_id,
              variant_id: anchorLine.variant_id,
              name: anchorLine.product_name,
              price_cents: anchorLine.unit_price_cents || 0,
              image_url: anchorLine.image_url,
            };
            const filtered = candidates.filter((p) => String(p.name || '').toLowerCase() !== String(anchor.name || '').toLowerCase());
            const others = filtered.slice(0, 2);
            if (others.length) {
              const items = [anchor, ...others].slice(0, 3).map((p) => ({ id: p.id, variant_id: (p as any).variant_id, name: p.name, price_cents: p.price_cents || (p as any).price || 0, image_url: p.image_url }));
              const original = items.reduce((s, p) => s + (p.price_cents || 0), 0);
              const price = Math.max(0, Math.round(original * 0.9));
              bundles = [{ id: `local-bundle-${Date.now()}`, title: 'Smart Routine Bundle', description: 'Cart item + complementary picks at 10% off.', items, price_cents: price, original_price_cents: original, discount_percent: 10 }];
            }
          }
        } catch {}
      }
		setBundleOffers(bundles || []);
		setShowBundleModal(true);
    } catch {
		setBundleOffers([]);
		setShowBundleModal(true);
    } finally { setBundleLoading(false); }
  };

	// Bundle modal animation mount/unmount
	useEffect(() => {
		if (showBundleModal) {
			setBundleMounted(true);
			requestAnimationFrame(() => setBundleAnim("in"));
		} else if (bundleMounted) {
			setBundleAnim("out");
			const t = setTimeout(() => { setBundleMounted(false); setBundleAnim(null); }, 300);
			return () => clearTimeout(t);
		}
	}, [showBundleModal, bundleMounted]);

	const closeBundleModal = () => {
		if (bundleAdding) return; // prevent closing while adding
		setShowBundleModal(false);
	};

// Image preview mount/unmount and ESC close
useEffect(() => {
  if (imgPreview) {
    setImgPreviewMounted(true);
    requestAnimationFrame(() => setImgAnim("in"));
  } else if (imgPreviewMounted) {
    setImgAnim("out");
    const t = setTimeout(() => { setImgPreviewMounted(false); setImgAnim(null); }, 200);
    return () => clearTimeout(t);
  }
}, [imgPreview, imgPreviewMounted]);

useEffect(() => {
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setImgPreview(null); };
  if (imgPreviewMounted) window.addEventListener('keydown', onKey as any);
  return () => window.removeEventListener('keydown', onKey as any);
}, [imgPreviewMounted]);

  const addBundleToCart = async (bundle: any) => {
    try {
      setIsLoading(true);
      setBundleAdding(true);
      const currentSessionId = await getCurrentSessionId();
      const items = Array.isArray(bundle?.items) ? bundle.items : [];
      const payload: any = { intent: 'add_bundle', session_id: currentSessionId, user_id: user?.id || 'anonymous', items, discount_percent: bundle?.discount_percent || 10 };
      let prevCount = 0;
      try {
        const lastCart = [...messages].reverse().find((m) => m.kind === 'cart' && m.cart && Array.isArray(m.cart.items));
        prevCount = lastCart?.cart?.items?.length || 0;
      } catch {}
      let addResp: any = null;
      if (supabase) {
        const { data: r, error: e } = await (supabase as any).functions.invoke('chat', { body: payload });
        if (e) throw e; addResp = r;
      } else if (SUPABASE_FUNCTION_URL) {
        const r = await fetch(SUPABASE_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error('add_bundle failed');
        addResp = await r.json();
      }
      // Refresh cart snapshot
      let data: any;
      if (supabase) {
        const { data: d } = await (supabase as any).functions.invoke('chat', { body: { intent: 'get_cart_info', session_id: currentSessionId, user_id: user?.id || 'anonymous' } });
        data = d;
      } else if (SUPABASE_FUNCTION_URL) {
        const r = await fetch(SUPABASE_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'get_cart_info', session_id: currentSessionId, user_id: user?.id || 'anonymous' }) });
        if (r.ok) data = await r.json();
      }
      if (addResp?.cart) {
        const newCount = Array.isArray(addResp.cart?.items) ? addResp.cart.items.length : prevCount;
        if (newCount <= prevCount) {
          addResp = null; // trigger fallback below
        }
      }

      if (addResp?.cart) {
        await upsertCartMessage({ text: 'Bundle added to cart.', cart: addResp.cart });
        // Delay broadcast slightly to avoid stale snapshot overriding the fresh UI
        markCartUpdated(600);
      } else if (!addResp?.cart) {
        // Fallback: add or update each line individually with discounted price
        const discountPercent = Number(bundle?.discount_percent || 10);
        // Load current cart to detect existing lines
        let currentCart: any = null;
        try {
          if (supabase) {
            const { data: d } = await (supabase as any).functions.invoke('chat', { body: { intent: 'get_cart_info', session_id: currentSessionId, user_id: user?.id || 'anonymous' } });
            currentCart = d?.cart;
          } else if (SUPABASE_FUNCTION_URL) {
            const rInfo = await fetch(SUPABASE_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'get_cart_info', session_id: currentSessionId, user_id: user?.id || 'anonymous' }) });
            if (rInfo.ok) { const d = await rInfo.json(); currentCart = d?.cart; }
          }
        } catch {}
        const lines: any[] = Array.isArray(currentCart?.items) ? currentCart.items : [];
        const matchLine = (it: any) => {
          const key = (String(it.id || it.variant_id || '').toLowerCase());
          const title = String(it.name || '').toLowerCase();
          return lines.find((l: any) =>
            (String(l.product_id || '').toLowerCase() === key || String(l.variant_id || '').toLowerCase() === key) ||
            String(l.product_name || '').toLowerCase() === title
          );
        };
        for (const it of items) {
          const unit = Math.max(0, Math.round((it.price_cents || 0) * (100 - discountPercent) / 100));
          const existing = matchLine(it);
          const basePayload: any = {
            message: '',
            product_name: existing?.product_name || it.name,
            product_id: existing?.product_id || it.id,
            variant_id: existing?.variant_id || it.variant_id,
            unit_price_cents: unit,
            session_id: currentSessionId,
            user_id: user?.id || 'anonymous',
            user_email: user?.email || 'anonymous@example.com',
            image_url: it.image_url || undefined,
          };
          if (existing) {
            // Update price without changing qty
            const editPayload = { ...basePayload, intent: 'edit_line', qty: existing.qty };
            if (supabase) {
              await (supabase as any).functions.invoke('chat', { body: editPayload });
            } else if (SUPABASE_FUNCTION_URL) {
              await fetch(SUPABASE_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editPayload) });
            }
          } else {
            const addPayload = { ...basePayload, intent: 'add_line', qty: 1 };
            if (supabase) {
              await (supabase as any).functions.invoke('chat', { body: addPayload });
            } else if (SUPABASE_FUNCTION_URL) {
              await fetch(SUPABASE_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(addPayload) });
            }
          }
        }
        // Refresh cart snapshot
        try {
          if (supabase) {
            const { data: d } = await (supabase as any).functions.invoke('chat', { body: { intent: 'get_cart_info', session_id: currentSessionId, user_id: user?.id || 'anonymous' } });
            if (d?.cart) {
              await upsertCartMessage({ text: 'Bundle added to cart.', cart: d.cart });
              markCartUpdated(600);
            }
          } else if (SUPABASE_FUNCTION_URL) {
            const r3 = await fetch(SUPABASE_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'get_cart_info', session_id: currentSessionId, user_id: user?.id || 'anonymous' }) });
            if (r3.ok) {
              const d = await r3.json();
              if (d?.cart) {
                await upsertCartMessage({ text: 'Bundle added to cart.', cart: d.cart });
                markCartUpdated(600);
              }
            }
          }
        } catch {}
      } else if (data?.cart) {
        await upsertCartMessage({ text: 'Bundle added to cart.', cart: data.cart });
        markCartUpdated(600);
      }
      try { localStorage.setItem('bundle_applied', '1'); } catch {}
      // Navigate to cart page after success
      try { window.location.assign(CART_URL); } catch {}
    } catch {} finally {
      setShowBundleModal(false);
      setIsLoading(false);
      setBundleAdding(false);
    }
  };

	const renderBundlePortal = () =>
    createPortal(
			<div className="fixed inset-0 z-[100000]">
				<div className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${bundleAnim === 'in' ? 'opacity-100' : 'opacity-0'}`} onClick={closeBundleModal} />
				<div className="absolute inset-0 p-4 md:p-8 overflow-auto flex items-center justify-center">
					<div className={`w-full max-w-3xl md:max-w-4xl bg-white rounded-2xl shadow-2xl border border-black/10 min-sh-[510px] flex flex-col transform transition-all duration-300 ${bundleAnim === 'in' ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-95'}`}>
            <div className="flex items-center justify-between px-5 py-4 rounded-t-2xl bg-gradient-to-r from-black to-gray-800 text-white">
              <div className="text-lg font-semibold">Special bundle offer</div>
							<Button variant="ghost" size="sm" className="text-white hover:bg-white/10" onClick={closeBundleModal}>Close</Button>
            </div>
            <div className="p-5 flex-1 overflow-auto">
            {bundleLoading ? (
              <div className="text-sm text-gray-600">Preparing bundle suggestions…</div>
            ) : bundleOffers.length === 0 ? (
              <div className="text-sm text-gray-600">No bundle suggestions available right now.</div>
            ) : (
              <div className="space-y-5">
                {bundleOffers.slice(0,2).map((b, idx) => (
                  <div key={idx} className="border rounded-xl p-4 bg-white">
                    <div className="text-lg font-semibold">{b.title}</div>
                    <div className="text-sm text-gray-600 mt-1">{b.description || 'Special pricing when purchased together.'}</div>
										<div className="mt-3 grid grid-cols-3 gap-4">
											{(b.items||[]).slice(0,3).map((p: any, i:number)=> (
												<div key={i} className="text-xs group rounded-md border bg-white/60 hover:shadow-lg transition-shadow overflow-hidden">
													{p.image_url && (
														<div className="relative rounded-md overflow-hidden">
															<img
																src={p.image_url}
																alt={p.name}
																className="w-full h-52 object-cover transition-transform duration-300 ease-out group-hover:scale-105"
															/>
														</div>
													)}
													<div className="truncate mt-1 font-medium px-2" title={p.name}>{p.name}</div>
													<div className="text-[12px] text-gray-700 px-2 pb-2">${((p.price_cents||0)/100).toFixed(2)}</div>
												</div>
											))}
										</div>
                    <div className="mt-4 flex items-center justify-between">
											<div className="text-sm">Bundle price: <span className="font-semibold text-lg">${((b.price_cents||0)/100).toFixed(2)}</span> <span className="ml-2 line-through text-gray-500">${((b.original_price_cents||0)/100).toFixed(2)}</span> <span className="ml-2 text-green-700 font-medium">{b.discount_percent || 10}% off</span></div>
											<div className="flex gap-3">
												<Link to={CART_URL} className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white text-black text-sm px-4 py-2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">Go to cart</Link>
												<Button className="px-4 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md" onClick={() => addBundleToCart(b)} disabled={bundleAdding}>
                          {bundleAdding ? (
                            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Adding…</span>
                          ) : (
                            'Add to cart'
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
        </div>
      </div>,
      document.body
    );

  const scrollProducts = (id: number, direction: "left" | "right") => {
    const container = productScrollRefs.current[id];
    if (!container) return;
    const delta = Math.max(240, Math.floor(container.clientWidth * 0.9));
    container.scrollBy({ left: direction === "left" ? -delta : delta, behavior: "smooth" });
  };

  // NEW: animation mount + phase
  const [mounted, setMounted] = useState(false);
  const [anim, setAnim] = useState<AnimPhase>(null);
  const ANIM_MS = 320; // match CSS duration for smoother open/close
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
    try {
      const ls = localStorage.getItem('chat_session_id');
      if (ls && ls.length > 0) return ls;
    } catch {}
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
          let restored: Message[] = data.map((row: any, idx: number) => {
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
          // Filter out transient "Adding ...", "Added ...", and "Bundle added ..." status messages from history
          restored = restored.filter((m) => !(m.kind === 'text' && (/^Adding\s/i.test(m.text || '') || /^Added\s/i.test(m.text || '') || /Bundle added/i.test(m.text || ''))));
          // Keep only the latest cart snapshot to avoid duplicate carts after refresh
          let lastCartIdx = -1;
          for (let i = 0; i < restored.length; i++) { if (restored[i].kind === 'cart') lastCartIdx = i; }
          if (lastCartIdx >= 0) {
            restored = restored.filter((_, i) => restored[i].kind !== 'cart' || i === lastCartIdx);
            try {
              const lastCart = (restored[lastCartIdx] as any)?.cart;
              if (lastCart) {
                const items = Array.isArray(lastCart.items) ? lastCart.items : [];
                const core = items.map((it: any)=>({ n: it.product_name, q: it.qty, p: it.unit_price_cents })).sort((a:any,b:any)=> (a.n||'').localeCompare(b.n||''));
                lastCartHashRef.current = JSON.stringify(core);
              }
            } catch {}
          }
          // Keep only the latest "recommended products" prompt
          let lastRecoIdx = -1;
          for (let i = 0; i < restored.length; i++) { if (restored[i].kind === 'text' && /recommended products/i.test(restored[i].text || '')) lastRecoIdx = i; }
          if (lastRecoIdx >= 0) {
            restored = restored.filter((_, i) => !(restored[i].kind === 'text' && /recommended products/i.test(restored[i].text || '') && i !== lastRecoIdx));
          }
          const hasGreeting = restored.some((m) => !m.isUser && typeof m.text === 'string' && /hello/i.test(m.text) && /help/i.test(m.text));
          const hasVouchers = restored.some((m) => m.kind === 'vouchers');
          if (hasVouchers) {
            try { const key = `chat_vouchers_shown_${sessionId}`; localStorage.setItem(key, '1'); } catch {}
            setVouchersShown(true);
          }
          if (!hasGreeting) {
            restored.unshift({ id: Date.now() - 1, text: initialGreeting, isUser: false, timestamp: new Date(), kind: 'text' });
          }
          setMessages(restored);
        } else if (!cancelled) {
          // No history — show greeting locally, do not persist to DB
          setMessages([{ id: Date.now() - 1, text: initialGreeting, isUser: false, timestamp: new Date(), kind: 'text' }]);
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

      setMessages((prev) => {
        // Suppress duplicate consecutive system prompts
        const last = prev[prev.length - 1];
        if (botResponse.kind === 'text' && /recommended products/i.test(botResponse.text || '') && last && last.kind === 'text' && /recommended products/i.test(last.text || '')) {
          return prev;
        }
        const next = [...prev, botResponse];
        playNotify();
        return next;
      });
      // Persist assistant message with structured payload so carousels restore after refresh
      try {
        if (supabase) {
          const persisted: any = { role: 'assistant', content: botResponse.text };
          if (botResponse.kind) persisted.kind = botResponse.kind;
          if (Array.isArray(data?.products)) persisted.products = data.products;
          if (Array.isArray(data?.vouchers)) persisted.vouchers = data.vouchers;
          if (data?.cart) persisted.cart = data.cart;
          if (typeof data?.ticket_id === 'string') persisted.ticket_id = data.ticket_id;
          // Prevent duplicate consecutive system prompts and duplicate cart snapshots
          const skipPersist = (botResponse.kind === 'text' && /recommended products/i.test(botResponse.text || '')) || (botResponse.kind === 'cart');
          if (!skipPersist) {
            await (supabase as any).from('n8n_chat_histories').insert({ session_id: sessionId, message: persisted });
          }
        }
      } catch {}
      // Do not persist plain text copy to avoid duplicates
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
            setMessages((prev) => { const next = [...prev, fallback]; playNotify(); return next; });
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
      if (supabase && payload.cart) {
        const snapshot = payload.cart;
        const coreHash = JSON.stringify((snapshot.items || []).map((it: any)=>({ n: it.product_name, q: it.qty, p: it.unit_price_cents })).sort((a:any,b:any)=> (a.n||'').localeCompare(b.n||'')));
        const last = lastCartHashRef.current;
        if (coreHash !== last) {
          await (supabase as any).from('n8n_chat_histories').insert({ session_id: sessionId, message: { role: 'assistant', content: payload.text || 'Cart updated.', kind: 'cart', cart: snapshot } });
          lastCartHashRef.current = coreHash;
        }
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
            .eq('session_id', currentSessionId)
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
            output: `Cart updated.`,
            cart: {
              items,
              subtotal_cents: subtotal,
              discount_cents: 0,
              total_cents: subtotal,
              voucher_code: null,
            },
          };
          // Immediately reflect in UI without waiting for remote sync
          upsertCartMessage({ text: 'Cart updated.', cart: data.cart });
          // Don't immediately trigger remote refresh that could return an older snapshot
          markCartUpdated(300);
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
        upsertCartMessage({ text: data?.output || `Cart updated.`, cart: data.cart });
        markCartUpdated(300);
        // If backend provides upsell, render below as a products carousel with a short heading
        if (Array.isArray(data?.upsell) && data.upsell.length) {
          const upsellMsg: Message = {
            id: Date.now() + 3,
            text: 'You may also like these to complete your routine:',
            isUser: false,
            timestamp: new Date(),
            kind: 'products',
            products: data.upsell,
          } as any;
          setMessages((prev) => [...prev, upsellMsg]);
          try {
            if (supabase) {
              await (supabase as any).from('n8n_chat_histories').insert({ session_id: currentSessionId, message: { role: 'assistant', content: upsellMsg.text, kind: 'products', products: data.upsell } });
            }
          } catch {}
        }
        if (Array.isArray((data as any)?.bundles) && (data as any).bundles.length) {
          const bundleMsg: Message = {
            id: Date.now() + 3,
            text: '',
            isUser: false,
            timestamp: new Date(),
            kind: 'bundles',
            bundles: (data as any).bundles,
          } as any;
          setMessages((prev) => [...prev, bundleMsg]);
          try { if (supabase) { await (supabase as any).from('n8n_chat_histories').insert({ session_id: currentSessionId, message: { role: 'assistant', content: bundleMsg.text, kind: 'bundles', bundles: (data as any).bundles } }); } } catch {}
        }
        // After first add to cart, try to fetch applicable vouchers silently
        try {
          if (vouchersShown) return; // already shown once this session
          let vouchersResp: any;
          if (supabase) {
            const [{ data: fnData }, { data: upsellData }] = await Promise.all([
              (supabase as any).functions.invoke('chat', { body: { intent: 'apply_voucher', session_id: currentSessionId, user_id: user?.id || 'anonymous', user_email: user?.email || 'anonymous@example.com' } }),
              (supabase as any).functions.invoke('chat', { body: { intent: 'get_upsell', session_id: currentSessionId, user_id: user?.id || 'anonymous' } }),
            ]);
            vouchersResp = fnData;
            // opportunistically render upsell if present
            if (upsellData && Array.isArray(upsellData.upsell) && upsellData.upsell.length) {
              const upsellMsg: Message = { id: Date.now() + 5, text: upsellData.output || 'You may also like these to complete your routine:', isUser: false, timestamp: new Date(), kind: 'products', products: upsellData.upsell } as any;
              setMessages((prev) => [...prev, upsellMsg]);
              try { await (supabase as any).from('n8n_chat_histories').insert({ session_id: currentSessionId, message: { role: 'assistant', content: upsellMsg.text, kind: 'products', products: upsellData.upsell } }); } catch {}
            }
            if (upsellData && Array.isArray((upsellData as any).bundles) && (upsellData as any).bundles.length) {
              const bundleMsg: Message = { id: Date.now() + 6, text: '', isUser: false, timestamp: new Date(), kind: 'bundles', bundles: (upsellData as any).bundles } as any;
              setMessages((prev) => [...prev, bundleMsg]);
              try { if (supabase) { await (supabase as any).from('n8n_chat_histories').insert({ session_id: currentSessionId, message: { role: 'assistant', content: bundleMsg.text, kind: 'bundles', bundles: (upsellData as any).bundles } }); } } catch {}
            }
          } else if (SUPABASE_FUNCTION_URL) {
            const [r1, r2] = await Promise.all([
              fetch(SUPABASE_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'apply_voucher', session_id: currentSessionId, user_id: user?.id || 'anonymous', user_email: user?.email || 'anonymous@example.com' }) }),
              fetch(SUPABASE_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'get_upsell', session_id: currentSessionId, user_id: user?.id || 'anonymous' }) }),
            ]);
            if (r1.ok) vouchersResp = await r1.json();
            if (r2.ok) {
              const upsellData = await r2.json();
              if (upsellData && Array.isArray(upsellData.upsell) && upsellData.upsell.length) {
                const upsellMsg: Message = { id: Date.now() + 6, text: upsellData.output || 'You may also like these to complete your routine:', isUser: false, timestamp: new Date(), kind: 'products', products: upsellData.upsell } as any;
                setMessages((prev) => [...prev, upsellMsg]);
              }
              if (upsellData && Array.isArray((upsellData as any).bundles) && (upsellData as any).bundles.length) {
                const bundleMsg: Message = { id: Date.now() + 6, text: '', isUser: false, timestamp: new Date(), kind: 'bundles', bundles: (upsellData as any).bundles } as any;
                setMessages((prev) => [...prev, bundleMsg]);
              }
            }
          }
          if (vouchersResp && Array.isArray(vouchersResp.vouchers) && vouchersResp.vouchers.length) {
            const heading: string = (typeof vouchersResp.output === 'string' && vouchersResp.output.trim())
              ? vouchersResp.output
              : 'Here are the usable vouchers for your cart.';
            const voucherMsg: Message = { id: Date.now() + 2, text: heading, isUser: false, timestamp: new Date(), kind: 'vouchers', vouchers: vouchersResp.vouchers } as any;
            setMessages((prev) => [...prev, voucherMsg]);
            try {
              if (supabase) {
                await (supabase as any).from('n8n_chat_histories').insert({ session_id: currentSessionId, message: { role: 'assistant', content: heading, kind: 'vouchers', vouchers: vouchersResp.vouchers } });
              }
            } catch {}
            setVouchersShown(true);
            try { localStorage.setItem(`chat_vouchers_shown_${currentSessionId}`, '1'); } catch {}
          }
        } catch {}
      } else {
        const botResponse: Message = {
          id: Date.now() + 1,
          text: data?.output || `Added ${productName}.`,
          isUser: false,
          timestamp: new Date(),
          kind: "text",
        };
        setMessages((prev) => { const next = [...prev, botResponse]; playNotify(); return next; });
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
        markCartUpdated(300);
      } else {
        const botResponse: Message = {
          id: Date.now() + 1,
          text: data?.output || `Cart cleared.`,
          isUser: false,
          timestamp: new Date(),
          kind: "text",
        };
        setMessages((prev) => { const next = [...prev, botResponse]; playNotify(); return next; });
        markCartUpdated();
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
        setMessages((prev) => { const next = [...prev, botResponse]; playNotify(); return next; });
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
        markCartUpdated(300);
      } else {
        const botResponse: Message = {
          id: Date.now() + 1,
          text: data?.output || `Updated ${line.product_name}.`,
          isUser: false,
          timestamp: new Date(),
          kind: "text",
        };
        setMessages((prev) => { const next = [...prev, botResponse]; playNotify(); return next; });
        try { if (supabase) { await (supabase as any).from('n8n_chat_histories').insert({ session_id: currentSessionId, role: 'assistant', content: botResponse.text }); } } catch {}
        markCartUpdated(300);
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
        markCartUpdated(300);
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
        markCartUpdated(300);
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
      ? "opacity-100 translate-y-0 scale-100 ease-out"
      : "opacity-0 translate-y-3 scale-95 ease-in";

  return (
    <>
      {/* Floating Chat Button */}
      {!isOpen && (
        <Button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-black hover:bg-black/90 shadow-lg hover:shadow-xl transition-all duration-200 z-50"
          size="icon"
        >
          <MessageCircle className="h-6 w-6 text-white" />
        </Button>
      )}

      {/* Chat Window (slide/scale only, no fade) */}
      {mounted && (
        <div
          className={`fixed bottom-6 right-6 z-[9999] transform transition-all duration-300 ${animClasses}`}
        >
          <Card className="w-[25rem] h-[600px] shadow-2xl border-border bg-white">
            {/* Header */}
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-black text-white rounded-t-lg">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                Customer Support
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleNewChatSession}
                  className="h-6 px-2 text-black bg-white hover:bg-white/90 transition-all duration-150"
                  title="Start a new chat"
                >
                  New chat
                </Button>
              </CardTitle>
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
				{/* Modal for Bundles with transitions */}
				{bundleMounted && renderBundlePortal()}
                {/* Image preview modal */}
                {imgPreviewMounted && createPortal(
                  <div className="fixed inset-0 z-[100001]">
                    <div className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${imgAnim === 'in' ? 'opacity-100' : 'opacity-0'}`} />
                    <div className="absolute inset-0 p-4 md:p-10 flex items-center justify-center" onClick={() => setImgPreview(null)}>
                      <img
                        src={imgPreview || ''}
                        alt="preview"
                        className={`max-h-[90vh] max-w-[90vw] rounded-xl shadow-2xl transform transition-all duration-200 cursor-zoom-out ${imgAnim === 'in' ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        className={`absolute top-4 right-4 h-8 w-8 rounded-full bg-white/90 text-black shadow transition-opacity duration-200 hover:bg-white ${imgAnim === 'in' ? 'opacity-100' : 'opacity-0'}`}
                        onClick={() => setImgPreview(null)}
                        aria-label="Close preview"
                      >
                        <X className="h-5 w-5 m-auto" />
                      </button>
                    </div>
                  </div>, document.body)}
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm msg-pop-in ${
                          message.isUser
                            ? "bg-black text-white"
                            : "bg-white text-black border border-black/10"
                        }`}
                      >
                        {message.isUser ? (
                          <span className="whitespace-pre-wrap">
                            {String(message.text || "")
                              .split("")
                              .map((ch, i) => (
                                <span key={i} className="ai-fade-char" style={{ animationDelay: `${i * 0.01}s` }}>{ch}</span>
                              ))}
                          </span>
                        ) : (
                          <>
                            {/* Bot messages - animated text (letter-by-letter fade) */}
                            <div className="whitespace-pre-wrap">
                              {renderAnimatedText((message as any).id, message.text)}
                            </div>

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
                                            className="w-full h-36 rounded object-cover border cursor-zoom-in transition-transform duration-200 ease-out hover:scale-105 hover:shadow"
                                            loading="lazy"
                                            onClick={() => p.image_url ? setImgPreview(p.image_url) : null}
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
                                            <p className="whitespace-pre-wrap break-words">{p.description}</p>
                                          ) : (
                                            <ul className="list-disc ml-4">
                                              {p.benefits!.slice(0, 5).map((b, i) => (<li key={i}>{b}</li>))}
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
                                              className="h-14 w-14 rounded object-cover border flex-none cursor-zoom-in transition-transform duration-200 ease-out hover:scale-105 hover:shadow"
                                              loading="lazy"
                                              onClick={() => setImgPreview(src)}
                                              onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/placeholder.svg'; }}
                                            />
                                          ))}
                                        </div>
                                      )}
                                      <div className="mt-3">
                                        <Button size="sm" className="w-full transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-95" onClick={() => addToCart(p.name, 1, p.price_cents, p.id as any, (p as any).variant_id, p.image_url)}>
                                          Add to cart
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="absolute -left-3 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-white/90 shadow"
                                  aria-label="Scroll left"
                                  onClick={() => scrollProducts(message.id, "left")}
                                >
                                  <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="absolute -right-3 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-white/90 shadow"
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
                                          className="w-12 h-12 rounded-md object-cover border cursor-zoom-in transition-transform duration-200 ease-out hover:scale-105 hover:shadow"
                                          loading="lazy"
                                          onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/placeholder.svg'; }}
                                          onClick={() => it.image_url ? setImgPreview(it.image_url as string) : null}
                                        />
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <div className="font-medium truncate" title={it.product_name}>{it.product_name}</div>
                                        <div className="mt-1 flex items-center gap-3 text-xs text-gray-600">
                                          <div className="inline-flex items-center rounded-md border bg-white">
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6 transition-transform duration-150 hover:-translate-y-0.5 active:scale-95"
                                              aria-label="Decrease quantity"
                                              onClick={() => updateLineQty({ product_name: it.product_name, product_id: (it as any).product_id, variant_id: (it as any).variant_id, unit_price_cents: (it as any).unit_price_cents, image_url: (it as any).image_url }, Math.max(0, (it.qty || 0) - 1))}
                                            >
                                              -
                                            </Button>
                                            <span className="w-6 text-center font-medium text-gray-800">{it.qty || 0}</span>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6 transition-transform duration-150 hover:-translate-y-0.5 active:scale-95"
                                              aria-label="Increase quantity"
                                              onClick={() => updateLineQty({ product_name: it.product_name, product_id: (it as any).product_id, variant_id: (it as any).variant_id, unit_price_cents: (it as any).unit_price_cents, image_url: (it as any).image_url }, (it.qty || 0) + 1)}
                                            >
                                              +
                                            </Button>
                                          </div>
                                          <Button
                                            variant="link"
                                            size="sm"
                                            className="h-auto p-0 text-red-600 transition-colors duration-150 hover:text-red-700 underline-offset-2 hover:underline"
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
                                    <Button variant="destructive" size="sm" className="w-full disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 hover:-translate-y-0.5 hover:shadow" onClick={clearCart} disabled={isLoading || (extractCartCents(message.cart).total === 0)}>
                                      Clear Cart
                                    </Button>
                                    <Button
                                      size="sm"
                                      className="w-full disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 hover:-translate-y-0.5 hover:shadow"
                                      onClick={openBundleModal}
                                      disabled={bundleLoading || (extractCartCents(message.cart).total === 0)}
                                    >
                                      {bundleLoading ? (
                                        <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>
                                      ) : (
                                        'Go to Cart'
                                      )}
                                    </Button>
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
                      className="flex-1 border-gray-300 focus:border-primary transition-all duration-200 focus:-translate-y-0.5 focus:shadow-[0_0_0_4px_rgba(0,0,0,0.08)]"
                      disabled={isLoading}
                    />
                    <Button
                      onClick={sendMessage}
                      disabled={isLoading || !inputValue.trim()}
                      size="icon"
                      className="bg-black hover:bg-black/90"
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