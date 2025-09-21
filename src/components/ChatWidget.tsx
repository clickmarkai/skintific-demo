import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageCircle, Send, X, Minimize2 } from "lucide-react";
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
      const saved = localStorage.getItem('session_id');
      if (saved) return saved;
      const id = crypto.randomUUID();
      localStorage.setItem('session_id', id);
      return id;
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
    let currentSessionId = sessionId;
    if (user && supabase) {
      try {
        const { data: sessionData } = await supabase
          .from('sessions')
          .select('id')
          .eq('user_id', user.id)
          .order('started_at', { ascending: false })
          .limit(1)
          .single();
        if (sessionData) {
          currentSessionId = sessionData.id;
          try { localStorage.setItem('session_id', currentSessionId); } catch {}
        }
      } catch {}
    }
    return currentSessionId;
  };

  // Load past conversation from Supabase events for this session
  useEffect(() => {
    const loadHistory = async () => {
      if (!isOpen || historyLoaded || !supabase) return;
      // Determine the session id the same way as sendMessage
      let currentSessionId = sessionId;
      try {
        if (user) {
          const { data: sessionData } = await supabase
            .from('sessions')
            .select('id')
            .eq('user_id', user.id)
            .order('started_at', { ascending: false })
            .limit(1)
            .single();
          if (sessionData) currentSessionId = sessionData.id;
        }

        const { data } = await supabase
          .from('events')
          .select('type,payload,created_at')
          .eq('session_id', currentSessionId)
          .order('created_at', { ascending: true });

        if (Array.isArray(data) && data.length) {
          const hydrated: Message[] = [];
          data.forEach((row, idx) => {
            const payload: any = row.payload || {};
            if (row.type === 'chat_user') {
              hydrated.push({
                id: Date.now() + idx,
                text: payload.text || '',
                isUser: true,
                timestamp: new Date(row.created_at || Date.now()),
              });
            } else if (row.type === 'chat_assistant') {
              const m: Message = {
                id: Date.now() + 1000 + idx,
                text: payload.text || payload.output || '',
                isUser: false,
                timestamp: new Date(row.created_at || Date.now()),
                kind: 'text',
              };
              if (Array.isArray(payload.products)) {
                m.kind = 'products';
                m.products = payload.products;
              }
              if (payload.cart) {
                m.kind = 'cart';
                m.cart = payload.cart;
              }
              hydrated.push(m);
            }
          });
          if (hydrated.length) {
            // Prepend system greeting only if history empty
            setMessages((prev) => {
              const withoutGreeting = prev.length === 1 && !prev[0].isUser ? [] : prev;
              return [...withoutGreeting, ...hydrated];
            });
          }
        }
      } catch (e) {
        // no-op
      } finally {
        setHistoryLoaded(true);
      }
    };
    loadHistory();
  }, [isOpen, historyLoaded, supabase, sessionId, user]);

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
    setInputValue("");
    setIsLoading(true);

    try {
      // Get current session from database
      let currentSessionId = sessionId;
      if (user && supabase) {
        const { data: sessionData } = await supabase
          .from('sessions')
          .select('id')
          .eq('user_id', user.id)
          .order('started_at', { ascending: false })
          .limit(1)
          .single();
        
        if (sessionData) {
          currentSessionId = sessionData.id;
        }
      }

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
      }
      if (Array.isArray(data?.vouchers)) {
        botResponse.kind = "vouchers";
        botResponse.vouchers = data.vouchers;
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
    } catch (error) {
      console.error("Error sending message:", error);
      toast({
        title: "Message processing",
        description: "Your message could not be processed. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
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
        const { data: fnData, error: fnErr } = await (supabase as any).functions.invoke('chat', { body: payload });
        if (fnErr) throw fnErr;
        data = fnData;
      } else {
        if (!SUPABASE_FUNCTION_URL) throw new Error("Supabase Function URL missing");
        const response = await fetch(SUPABASE_FUNCTION_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error("Network response was not ok");
        data = await response.json();
      }

      const botResponse: Message = {
        id: Date.now() + 1,
        text: data?.output || `Added ${productName}.`,
        isUser: false,
        timestamp: new Date(),
        kind: data?.cart ? "cart" : "text",
        cart: data?.cart || undefined,
      };
      setMessages((prev) => [...prev, botResponse]);
    } catch (error) {
      console.error("Error adding to cart:", error);
      toast({ title: "Cart", description: "Could not add item to cart. Try again." });
    } finally {
      setIsLoading(false);
    }
  };

  const clearCart = async () => {
    setIsLoading(true);
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
      const botResponse: Message = {
        id: Date.now() + 1,
        text: data?.output || `Cart cleared.`,
        isUser: false,
        timestamp: new Date(),
        kind: data?.cart ? "cart" : "text",
        cart: data?.cart || undefined,
      };
      setMessages((prev) => [...prev, botResponse]);
    } catch (error) {
      console.error("Error clearing cart:", error);
      toast({ title: "Cart", description: "Could not clear cart. Try again." });
    } finally {
      setIsLoading(false);
    }
  };

  const applyVoucher = async (code: string) => {
    setIsLoading(true);
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

      const botResponse: Message = {
        id: Date.now() + 1,
        text: data?.output || `Applied ${code}.`,
        isUser: false,
        timestamp: new Date(),
        kind: data?.cart ? "cart" : "text",
        cart: data?.cart || undefined,
      };
      setMessages((prev) => [...prev, botResponse]);
    } catch (e) {
      toast({ title: "Voucher", description: "Could not apply voucher." });
    } finally {
      setIsLoading(false);
    }
  };

  const updateLineQty = async (line: { product_name: string; product_id?: string; variant_id?: string }, qty: number) => {
    setIsLoading(true);
    try {
      const currentSessionId = await getCurrentSessionId();
      const payload: any = {
        message: "",
        intent: "edit_line",
        product_name: line.product_name,
        product_id: line.product_id,
        variant_id: line.variant_id,
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
      const botResponse: Message = {
        id: Date.now() + 1,
        text: data?.output || `Updated ${line.product_name}.`,
        isUser: false,
        timestamp: new Date(),
        kind: data?.cart ? "cart" : "text",
        cart: data?.cart || undefined,
      };
      setMessages((prev) => [...prev, botResponse]);
    } catch (e) {
      toast({ title: "Cart", description: "Could not update quantity" });
    } finally {
      setIsLoading(false);
    }
  };

  const deleteLine = async (line: { product_name: string; product_id?: string; variant_id?: string }) => {
    setIsLoading(true);
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
      const botResponse: Message = {
        id: Date.now() + 1,
        text: data?.output || `Removed ${line.product_name}.`,
        isUser: false,
        timestamp: new Date(),
        kind: data?.cart ? "cart" : "text",
        cart: data?.cart || undefined,
      };
      setMessages((prev) => [...prev, botResponse]);
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
                              <div className="mt-3 -mx-2">
                                <div className="flex gap-3 overflow-x-auto px-2 pb-2 snap-x snap-mandatory">
                                  {message.products.map((p, idx) => (
                                    <div key={idx} className="flex-none w-[240px] snap-start p-3 border rounded-lg bg-white">
                                      <div className="flex gap-3 items-start">
                                        {p.image_url && (
                                          <img
                                            src={p.image_url}
                                            alt={p.name}
                                            className="w-16 h-16 rounded object-cover border"
                                            loading="lazy"
                                            onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/placeholder.svg'; }}
                                          />
                                        )}
                                        <div className="flex-1">
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
                                      </div>
                                      {(p.benefits && p.benefits.length > 0) && (
                                        <ul className="mt-2 text-xs list-disc ml-4">
                                          {p.benefits.slice(0, 3).map((b, i) => (<li key={i}>{b}</li>))}
                                        </ul>
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
                                              onClick={() => updateLineQty({ product_name: it.product_name, product_id: (it as any).product_id, variant_id: (it as any).variant_id }, Math.max(0, (it.qty || 0) - 1))}
                                            >
                                              -
                                            </Button>
                                            <span className="w-6 text-center font-medium text-gray-800">{it.qty || 0}</span>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6"
                                              aria-label="Increase quantity"
                                              onClick={() => updateLineQty({ product_name: it.product_name, product_id: (it as any).product_id, variant_id: (it as any).variant_id }, (it.qty || 0) + 1)}
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