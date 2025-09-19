import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageCircle, Send, X, Minimize2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import TypingIndicator from "@/components/TypingIndicator";
import ReactMarkdown from 'react-markdown';
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";

interface Message {
  id: number;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

type AnimPhase = "in" | "out" | null;

const ChatWidget = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [isMinimized, setIsMinimized] = useState(false);
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
      if (user) {
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

      const response = await fetch(
        "https://primary-production-b68a.up.railway.app/webhook/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: messageText,
            timestamp: new Date().toISOString(),
            user_id: user?.id || "anonymous",
            user_email: user?.email || "anonymous@example.com",
            session_id: currentSessionId,
            source: "chat_widget",
          }),
        }
      );

      if (!response.ok) throw new Error("Network response was not ok");
      const data = await response.json();

      const botResponse: Message = {
        id: Date.now() + 1,
        text: data.output || "No response from bot.",
        isUser: false,
        timestamp: new Date(),
      };
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
                          // User messages - plain text
                          <span className="whitespace-pre-wrap">{message.text}</span>
                        ) : (
                          // Bot messages - render markdown
                          <ReactMarkdown
                            components={{
                              // Customize components to match your styling
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
                                  onClick={() => window.open(src, '_blank')}
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