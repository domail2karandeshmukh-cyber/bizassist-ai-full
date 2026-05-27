"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import jsPDF from "jspdf";

// =========================== TYPES ===========================
type Product = {
  id: string;
  name: string;
  price: number;
  keywords: string[];
  perUser?: boolean;
};

type QuoteItem = {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
};

type HistoryEntry = {
  id: string;
  createdAt: string; // ISO
  snippet: string;
  items: QuoteItem[];
  total: number;
  text: string;
  source: "catalogue" | "ai" | "ai-fallback";
};

type ActivityEntry = {
  id: string;
  type: "quote" | "ai" | "pdf" | "login";
  title: string;
  desc: string;
  iconClass: string;
  time: string; // ISO
};

type ChatMessage = { role: "bot" | "user"; text: string };

type ToastItem = { id: string; title: string; msg: string; kind: "success" | "info" };

type FaqItem = { q: string; a: string };

// =========================== CONSTANTS ===========================
const DEFAULT_CATALOGUE: Product[] = [
  { id: "p1", name: "Business Laptop", price: 500, keywords: ["laptop", "laptops", "computer", "computers"] },
  { id: "p2", name: "Microsoft 365 Setup", price: 80, keywords: ["microsoft 365", "microsoft setup", "m365", "office setup", "office 365"], perUser: true },
  { id: "p3", name: "Remote IT Support - 1 Year", price: 2000, keywords: ["remote it support", "remote support", "it support", "support"] },
  { id: "p4", name: "Website Setup", price: 1500, keywords: ["website setup", "website", "web setup"] },
  { id: "p5", name: "Cybersecurity Audit", price: 2500, keywords: ["cybersecurity", "security audit", "cyber audit"] },
];

const SAMPLES = [
  "15 laptops, Microsoft setup for 20 users, and remote IT support",
  "Hello, we need 15 laptops, Microsoft 365 setup for 15 users, and one year of remote IT support. Please send us a quotation.",
  "Hello, we need website setup and cybersecurity audit for our small company.",
];

const FAQS: FaqItem[] = [
  { q: "What exactly does BizAssist AI do?", a: "BizAssist reads a client request (an email, a brief, or a short description), detects which products or services are being asked for, calculates pricing in euros from your catalogue, and drafts a professional quotation with a ready-to-send email body. A human always reviews before anything reaches the client." },
  { q: "Is my data secure?", a: "Yes. By default your catalogue and quotation history live in your browser's local storage — nothing is sent to a server unless you choose the AI mode. When the AI mode is used, requests go through a secure backend route, and your OpenAI key never touches the frontend." },
  { q: "Do I need an OpenAI account to use it?", a: "No. The catalogue-based generator works completely offline and gives accurate, predictable results. The optional 'Generate with Real AI' mode requires a configured OpenAI key, but the app falls back gracefully if the key is missing, expired, or out of quota." },
  { q: "Can I customise the product catalogue?", a: "Absolutely. Edit any price inline from the admin section — changes apply instantly to new quotations. On Pro and Enterprise plans you can add new products and keywords without redeploying the app." },
  { q: "Will it send emails to clients automatically?", a: "No, and that's by design. BizAssist generates the draft, but a human reviews and sends from their own inbox. That keeps you in control of tone, accuracy, and compliance." },
  { q: "How accurate is the pricing?", a: "Pricing is calculated by exact math from your catalogue — no approximation. Quantities are extracted from natural language (\"15 laptops\", \"for 20 users\"). The system flags items it couldn't match so you can clarify with the client." },
];

const CHAT_INTRO = "Hi! 👋 I'm the BizAssist AI assistant. I can answer questions about features, pricing, security, or even help you generate a quick quotation right here. What would you like to know?";
const CHAT_SUGGESTIONS = ["How does it work?", "How much does it cost?", "Is my data secure?", "Show me a sample quotation"];

// =========================== HELPERS ===========================
function detectItems(text: string, catalogue: Product[]): QuoteItem[] {
  const lower = text.toLowerCase();
  const detected: QuoteItem[] = [];
  const used = new Set<string>();
  const forUsersMatch = lower.match(/for\s+(\d+)\s+users?/i);
  const usersCount = forUsersMatch ? parseInt(forUsersMatch[1], 10) : null;

  for (const product of catalogue) {
    const sortedKw = [...product.keywords].sort((a, b) => b.length - a.length);
    for (const kw of sortedKw) {
      const kwLower = kw.toLowerCase();
      if (used.has(kwLower)) continue;
      if (!lower.includes(kwLower)) continue;
      const esc = kwLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const beforeRe = new RegExp("(\\d+)\\s*" + esc, "i");
      const m = lower.match(beforeRe);
      let qty = 1;
      if (m) qty = parseInt(m[1], 10);
      else if (product.perUser && usersCount) qty = usersCount;
      detected.push({ productId: product.id, name: product.name, unitPrice: product.price, quantity: qty, subtotal: product.price * qty });
      used.add(kwLower);
      break;
    }
  }
  return detected;
}

function buildQuotationText(clientRequest: string, items: QuoteItem[], total: number, mode: string): string {
  const date = new Date().toLocaleDateString("en-GB");
  const id = "QT-" + Date.now().toString().slice(-6);
  const detected = items.length ? items.map((it) => `- ${it.name} × ${it.quantity}`).join("\n") : "- (no catalogue items matched — please clarify with client)";
  const lineItems = items.length ? items.map((it) => `  ${it.name} × ${it.quantity} @ €${it.unitPrice.toFixed(2)} = €${it.subtotal.toFixed(2)}`).join("\n") : "  (no line items)";
  return `BizAssist AI Solutions — Draft Quotation
Quotation: ${id}        Date: ${date}        Mode: ${mode}

Client Request Summary:
${clientRequest.trim() || "(empty request)"}

Detected Requirements:
${detected}

Estimated Quotation:
${lineItems}

Total Estimated Amount:
  €${total.toFixed(2)}

Delivery Timeline:
  2–4 weeks after order confirmation.

Terms:
  - Prices in EUR, excluding VAT.
  - Quotation valid for 30 days.
  - Payment terms: 50% advance, 50% on delivery.
  - Final pricing requires human review before sending.

Email Draft:
  Dear Customer,

  Thank you for your enquiry. Based on your request, please find our
  preliminary quotation above. We would be happy to refine the scope
  and confirm final pricing on a short call.

  Best regards,
  BizAssist AI Solutions

— This draft was generated by BizAssist AI (${mode} mode) and requires human review before sending. —`;
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString("en-GB");
}

function generateBotReply(userText: string): { text: string; suggestions: string[] } {
  const t = userText.toLowerCase();
  if (/^(hi|hello|hey|hola|bonjour|namaste)\b/i.test(userText)) return { text: "Hello! 👋 Great to meet you. I can answer questions about features, pricing, security, or help you generate a sample quotation. What sounds useful?", suggestions: ["How does it work?", "Show me pricing", "Generate a sample quotation"] };
  if (/how (does|do).*work|how (does|do) (it|this)|workflow|process/i.test(t)) return { text: "BizAssist works in four steps:\n\n1. You paste a client request (an email or short brief)\n2. The catalogue engine detects products and quantities\n3. It builds a structured quotation with line items and totals\n4. You review, export to PDF, and send from your own inbox\n\nThe whole loop takes about 5 seconds.", suggestions: ["Show me a sample quotation", "Is my data secure?", "What's the pricing?"] };
  if (/price|pricing|cost|how much|plan|subscription|free/i.test(t)) return { text: "Three plans:\n\n• Starter — Free. Catalogue engine, 20 quotations/month, PDF export\n• Pro — €29/user/month. Unlimited quotations, AI drafting, custom branding\n• Enterprise — Custom. SSO, integrations, dedicated support\n\nNo credit card required for Starter.", suggestions: ["What's in the Enterprise plan?", "Start free", "Talk to sales"] };
  if (/secur|privacy|data|gdpr|store|safe/i.test(t)) return { text: "Your data stays in your browser's local storage by default. Nothing is sent anywhere unless you use the AI mode, and even then your OpenAI key is kept on the server and never exposed to the frontend.", suggestions: ["What about the AI mode?", "Show me pricing"] };
  if (/ai|openai|gpt|api|model/i.test(t)) return { text: "Two modes:\n\n• Catalogue mode (always works) — keyword matching, instant math\n• AI mode (optional) — calls OpenAI through a secure backend route\n\nIf the AI key is missing or out of quota, the app falls back to catalogue mode automatically.", suggestions: ["Is my data secure?", "What's the pricing?"] };
  if (/sample|example|generate|quot|draft|demo/i.test(t)) return { text: "Sure! Here's a typical example:\n\nClient request: \"15 laptops, Microsoft 365 setup for 20 users, and remote IT support.\"\n\nBizAssist generates:\n• Business Laptop × 15 = €7,500\n• Microsoft 365 × 20 = €1,600\n• Remote IT Support × 1 = €2,000\n• Total: €11,100\n\nScroll up to the Generator section to try it.", suggestions: ["Open the generator", "How accurate is pricing?"] };
  if (/open (the )?generator|scroll|take me|go to/i.test(t)) { setTimeout(() => { document.getElementById("generator")?.scrollIntoView({ behavior: "smooth" }); }, 600); return { text: "Taking you to the generator now — try one of the sample chips!", suggestions: [] }; }
  if (/pdf|export|download|save/i.test(t)) return { text: "Every quotation can be exported to a branded PDF with one click. The PDF includes a navy header with the BizAssist logo, full line items, terms, and a 'requires human review' note.", suggestions: ["What's the pricing?", "Generate a sample"] };
  if (/catalog|product|item|edit/i.test(t)) return { text: "The catalogue lives in the admin section — every price is editable inline, changes apply instantly. Starter includes the 5 default products.", suggestions: ["Show me pricing", "How does it work?"] };
  if (/contact|sales|human|talk to|speak to|email|support/i.test(t)) return { text: "Happy to connect you with the team. Drop us a note at hello@bizassist.ai and we'll come back within one business day.", suggestions: ["Tell me about Enterprise", "What's the pricing?"] };
  if (/who|team|company|about|made|build/i.test(t)) return { text: "BizAssist AI Solutions is a small, focused team building practical AI tools for SMEs. We're a four-person crew: Karan, Srija, Nandini, and Vandana.", suggestions: ["How does it work?", "What's the pricing?"] };
  if (/thank|thanks|cheers|merci|gracias/i.test(t)) return { text: "You're welcome! 🎉 Anything else I can help with?", suggestions: ["Show me pricing", "How does it work?"] };
  if (/bye|goodbye|see you|later/i.test(t)) return { text: "Take care! Tap the chat icon anytime — I'm always here.", suggestions: [] };
  return { text: "Good question! I can help with: features, how it works, pricing, security, AI mode, PDF export, or even generating a sample quotation. Which would you like to explore?", suggestions: ["How does it work?", "Show me pricing", "Is my data secure?", "Generate a sample"] };
}

// =========================== ICONS (inline) ===========================
const Icon = {
  arrow: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>),
  close: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>),
  check: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{width: 16, height: 16}}><polyline points="20 6 9 17 4 12"/></svg>),
  cross: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{width: 16, height: 16}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>),
  chevron: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>),
  download: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>),
  copy: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>),
  chat: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: 26, height: 26}}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>),
  send: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width: 18, height: 18}}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>),
};

// =========================== MAIN COMPONENT ===========================
export default function Home() {
  // Core state
  const [clientRequest, setClientRequest] = useState("");
  const [outputText, setOutputText] = useState("");
  const [lastTotal, setLastTotal] = useState(0);
  const [alert, setAlert] = useState<{ kind: "info" | "warn" | "success"; msg: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [mode, setMode] = useState<"Rules" | "AI">("Rules");

  // Catalogue & history (start with defaults; hydrate from localStorage on mount)
  const [catalogue, setCatalogue] = useState<Product[]>(DEFAULT_CATALOGUE);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  // Login & modal (hydrate on mount)
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState("demo@bizassist.ai");
  const [loginPassword, setLoginPassword] = useState("demo123");

  // Toasts
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

  // FAQ
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSuggestions, setChatSuggestions] = useState<string[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatTyping, setChatTyping] = useState(false);
  const [unreadVisible, setUnreadVisible] = useState(true);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Weekly chart data (seeded)
  const [weekly, setWeekly] = useState([
    { day: "Mon", catalogue: 4200, ai: 0 },
    { day: "Tue", catalogue: 5800, ai: 1200 },
    { day: "Wed", catalogue: 3100, ai: 0 },
    { day: "Thu", catalogue: 7200, ai: 2400 },
    { day: "Fri", catalogue: 4800, ai: 0 },
    { day: "Sat", catalogue: 2200, ai: 800 },
    { day: "Today", catalogue: 0, ai: 0 },
  ]);

  // =========== HYDRATE FROM LOCALSTORAGE (client only) ===========
  // This is the standard Next.js pattern for reading localStorage on mount
  // to avoid SSR hydration mismatches. The strict React rule fires here
  // but this is the documented, intended approach.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const savedCat = window.localStorage.getItem("bz_catalogue");
      const savedHist = window.localStorage.getItem("bz_history");
      const savedLogin = window.localStorage.getItem("bz_login");
      if (savedCat) setCatalogue(JSON.parse(savedCat));
      if (savedHist) setHistory(JSON.parse(savedHist));
      if (savedLogin) {
        const p = JSON.parse(savedLogin);
        if (p?.email) { setIsLoggedIn(true); setUserEmail(p.email); }
      }
    } catch {}
    // Seed activity feed once after mount so timestamps line up with current time
    const now = Date.now();
    setActivity([
      { id: "s1", type: "quote", title: "Quotation generated", desc: "Acme Corp · 3 items · €11,100", iconClass: "ac-green", time: new Date(now - 1000 * 60 * 4).toISOString() },
      { id: "s2", type: "pdf", title: "PDF exported", desc: "BizAssist-Quotation-Acme.pdf", iconClass: "ac-amber", time: new Date(now - 1000 * 60 * 12).toISOString() },
      { id: "s3", type: "ai", title: "AI draft generated", desc: "Veridian Ltd · €4,000", iconClass: "ac-violet", time: new Date(now - 1000 * 60 * 38).toISOString() },
      { id: "s4", type: "quote", title: "Quotation generated", desc: "BlueWave SARL · €10,700", iconClass: "ac-green", time: new Date(now - 1000 * 60 * 90).toISOString() },
    ]);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // =========== ACTIVITY TIME REFRESH ===========
  useEffect(() => {
    const t = setInterval(() => setActivity((a) => [...a]), 30000);
    return () => clearInterval(t);
  }, []);

  // Persist catalogue & history whenever they change
  useEffect(() => {
    try { window.localStorage.setItem("bz_catalogue", JSON.stringify(catalogue)); } catch {}
  }, [catalogue]);
  useEffect(() => {
    try { window.localStorage.setItem("bz_history", JSON.stringify(history)); } catch {}
  }, [history]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages, chatTyping]);

  // ESC closes modals
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setLoginOpen(false); setChatOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // =========== TOAST HELPER ===========
  const toast = (title: string, msg: string, kind: "success" | "info" = "success") => {
    toastIdRef.current += 1;
    const id = "t" + toastIdRef.current;
    setToasts((arr) => [...arr, { id, title, msg, kind }]);
    setTimeout(() => setToasts((arr) => arr.filter((t) => t.id !== id)), 3200);
  };

  // =========== ACTIVITY ===========
  const activityIdRef = useRef(0);
  const pushActivity = (type: ActivityEntry["type"], title: string, desc: string, iconClass: string) => {
    activityIdRef.current += 1;
    setActivity((a) => [{ id: "a" + activityIdRef.current, type, title, desc, iconClass, time: new Date().toISOString() }, ...a].slice(0, 12));
  };

  // =========== LOGIN ===========
  const openLogin = () => setLoginOpen(true);
  const submitLogin = () => {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      toast("Missing details", "Enter both email and password.", "info");
      return;
    }
    setIsLoggedIn(true);
    setUserEmail(loginEmail.trim());
    localStorage.setItem("bz_login", JSON.stringify({ email: loginEmail.trim() }));
    setLoginOpen(false);
    toast("Signed in", `Welcome back, ${loginEmail.split("@")[0]}!`);
    pushActivity("login", "Signed in", loginEmail.trim(), "ac-blue");
  };
  const signOut = () => {
    setIsLoggedIn(false);
    setUserEmail("");
    localStorage.removeItem("bz_login");
    toast("Signed out", "You've been logged out.", "info");
  };

  // =========== GENERATOR ===========
  const applySample = (i: number) => setClientRequest(SAMPLES[i] || "");
  const clearInput = () => setClientRequest("");

  const generateCatalogue = () => {
    if (!clientRequest.trim()) { setAlert({ kind: "warn", msg: "Paste a client request first or pick a sample." }); return; }
    const items = detectItems(clientRequest, catalogue);
    const total = items.reduce((s, it) => s + it.subtotal, 0);
    const text = buildQuotationText(clientRequest, items, total, "Catalogue");
    setOutputText(text); setLastTotal(total); setMode("Rules");
    saveHistory(items, total, text, "catalogue");
    setWeekly((w) => { const nw = [...w]; nw[6] = { ...nw[6], catalogue: nw[6].catalogue + total }; return nw; });
    if (items.length === 0) setAlert({ kind: "warn", msg: "No catalogue keywords matched. Try '15 laptops' or 'Microsoft 365 setup for 20 users'." });
    else { setAlert({ kind: "success", msg: `Detected ${items.length} item${items.length > 1 ? "s" : ""}. Total: €${total.toFixed(2)}. Review before sending.` }); pushActivity("quote", "Quotation generated", `${items.length} items · €${total.toLocaleString("en-GB")}`, "ac-green"); }
  };

  const generateAI = async () => {
    if (!clientRequest.trim()) { setAlert({ kind: "warn", msg: "Paste a client request first or pick a sample." }); return; }
    setAiLoading(true);
    setAlert({ kind: "info", msg: "Calling AI…" });
    try {
      const res = await fetch("/api/generate-quotation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequest }),
      });
      const data = await res.json();
      // New API always returns ok:true with either source=openai or source=fallback
      if (data.ok && data.quotation) {
        const items = detectItems(clientRequest, catalogue);
        const total = items.reduce((s, it) => s + it.subtotal, 0);
        const text = data.quotation as string;
        setOutputText(text);
        setLastTotal(total || 0);
        setMode("AI");
        if (data.source === "openai") {
          saveHistory(items, total, text, "ai");
          setWeekly((w) => { const nw = [...w]; nw[6] = { ...nw[6], ai: nw[6].ai + total }; return nw; });
          setAlert({ kind: "success", msg: `AI quotation generated by ${data.model || "OpenAI"}.` });
          pushActivity("ai", "AI draft generated", `${data.model || "OpenAI"} · €${total.toLocaleString("en-GB")}`, "ac-violet");
        } else {
          saveHistory(items, total, text, "ai-fallback");
          setWeekly((w) => { const nw = [...w]; nw[6] = { ...nw[6], ai: nw[6].ai + total }; return nw; });
          setAlert({ kind: "info", msg: data.reason || "AI fallback used. Configure OPENAI_API_KEY for real GPT output." });
          pushActivity("ai", "AI fallback used", `€${total.toLocaleString("en-GB")}`, "ac-violet");
        }
      } else {
        setAlert({ kind: "warn", msg: data.error || "Could not generate. Try the catalogue button." });
      }
    } catch {
      setAlert({ kind: "warn", msg: "Network error. Falling back to catalogue mode." });
      generateCatalogue();
    } finally {
      setAiLoading(false);
    }
  };

  const historyIdRef = useRef(0);
  const saveHistory = (items: QuoteItem[], total: number, text: string, source: HistoryEntry["source"]) => {
    historyIdRef.current += 1;
    setHistory((h) => [{ id: "h" + historyIdRef.current, createdAt: new Date().toISOString(), snippet: clientRequest.slice(0, 80), items, total, text, source }, ...h].slice(0, 20));
  };

  const copyOutput = () => {
    if (!outputText) { setAlert({ kind: "warn", msg: "Nothing to copy. Generate first." }); return; }
    navigator.clipboard.writeText(outputText).then(() => { toast("Copied", "Quotation copied to clipboard."); setAlert({ kind: "success", msg: "Quotation copied to clipboard." }); }).catch(() => setAlert({ kind: "warn", msg: "Couldn't copy. Select and copy manually." }));
  };

  const resetOutput = () => { setOutputText(""); setLastTotal(0); setAlert(null); };

  const downloadPdf = () => {
    if (!outputText) { setAlert({ kind: "warn", msg: "Generate a quotation first." }); return; }
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 48; let y = margin;
    doc.setFillColor(10, 15, 44); doc.rect(0, 0, doc.internal.pageSize.getWidth(), 70, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(20);
    doc.text("BizAssist AI Solutions", margin, 36);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(150, 180, 220);
    doc.text("Busy Business? Let BizAssist Handle It.", margin, 54);
    y = 100; doc.setTextColor(20, 30, 50); doc.setFont("helvetica", "normal"); doc.setFontSize(11);
    const lines = doc.splitTextToSize(outputText, doc.internal.pageSize.getWidth() - margin * 2);
    lines.forEach((line: string) => { if (y > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; } doc.text(line, margin, y); y += 14; });
    doc.setFontSize(9); doc.setTextColor(120, 130, 150);
    doc.text("Generated by BizAssist AI · Requires human review before sending.", margin, doc.internal.pageSize.getHeight() - 24);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    doc.save(`BizAssist-Quotation-${stamp}.pdf`);
    toast("PDF downloaded", "Check your downloads folder.");
    pushActivity("pdf", "PDF exported", `€${lastTotal.toLocaleString("en-GB")} quotation`, "ac-amber");
  };

  // =========== CATALOGUE ===========
  const updatePrice = (id: string, val: string) => {
    const n = parseFloat(val); if (isNaN(n) || n < 0) return;
    setCatalogue((c) => c.map((p) => p.id === id ? { ...p, price: n } : p));
    const p = catalogue.find((x) => x.id === id); if (p) toast("Price updated", `${p.name} → €${n.toFixed(2)}`);
  };
  const resetCatalogue = () => { setCatalogue(DEFAULT_CATALOGUE); toast("Catalogue reset", "All prices restored to defaults."); };

  // =========== HISTORY ===========
  const loadHistory = (id: string) => {
    const h = history.find((x) => x.id === id); if (!h) return;
    setClientRequest(h.snippet); setOutputText(h.text); setLastTotal(h.total);
    setAlert({ kind: "info", msg: "History entry loaded." });
    document.getElementById("generator")?.scrollIntoView({ behavior: "smooth" });
  };
  const clearHistory = () => { setHistory([]); toast("History cleared", "All saved drafts removed.", "info"); };

  // =========== CHATBOT ===========
  const openChat = (prefill = "") => {
    setChatOpen(true); setUnreadVisible(false);
    if (chatMessages.length === 0) {
      setChatMessages([{ role: "bot", text: CHAT_INTRO }]);
      setChatSuggestions(CHAT_SUGGESTIONS);
    }
    if (prefill.trim()) { setChatInput(prefill); setTimeout(() => sendChat(prefill), 300); }
  };
  const closeChat = () => setChatOpen(false);

  const sendChat = (forceText?: string) => {
    const text = (forceText ?? chatInput).trim();
    if (!text || chatTyping) return;
    setChatMessages((m) => [...m, { role: "user", text }]);
    setChatInput("");
    setChatSuggestions([]);
    setChatTyping(true);
    setTimeout(() => {
      const reply = generateBotReply(text);
      setChatTyping(false);
      setChatMessages((m) => [...m, { role: "bot", text: reply.text }]);
      setChatSuggestions(reply.suggestions);
    }, 700 + Math.random() * 500);
  };

  // =========================== RENDER ===========================
  const totalQuotationValue = history.reduce((s, h) => s + h.total, 0);
  const maxChart = Math.max(...weekly.map((d) => d.catalogue + d.ai), 5000);

  return (
    <div>
      <style>{styles}</style>

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "info" ? "info" : ""}`}>
            <span style={{ fontWeight: 700, fontSize: 18 }}>{t.kind === "info" ? "ℹ" : "✓"}</span>
            <div><div className="toast-title">{t.title}</div><div className="toast-msg">{t.msg}</div></div>
          </div>
        ))}
      </div>

      {/* Login Modal */}
      {loginOpen && (
        <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) setLoginOpen(false); }}>
          <div className="modal">
            <button className="modal-close" onClick={() => setLoginOpen(false)} aria-label="Close"><Icon.close /></button>
            <div className="modal-logo"><Image src="/bizassist-logo.svg" alt="BizAssist" width={56} height={56} priority /></div>
            <h3>Welcome back</h3>
            <p className="modal-sub">Sign in to BizAssist AI</p>
            <div className="form-field">
              <label className="field-label">Work email</label>
              <input className="input" type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
            </div>
            <div className="form-field">
              <label className="field-label">Password</label>
              <input className="input" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitLogin()} />
            </div>
            <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 6 }} onClick={submitLogin}>Sign in to dashboard</button>
            <div className="demo-hint"><strong>Demo account</strong> · Any email / password works · No real authentication</div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <nav className="navbar">
        <div className="nav-inner">
          <a href="#top" className="brand">
            <Image src="/bizassist-logo.svg" alt="BizAssist" width={44} height={44} className="brand-logo" priority />
            <div className="brand-text">
              <span className="brand-name">BizAssist AI</span>
              <span className="brand-slogan">Busy Business? Let BizAssist Handle It.</span>
            </div>
          </a>
          <div className="nav-links">
            <a className="nav-link" href="#features">Features</a>
            <a className="nav-link" href="#workflow">Workflow</a>
            <a className="nav-link" href="#dashboard">Dashboard</a>
            <a className="nav-link" href="#generator">Generator</a>
            <a className="nav-link" href="#pricing">Pricing</a>
            <a className="nav-link" href="#faq">FAQ</a>
          </div>
          <div className="nav-cta">
            {isLoggedIn ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", padding: "4px 10px 4px 4px", borderRadius: 100 }}>
                  <div className="user-avatar-sm">{userEmail.slice(0, 2).toUpperCase()}</div>
                  <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 500 }}>{userEmail.split("@")[0]}</span>
                </div>
                <button className="btn btn-ghost-light btn-sm" onClick={signOut}>Sign out</button>
              </>
            ) : (
              <>
                <button className="btn btn-ghost-light btn-sm" onClick={openLogin}>Demo Login</button>
                <a href="#generator" className="btn btn-primary btn-sm">Try It Now <Icon.arrow /></a>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header className="hero" id="top">
        <div className="hero-grid-bg" />
        <div className="hero-blob b1" />
        <div className="hero-blob b2" />
        <div className="hero-inner">
          <div>
            <h1>Busy business? <br /><span className="accent">Let BizAssist handle it.</span></h1>
            <p>Paste a client email. Get a polished quotation in seconds. BizAssist reads the request, detects products, calculates pricing in euros, and drafts a professional reply — ready for human review before it ever reaches your customer.</p>
            <div className="hero-ctas">
              <a href="#generator" className="btn btn-primary">Generate a quotation <Icon.arrow /></a>
              <a href="#workflow" className="btn btn-ghost-light">See how it works</a>
            </div>
            <div className="hero-stats">
              <div><div className="stat-value">~5s</div><div className="stat-label">Avg. draft time</div></div>
              <div><div className="stat-value">{catalogue.length}</div><div className="stat-label">Catalogue items</div></div>
              <div><div className="stat-value">€</div><div className="stat-label">Euro pricing</div></div>
              <div><div className="stat-value">100%</div><div className="stat-label">Human reviewed</div></div>
            </div>
          </div>
          <div className="hero-preview">
            <div className="preview-window">
              <div className="preview-toolbar">
                <span className="preview-dot r" /><span className="preview-dot y" /><span className="preview-dot g" />
                <span className="preview-url">bizassist-ai.app/generator</span>
              </div>
              <div className="preview-body">
                <div className="preview-label">Client request</div>
                <div className="preview-input-box">&quot;We need <span className="hl">15 laptops</span>, <span className="hl-c">Microsoft 365 setup for 20 users</span>, and <span className="hl-g">one year of remote IT support</span>.&quot;</div>
                <div className="preview-arrow">↓</div>
                <div className="preview-label" style={{ marginBottom: 6 }}>Quotation generated</div>
                <div className="preview-items">
                  <div className="preview-item-row"><span className="name">Business Laptop × 15</span><span className="price">€7,500</span></div>
                  <div className="preview-item-row"><span className="name">Microsoft 365 × 20</span><span className="price">€1,600</span></div>
                  <div className="preview-item-row"><span className="name">Remote IT Support × 1</span><span className="price">€2,000</span></div>
                  <div className="preview-total-row"><span className="label">Total estimate</span><span className="amount">€11,100</span></div>
                </div>
                <div className="preview-status"><span className="live-dot" />Ready · pending human review</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* FEATURES */}
      <section id="features">
        <div className="container">
          <span className="section-eyebrow">What it does</span>
          <h2 className="section-title">Quotations that used to take 20 minutes, now ready in five seconds.</h2>
          <p className="section-lead">BizAssist combines a rules-based catalogue with optional AI generation, so you get fast, reliable drafts even when your network is down or your OpenAI quota is exhausted.</p>
          <div className="feature-grid">
            {[
              { ic: "ic-blue", title: "Smart request parsing", desc: "Paste any client email. BizAssist extracts product mentions, user counts, and quantities automatically.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg> },
              { ic: "ic-cyan", title: "Instant pricing", desc: "Catalogue-based math in euros. Microsoft 365 per user, laptops per unit, support per year — no manual lookup.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="12" y1="10" x2="14" y2="10"/><line x1="16" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="12" y1="14" x2="14" y2="14"/><line x1="16" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="10" y2="18"/><line x1="12" y1="18" x2="14" y2="18"/><line x1="16" y1="18" x2="16" y2="18"/></svg> },
              { ic: "ic-green", title: "Optional AI assist", desc: "Plug in your OpenAI key and let GPT write the full email draft. Falls back gracefully if the key is missing.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/><circle cx="12" cy="12" r="4"/></svg> },
              { ic: "ic-amber", title: "PDF export", desc: "Download client-ready PDFs in one click. Branded header, structured line items, terms, and human-review note.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg> },
              { ic: "ic-violet", title: "Quotation history", desc: "Every draft is saved locally so your sales team can revisit, re-export, or refine without retyping.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
              { ic: "ic-pink", title: "Editable catalogue", desc: "Update prices on the fly. Add new keywords. The whole engine adapts without redeploying the app.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
            ].map((f, i) => (
              <div className="feature-card" key={i}>
                <div className={`feature-icon ${f.ic}`}>{f.icon}</div>
                <h3>{f.title}</h3><p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WORKFLOW */}
      <section className="section-dark" id="workflow">
        <div className="container">
          <span className="section-eyebrow" style={{ color: "var(--cyan-300)" }}>How it works</span>
          <h2 className="section-title">Four steps from email to PDF.</h2>
          <p className="section-lead">A deliberately simple pipeline. Each step is auditable. Nothing is sent to a customer without a human approving it first.</p>
          <div className="workflow-grid">
            {[
              { step: "Step 01", title: "Paste the request", desc: "Drop in the client email or describe the requirement in plain language." },
              { step: "Step 02", title: "Detect & calculate", desc: "BizAssist matches keywords against the catalogue and extracts quantities." },
              { step: "Step 03", title: "Draft the quotation", desc: "A structured response is generated with line items, totals, and email body." },
              { step: "Step 04", title: "Review, export, send", desc: "Approve, download as PDF, and send from your real inbox — always reviewed by a human." },
            ].map((w, i) => (
              <div className="workflow-step" key={i}>
                <div className="num">{w.step}</div>
                <h3>{w.title}</h3>
                <p>{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DASHBOARD */}
      <section className="section-tint" id="dashboard">
        <div className="container">
          <span className="section-eyebrow">At a glance</span>
          <h2 className="section-title">Your sales pulse, on one screen.</h2>
          <p className="section-lead">Live counters and recent activity powered by your quotation history. No external database needed — your data stays on your device.</p>
          <div className="dash-grid">
            <div className="dash-card"><div className="label">Quotations drafted</div><div className="value">{history.length}</div><div className="delta delta-up">{history.length ? "Last update just now" : "Ready to go"}</div></div>
            <div className="dash-card"><div className="label">Total value (€)</div><div className="value">€{totalQuotationValue.toLocaleString("en-GB", { maximumFractionDigits: 0 })}</div><div className="delta delta-flat">Cumulative</div></div>
            <div className="dash-card"><div className="label">Catalogue products</div><div className="value">{catalogue.length}</div><div className="delta delta-flat">Editable below</div></div>
            <div className="dash-card"><div className="label">AI mode</div><div className="value" style={{ fontSize: 22 }}>{mode}</div><div className="delta delta-flat">Toggle in generator</div></div>
          </div>
          <div className="dash-split">
            <div className="chart-card">
              <div className="chart-head">
                <div><h3>Quotations this week</h3><div className="sub">Last 7 days · €</div></div>
                <div className="chart-legend">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span className="legend-dot" style={{ background: "#3b82f6" }} />Catalogue</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span className="legend-dot" style={{ background: "#a78bfa" }} />AI mode</span>
                </div>
              </div>
              <ChartSvg data={weekly} maxValue={maxChart} />
            </div>
            <div className="activity-card">
              <div className="activity-head"><div><h3>Recent activity</h3><div className="sub">Live feed</div></div></div>
              <div className="activity-list">
                {activity.length === 0 ? <div style={{ textAlign: "center", color: "var(--slate-400)", fontSize: 13, padding: 20 }}>No activity yet.</div> :
                  activity.map((a) => (
                    <div className="activity-item" key={a.id}>
                      <div className={`activity-icon ${a.iconClass}`}><ActivityIcon type={a.type} /></div>
                      <div className="activity-body">
                        <div className="activity-title"><span>{a.title}</span><span className="activity-time">{timeAgo(a.time)}</span></div>
                        <div className="activity-desc">{a.desc}</div>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* GENERATOR */}
      <section id="generator">
        <div className="container">
          <span className="section-eyebrow">Live tool</span>
          <h2 className="section-title">Generate a quotation.</h2>
          <p className="section-lead">Paste any client request — try a sample to get going. The catalogue engine works offline. The AI button calls your backend route (uses OpenAI when configured).</p>
          <div className="gen-card">
            <div className="gen-header">
              <div><h3>BizAssist Quotation Studio</h3><div className="sub">Catalogue-based · AI-assisted · Human-reviewed</div></div>
              <div>
                {isLoggedIn ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div className="user-avatar-sm">{userEmail.slice(0, 2).toUpperCase()}</div>
                    <div style={{ lineHeight: 1.1 }}>
                      <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{userEmail.split("@")[0]}</div>
                      <div style={{ color: "var(--slate-300)", fontSize: 11 }}>{userEmail} · signed in</div>
                    </div>
                  </div>
                ) : (
                  <button className="btn btn-ghost-light btn-sm" onClick={openLogin}>Sign in for personalised drafts</button>
                )}
              </div>
            </div>
            <div className="gen-body">
              <div>
                <label className="field-label">Client request</label>
                <textarea className="textarea" value={clientRequest} onChange={(e) => setClientRequest(e.target.value)} placeholder="Example: Hello, we need 15 laptops, Microsoft 365 setup for 20 users, and one year of remote IT support. Please send us a quotation." />
                <div className="chip-row">
                  {SAMPLES.map((_, i) => (<span key={i} className="chip" onClick={() => applySample(i)}>Sample {i + 1}</span>))}
                </div>
                <div className="button-row">
                  <button className="btn btn-primary" onClick={generateCatalogue}>Generate Quotation</button>
                  <button className="btn btn-violet" onClick={generateAI} disabled={aiLoading}>{aiLoading ? "Generating…" : "Generate with Real AI"}</button>
                  <button className="btn btn-outline btn-sm" onClick={clearInput}>Clear</button>
                </div>
              </div>
              <div>
                <label className="field-label">Quotation draft</label>
                {alert && <div className={`alert ${alert.kind === "warn" ? "alert-warn" : alert.kind === "success" ? "alert-success" : "alert-info"}`}><span style={{ fontWeight: 700 }}>{alert.kind === "warn" ? "⚠️" : alert.kind === "success" ? "✓" : "ℹ"}</span><span>{alert.msg}</span></div>}
                <div className={`output-panel ${!outputText ? "empty" : ""}`}>{outputText || "Your quotation draft will appear here once generated."}</div>
                <div className="output-actions">
                  <button className="btn btn-success btn-sm" onClick={downloadPdf}><Icon.download />Download PDF</button>
                  <button className="btn btn-secondary btn-sm" onClick={copyOutput}><Icon.copy />Copy</button>
                  <button className="btn btn-outline btn-sm" onClick={resetOutput}>Reset</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ADMIN */}
      <section className="section-tint" id="admin">
        <div className="container">
          <span className="section-eyebrow">Admin</span>
          <h2 className="section-title">Manage your catalogue and history.</h2>
          <p className="section-lead">Edit prices inline — changes apply instantly to new quotations. Browse, re-export, or clear your saved drafts.</p>
          <div className="two-col">
            <div className="panel">
              <div className="panel-header">
                <div><h3>Product catalogue</h3><div style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 2 }}>Click any price to edit</div></div>
                <button className="btn btn-outline btn-sm" onClick={resetCatalogue}>Reset</button>
              </div>
              <div className="panel-body">
                {catalogue.map((p) => (
                  <div className="cat-row" key={p.id}>
                    <div>
                      <div className="cat-name">{p.name}</div>
                      <div className="cat-keywords">Keywords: {p.keywords.slice(0, 4).join(", ")}{p.keywords.length > 4 ? "…" : ""}</div>
                    </div>
                    <input type="number" className="cat-price-input" value={p.price} onChange={(e) => updatePrice(p.id, e.target.value)} />
                    <span style={{ fontSize: 12, color: "var(--slate-500)", textAlign: "right" }}>{p.perUser ? "per user" : "per unit"}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel">
              <div className="panel-header">
                <div><h3>Quotation history</h3><div style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 2 }}>{history.length ? `${history.length} draft${history.length > 1 ? "s" : ""} saved` : "No drafts yet"}</div></div>
                <button className="btn btn-outline btn-sm" onClick={clearHistory}>Clear all</button>
              </div>
              <div className="panel-body">
                {history.length === 0 ? <div className="empty-state">Generate a quotation above to see your history here.</div> :
                  history.map((h, index) => (
  <div className="hist-row" key={`${h.id}-${index}`}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="hist-meta">{new Date(h.createdAt).toLocaleString("en-GB")} · {h.source}</div>
                        <div className="hist-snippet" title={h.snippet}>{h.snippet || "(empty)"}</div>
                      </div>
                      <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                        <span className="hist-total">€{h.total.toFixed(2)}</span>
                        <button className="btn btn-outline btn-sm" onClick={() => loadHistory(h.id)}>Load</button>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* USE CASES */}
      <section className="section-dark" id="usecases">
        <div className="container">
          <span className="section-eyebrow" style={{ color: "var(--cyan-300)" }}>Who it&apos;s for</span>
          <h2 className="section-title">Built for businesses that quote daily.</h2>
          <p className="section-lead">If your team writes proposals, estimates, or quotations on repeat, BizAssist cuts the busywork without taking humans out of the loop.</p>
          <div className="usecase-grid">
            {[
              { title: "IT service providers", desc: "Quote laptops, software setups, support contracts, and audits without rebuilding the spreadsheet every time.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> },
              { title: "Marketing agencies", desc: "Turn briefs into branded proposals: campaigns, retainer scopes, deliverables. Keep your tone, automate the math.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> },
              { title: "Freelancers & consultants", desc: "Spend more time on the work, less on writing the same scope-and-price email for the tenth time this month.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg> },
              { title: "Local SMEs", desc: "Renovation, equipment supply, training — anywhere a small business needs to send tidy estimates fast.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
              { title: "Sales teams", desc: "Reduce response time from hours to seconds. First draft ready before the lead finishes their coffee.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
              { title: "Compliance-conscious teams", desc: "Human-review-required by design. Audit log of every draft. Nothing leaves the app without sign-off.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
            ].map((u, i) => (
              <div className="usecase-card" key={i}>
                <div className="usecase-icon">{u.icon}</div>
                <h3>{u.title}</h3><p>{u.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing">
        <div className="container">
          <span className="section-eyebrow">Pricing</span>
          <h2 className="section-title">Simple plans. No hidden fees.</h2>
          <p className="section-lead">Start free for the demo, upgrade when your team is ready. All plans include catalogue editing, PDF export, and quotation history.</p>
          <div className="pricing-grid">
            <PriceCard tier="Starter" name="Free" tagline="Perfect for solo founders and demos." amount="€0" per="/ month" features={[
              { text: "Catalogue-based generator", on: true },
              { text: "Up to 20 quotations / month", on: true },
              { text: "PDF export", on: true },
              { text: "Local quotation history", on: true },
              { text: "No AI drafting", on: false },
              { text: "No team collaboration", on: false },
            ]} ctaLabel="Get started free" ctaVariant="outline" onCta={openLogin} />
            <PriceCard tier="Pro" name="Pro" tagline="For growing SMEs that quote daily." amount="€29" per="/ user / month" featured features={[
              { text: "Everything in Starter", on: true },
              { text: "Unlimited quotations", on: true },
              { text: "GPT-powered AI drafting", on: true },
              { text: "Custom branding on PDFs", on: true },
              { text: "Up to 10 catalogue products", on: true },
              { text: "Email & chat support", on: true },
            ]} ctaLabel="Start 14-day trial" ctaVariant="primary" onCta={openLogin} />
            <PriceCard tier="Enterprise" name="Custom" tagline="For larger teams with custom needs." amount="Let's talk" features={[
              { text: "Everything in Pro", on: true },
              { text: "Unlimited catalogue products", on: true },
              { text: "SSO & role-based access", on: true },
              { text: "CRM & email integrations", on: true },
              { text: "Custom AI prompts & tuning", on: true },
              { text: "Dedicated success manager", on: true },
            ]} ctaLabel="Contact sales" ctaVariant="outline" onCta={() => openChat("I would like to talk to sales about an Enterprise plan.")} />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="section-tint" id="faq">
        <div className="container-sm">
          <span className="section-eyebrow">Questions</span>
          <h2 className="section-title">Everything you need to know.</h2>
          <p className="section-lead">Still have questions? Tap the chat icon in the corner — our AI assistant is here 24/7.</p>
          <div className="faq-list">
            {FAQS.map((f, i) => (
              <div className={`faq-item ${openFaq === i ? "open" : ""}`} key={i}>
                <button className="faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  <span>{f.q}</span>
                  <span className="chevron"><Icon.chevron /></span>
                </button>
                <div className="faq-a">{f.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section style={{ paddingBottom: 0 }}>
        <div className="container">
          <div className="cta-banner">
            <h2>Ready to <span className="accent">stop retyping</span> the same quotation?</h2>
            <p>Try the live generator above, sign in for the demo, or chat with our AI assistant — no credit card, no setup.</p>
            <div className="cta-banner-ctas">
              <a href="#generator" className="btn btn-primary">Try the generator <Icon.arrow /></a>
              <button className="btn btn-ghost-light" onClick={() => openChat("")}>Chat with AI assistant</button>
            </div>
          </div>
        </div>
      </section>

      {/* TEAM */}
      <section id="team">
        <div className="container">
          <span className="section-eyebrow">Built by</span>
          <h2 className="section-title">The BizAssist team.</h2>
          <p className="section-lead">The people behind BizAssist AI Solutions.</p>
          <div className="team-grid">
            <div className="team-card"><div className="avatar av-1">KA</div><div className="team-name">Karan</div><div className="team-role">Team member</div></div>
            <div className="team-card"><div className="avatar av-2">SR</div><div className="team-name">Srija</div><div className="team-role">Team member</div></div>
            <div className="team-card"><div className="avatar av-3">NA</div><div className="team-name">Nandini</div><div className="team-role">Team member</div></div>
            <div className="team-card"><div className="avatar av-4">VA</div><div className="team-name">Vandana</div><div className="team-role">Team member</div></div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="footer-top">
          <div>
            <a href="#top" className="brand">
              <Image src="/bizassist-logo.svg" alt="BizAssist" width={44} height={44} className="brand-logo" />
              <div className="brand-text">
                <span className="brand-name">BizAssist AI</span>
                <span className="brand-slogan">Busy Business? Let BizAssist Handle It.</span>
              </div>
            </a>
            <p style={{ marginTop: 16 }}>An AI assistant that helps small and medium-sized businesses generate professional quotations in seconds — never sending anything to a client without a human in the loop.</p>
          </div>
          <div><h4>Product</h4><ul><li><a href="#features">Features</a></li><li><a href="#workflow">Workflow</a></li><li><a href="#generator">Generator</a></li><li><a href="#admin">Admin</a></li></ul></div>
          <div><h4>Company</h4><ul><li><a href="#usecases">Use cases</a></li><li><a href="#pricing">Pricing</a></li><li><a href="#team">Team</a></li></ul></div>
          <div><h4>Support</h4><ul><li><a href="#faq">FAQ</a></li><li><a href="#" onClick={(e) => { e.preventDefault(); openChat(""); }}>Chat with AI</a></li><li><a href="#" onClick={(e) => { e.preventDefault(); openChat("I want to contact sales."); }}>Contact sales</a></li></ul></div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 BizAssist AI Solutions · All rights reserved</span>
          <span>Made with ♥ in Europe</span>
        </div>
        <div className="trademark">Academic project — BizAssist AI Solutions and the BA mark are used for educational purposes only. Not affiliated with Microsoft, OpenAI, or any third party referenced.</div>
      </footer>

      {/* CHATBOT LAUNCHER */}
      {!chatOpen && (
        <button className="chat-launcher" onClick={() => openChat("")} aria-label="Open chat">
          <Icon.chat />
          {unreadVisible && <span className="unread-dot">1</span>}
        </button>
      )}

      {/* CHAT PANEL */}
      {chatOpen && (
        <div className="chat-panel open">
          <div className="chat-header">
            <div className="chat-bot-avatar">BA</div>
            <div className="chat-header-text">
              <div className="chat-header-name">BizAssist AI</div>
              <div className="chat-header-status">Online · usually replies instantly</div>
            </div>
            <button className="chat-close-btn" onClick={closeChat} aria-label="Close"><Icon.close /></button>
          </div>
          <div className="chat-messages" ref={chatScrollRef}>
            {chatMessages.map((m, i) => (
              <div className={`chat-msg ${m.role}`} key={i}>
                <div className="chat-msg-avatar">{m.role === "bot" ? "BA" : "U"}</div>
                <div className="chat-msg-bubble">{m.text}</div>
              </div>
            ))}
            {chatTyping && <div className="chat-typing"><span /><span /><span /></div>}
          </div>
          {chatSuggestions.length > 0 && (
            <div className="chat-suggestions">
              {chatSuggestions.map((s, i) => (
                <button key={i} className="chat-suggestion" onClick={() => sendChat(s)}>{s}</button>
              ))}
            </div>
          )}
          <div className="chat-input-row">
            <textarea className="chat-input" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Ask me anything..." rows={1}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }} />
            <button className="chat-send" onClick={() => sendChat()} aria-label="Send" disabled={!chatInput.trim() || chatTyping}><Icon.send /></button>
          </div>
          <div className="chat-footer">Powered by BizAssist AI · Responses for demo purposes</div>
        </div>
      )}
    </div>
  );
}

// =========================== SUB COMPONENTS ===========================
function PriceCard({ tier, name, tagline, amount, per, features, featured, ctaLabel, ctaVariant, onCta }: {
  tier: string; name: string; tagline: string; amount: string; per?: string;
  features: { text: string; on: boolean }[]; featured?: boolean;
  ctaLabel: string; ctaVariant: "primary" | "outline"; onCta: () => void;
}) {
  return (
    <div className={`price-card ${featured ? "featured" : ""}`}>
      {featured && <span className="price-badge">Most popular</span>}
      <div className="price-tier">{tier}</div>
      <h3>{name}</h3>
      <p className="price-tagline">{tagline}</p>
      <div className="price-amount"><span className="num">{amount}</span>{per && <span className="per">{per}</span>}</div>
      <ul className="price-features">
        {features.map((f, i) => (
          <li key={i} className={f.on ? "" : "muted"}>
            {f.on ? <Icon.check /> : <Icon.cross />}
            {f.text}
          </li>
        ))}
      </ul>
      <button className={`btn btn-${ctaVariant} price-cta`} onClick={onCta}>{ctaLabel}</button>
    </div>
  );
}

function ChartSvg({ data, maxValue }: { data: { day: string; catalogue: number; ai: number }[]; maxValue: number }) {
  const w = 480, h = 200, padding = { top: 16, right: 8, bottom: 30, left: 44 };
  const innerW = w - padding.left - padding.right;
  const innerH = h - padding.top - padding.bottom;
  const barWidth = innerW / data.length * 0.62;
  const gap = innerW / data.length;
  const yTicks = [0, maxValue * 0.25, maxValue * 0.5, maxValue * 0.75, maxValue];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: "block" }}>
      {yTicks.map((v, i) => {
        const yp = padding.top + innerH - (v / maxValue) * innerH;
        return (
          <g key={i}>
            <line x1={padding.left} y1={yp} x2={w - padding.right} y2={yp} stroke="#e2e8f0" strokeWidth={1} strokeDasharray={i === 0 ? undefined : "2 4"} />
            <text x={padding.left - 8} y={yp + 4} textAnchor="end" fontSize="10" fill="#94a3b8">€{Math.round(v).toLocaleString("en-GB")}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const x = padding.left + i * gap + (gap - barWidth) / 2;
        const catH = (d.catalogue / maxValue) * innerH;
        const aiH = (d.ai / maxValue) * innerH;
        const baseY = padding.top + innerH;
        return (
          <g key={i}>
            {catH > 0 && <rect x={x} y={baseY - catH} width={barWidth} height={catH} fill="#3b82f6" rx={3} />}
            {aiH > 0 && <rect x={x} y={baseY - catH - aiH} width={barWidth} height={aiH} fill="#a78bfa" rx={3} />}
            {catH === 0 && aiH === 0 && <rect x={x} y={baseY - 3} width={barWidth} height={3} fill="#e2e8f0" rx={1.5} />}
            <text x={x + barWidth / 2} y={h - 8} textAnchor="middle" fontSize="11" fill="#64748b" fontWeight="500">{d.day}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ActivityIcon({ type }: { type: ActivityEntry["type"] }) {
  switch (type) {
    case "quote": return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
    case "ai": return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/></svg>;
    case "pdf": return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
    case "login": return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>;
    default: return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg>;
  }
}

// =========================== STYLES (one big string) ===========================
const styles = `
.container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
.container-sm { max-width: 980px; margin: 0 auto; padding: 0 24px; }

.btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 10px; font-weight: 600; font-size: 14px; text-decoration: none; cursor: pointer; border: none; transition: all 0.15s ease; white-space: nowrap; font-family: inherit; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost-light { color: #fff; background: transparent; border: 1px solid rgba(255,255,255,0.14); }
.btn-ghost-light:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.24); }
.btn-primary { color: #fff; background: linear-gradient(135deg, #3b82f6, #2563eb); box-shadow: 0 4px 14px rgba(59,130,246,0.4); }
.btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(59,130,246,0.55); }
.btn-secondary { color: var(--slate-900); background: #fff; border: 1px solid var(--slate-200); }
.btn-secondary:hover { border-color: var(--slate-300); }
.btn-success { color: #fff; background: linear-gradient(135deg, #10b981, #059669); box-shadow: 0 4px 14px rgba(16,185,129,0.35); }
.btn-success:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(16,185,129,0.5); }
.btn-violet { color: #fff; background: linear-gradient(135deg, #a78bfa, #8b5cf6); box-shadow: 0 4px 14px rgba(139,92,246,0.35); }
.btn-violet:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(139,92,246,0.5); }
.btn-outline { color: var(--slate-700); background: transparent; border: 1px solid var(--slate-300); }
.btn-outline:hover { background: var(--slate-50); border-color: var(--slate-400); }
.btn-sm { padding: 7px 12px; font-size: 13px; }

.navbar { position: sticky; top: 0; z-index: 100; background: rgba(6,10,31,0.85); backdrop-filter: saturate(180%) blur(14px); border-bottom: 1px solid rgba(255,255,255,0.08); }
.nav-inner { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; max-width: 1280px; margin: 0 auto; }
.brand { display: flex; align-items: center; gap: 12px; text-decoration: none; }
.brand-logo { filter: drop-shadow(0 4px 12px rgba(59,130,246,0.35)); flex-shrink: 0; }
.brand-text { display: flex; flex-direction: column; line-height: 1.1; }
.brand-name { font-family: var(--font-bricolage); font-weight: 700; font-size: 18px; color: #fff; letter-spacing: -0.01em; }
.brand-slogan { font-size: 11px; color: var(--slate-400); font-weight: 500; }
.nav-links { display: flex; align-items: center; gap: 4px; }
.nav-link { color: var(--slate-300); text-decoration: none; font-size: 14px; font-weight: 500; padding: 8px 14px; border-radius: 8px; transition: all 0.15s; }
.nav-link:hover { color: #fff; background: rgba(255,255,255,0.06); }
.nav-cta { display: flex; align-items: center; gap: 10px; }

.hero { position: relative; overflow: hidden; background: radial-gradient(ellipse 80% 60% at 50% 0%, #1a2350 0%, #0a0f2c 50%, #060a1f 100%); color: #fff; padding: 72px 24px 96px; }
.hero-grid-bg { position: absolute; inset: 0; opacity: 0.35; background-image: linear-gradient(rgba(99,102,241,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.08) 1px, transparent 1px); background-size: 56px 56px; mask-image: radial-gradient(ellipse 70% 50% at 50% 30%, black 30%, transparent 80%); -webkit-mask-image: radial-gradient(ellipse 70% 50% at 50% 30%, black 30%, transparent 80%); }
.hero-blob { position: absolute; border-radius: 50%; filter: blur(80px); pointer-events: none; }
.hero-blob.b1 { width: 480px; height: 480px; background: rgba(59,130,246,0.18); top: -120px; left: -120px; }
.hero-blob.b2 { width: 420px; height: 420px; background: rgba(34,211,238,0.16); top: 100px; right: -100px; }
.hero-inner { position: relative; z-index: 1; max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 56px; align-items: center; }
.hero h1 { font-size: clamp(40px, 5.5vw, 64px); color: #fff; margin-bottom: 22px; font-weight: 800; letter-spacing: -0.035em; }
.hero h1 .accent { background: linear-gradient(120deg, #67e8f9 0%, #60a5fa 50%, #a78bfa 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.hero p { font-size: 18px; line-height: 1.6; color: var(--slate-300); max-width: 560px; margin-bottom: 32px; }
.hero-ctas { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 36px; }
.hero-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; padding-top: 32px; border-top: 1px solid rgba(255,255,255,0.08); }
.stat-value { font-family: var(--font-bricolage); font-size: 28px; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
.stat-label { font-size: 12px; color: var(--slate-400); font-weight: 500; margin-top: 4px; }
@media (max-width: 960px) { .hero-inner { grid-template-columns: 1fr; gap: 48px; text-align: center; } .hero-preview { max-width: 480px; margin: 0 auto; } .hero p { margin-left: auto; margin-right: auto; } .hero-ctas { justify-content: center; } }
@media (max-width: 520px) { .hero-stats { grid-template-columns: repeat(2, 1fr); } }

.hero-preview { background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02)); border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; padding: 6px; box-shadow: 0 30px 80px -20px rgba(0,0,0,0.5); position: relative; }
.preview-window { background: #fff; border-radius: 14px; overflow: hidden; }
.preview-toolbar { background: var(--slate-100); padding: 10px 14px; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--slate-200); }
.preview-dot { width: 11px; height: 11px; border-radius: 50%; }
.preview-dot.r { background: #ef4444; } .preview-dot.y { background: #fbbf24; } .preview-dot.g { background: #10b981; }
.preview-url { margin-left: 10px; flex: 1; background: #fff; border: 1px solid var(--slate-200); border-radius: 6px; padding: 4px 10px; font-size: 11px; color: var(--slate-500); font-family: var(--font-jetbrains); }
.preview-body { padding: 20px; }
.preview-label { font-size: 11px; font-weight: 600; color: var(--slate-500); text-transform: uppercase; letter-spacing: 0.08em; }
.preview-input-box { background: var(--slate-50); border: 1px dashed var(--slate-300); border-radius: 8px; padding: 12px; font-size: 13px; color: var(--slate-700); margin: 8px 0 16px; line-height: 1.5; }
.preview-input-box .hl { background: rgba(59,130,246,0.15); border-radius: 3px; padding: 0 3px; color: #3b82f6; font-weight: 600; }
.preview-input-box .hl-c { background: rgba(34,211,238,0.18); color: #0891b2; }
.preview-input-box .hl-g { background: rgba(16,185,129,0.18); color: #047857; }
.preview-arrow { text-align: center; color: var(--slate-300); font-size: 18px; margin: 6px 0; }
.preview-items { background: var(--slate-50); border-radius: 8px; padding: 12px; font-size: 12px; }
.preview-item-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed var(--slate-200); }
.preview-item-row:last-child { border-bottom: none; }
.preview-item-row .name { color: var(--slate-700); }
.preview-item-row .price { font-family: var(--font-jetbrains); color: var(--slate-900); font-weight: 600; }
.preview-total-row { display: flex; justify-content: space-between; margin-top: 10px; padding-top: 10px; border-top: 2px solid var(--slate-900); font-weight: 700; }
.preview-total-row .label { font-size: 12px; color: var(--slate-600); }
.preview-total-row .amount { font-family: var(--font-bricolage); font-size: 20px; background: linear-gradient(135deg, #3b82f6, #22d3ee); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.preview-status { margin-top: 14px; background: #dcfce7; border: 1px solid #86efac; color: #166534; padding: 8px 12px; border-radius: 6px; font-size: 11px; display: flex; align-items: center; gap: 6px; }
.preview-status .live-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; animation: pulse 2s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

section { padding: 88px 0; }
.section-eyebrow { display: inline-block; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; color: #3b82f6; margin-bottom: 14px; }
.section-title { font-size: clamp(28px, 3.8vw, 42px); margin-bottom: 14px; max-width: 720px; }
.section-lead { font-size: 17px; color: var(--slate-600); max-width: 640px; margin-bottom: 48px; }
.section-dark { background: #0a0f2c; color: var(--slate-200); }
.section-dark h2, .section-dark h3, .section-dark h4 { color: #fff; }
.section-dark .section-lead { color: var(--slate-300); }
.section-tint { background: var(--slate-50); }

.feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
.feature-card { background: #fff; border: 1px solid var(--slate-200); border-radius: 16px; padding: 28px; transition: all 0.2s; }
.feature-card:hover { border-color: var(--slate-300); transform: translateY(-3px); box-shadow: 0 10px 15px -3px rgba(15,23,42,0.08); }
.feature-icon { width: 46px; height: 46px; border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 20px; }
.feature-icon svg { width: 22px; height: 22px; stroke-width: 2; }
.ic-blue { background: #dbeafe; color: #1e40af; }
.ic-cyan { background: #cffafe; color: #0e7490; }
.ic-green { background: #d1fae5; color: #065f46; }
.ic-amber { background: #fef3c7; color: #92400e; }
.ic-violet { background: #ede9fe; color: #5b21b6; }
.ic-pink { background: #fce7f3; color: #9f1239; }
.feature-card h3 { font-size: 19px; margin-bottom: 10px; }
.feature-card p { font-size: 15px; color: var(--slate-600); }

.workflow-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 24px; }
.workflow-step { padding: 28px 24px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; }
.workflow-step .num { font-family: var(--font-bricolage); font-size: 14px; font-weight: 700; color: #67e8f9; margin-bottom: 12px; display: inline-flex; align-items: center; gap: 8px; }
.workflow-step .num::before { content: ''; width: 24px; height: 1px; background: #22d3ee; }
.workflow-step h3 { font-size: 17px; color: #fff; margin-bottom: 8px; }
.workflow-step p { font-size: 14px; color: var(--slate-400); }

.dash-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
.dash-card { background: #fff; border: 1px solid var(--slate-200); border-radius: 14px; padding: 22px; position: relative; overflow: hidden; }
.dash-card::after { content: ''; position: absolute; top: 0; right: 0; width: 80px; height: 80px; background: radial-gradient(circle, rgba(59,130,246,0.08), transparent 70%); border-radius: 50%; }
.dash-card .label { font-size: 12px; font-weight: 600; color: var(--slate-500); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
.dash-card .value { font-family: var(--font-bricolage); font-size: 30px; font-weight: 700; color: var(--slate-900); letter-spacing: -0.02em; }
.dash-card .delta { font-size: 12px; margin-top: 6px; font-weight: 600; }
.delta-up { color: #10b981; }
.delta-flat { color: var(--slate-500); }
.dash-split { display: grid; grid-template-columns: 1.3fr 1fr; gap: 20px; }
@media (max-width: 880px) { .dash-split { grid-template-columns: 1fr; } }
.chart-card, .activity-card { background: #fff; border: 1px solid var(--slate-200); border-radius: 16px; padding: 24px; }
.chart-head, .activity-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
.chart-head h3, .activity-head h3 { font-size: 16px; }
.chart-head .sub, .activity-head .sub { font-size: 12px; color: var(--slate-500); margin-top: 2px; }
.chart-legend { display: flex; gap: 14px; font-size: 12px; color: var(--slate-600); }
.legend-dot { width: 10px; height: 10px; border-radius: 3px; }
.activity-list { display: flex; flex-direction: column; gap: 12px; max-height: 280px; overflow-y: auto; }
.activity-item { display: flex; gap: 12px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; transition: background 0.15s; }
.activity-item:hover { background: var(--slate-50); }
.activity-icon { width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.activity-icon svg { width: 16px; height: 16px; stroke-width: 2; }
.ac-blue { background: #dbeafe; color: #1e40af; }
.ac-green { background: #d1fae5; color: #065f46; }
.ac-amber { background: #fef3c7; color: #92400e; }
.ac-violet { background: #ede9fe; color: #5b21b6; }
.activity-body { flex: 1; min-width: 0; }
.activity-title { font-size: 13px; font-weight: 600; color: var(--slate-900); display: flex; justify-content: space-between; gap: 8px; }
.activity-time { font-size: 11px; color: var(--slate-500); white-space: nowrap; }
.activity-desc { font-size: 12px; color: var(--slate-600); margin-top: 2px; }

.gen-card { background: #fff; border-radius: 24px; box-shadow: 0 20px 25px -5px rgba(15,23,42,0.1), 0 0 0 1px rgba(15,23,42,0.04); overflow: hidden; }
.gen-header { background: linear-gradient(135deg, #0a0f2c, #1a2350); color: #fff; padding: 24px 32px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.gen-header h3 { color: #fff; font-size: 20px; }
.gen-header .sub { font-size: 13px; color: var(--slate-300); margin-top: 4px; }
.gen-body { padding: 32px; display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
@media (max-width: 880px) { .gen-body { grid-template-columns: 1fr; padding: 22px; } .gen-header { padding: 20px 22px; } }
.field-label { display: block; font-size: 13px; font-weight: 600; color: var(--slate-700); margin-bottom: 8px; }
.textarea, .input { width: 100%; font-family: inherit; font-size: 15px; padding: 14px 16px; border: 1px solid var(--slate-300); border-radius: 12px; background: #fff; color: var(--slate-900); outline: none; transition: all 0.15s; resize: vertical; }
.textarea:focus, .input:focus { border-color: #3b82f6; box-shadow: 0 0 0 4px rgba(59,130,246,0.25); }
.textarea { min-height: 200px; line-height: 1.55; }
.chip-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.chip { font-size: 12px; font-weight: 500; padding: 4px 10px; border-radius: 100px; background: var(--slate-100); color: var(--slate-700); border: 1px solid var(--slate-200); cursor: pointer; transition: all 0.15s; }
.chip:hover { background: #e0f2fe; color: #075985; border-color: #7dd3fc; }
.button-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
.output-panel { background: var(--slate-50); border: 1px solid var(--slate-200); border-radius: 12px; padding: 20px; min-height: 200px; max-height: 460px; overflow-y: auto; font-family: var(--font-jetbrains); font-size: 13px; line-height: 1.65; color: var(--slate-800); white-space: pre-wrap; }
.output-panel.empty { color: var(--slate-400); display: flex; align-items: center; justify-content: center; text-align: center; font-family: var(--font-manrope); font-size: 14px; }
.output-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.alert { padding: 12px 16px; border-radius: 10px; font-size: 13px; margin-bottom: 14px; display: flex; gap: 10px; }
.alert-info { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
.alert-warn { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
.alert-success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }

.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
@media (max-width: 880px) { .two-col { grid-template-columns: 1fr; } }
.panel { background: #fff; border: 1px solid var(--slate-200); border-radius: 16px; overflow: hidden; }
.panel-header { padding: 18px 22px; border-bottom: 1px solid var(--slate-200); display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.panel-header h3 { font-size: 17px; }
.panel-body { padding: 8px 0; }
.cat-row { display: grid; grid-template-columns: 1fr 130px 90px; align-items: center; gap: 12px; padding: 12px 22px; border-bottom: 1px solid var(--slate-100); }
.cat-row:last-child { border-bottom: none; }
.cat-name { font-weight: 600; color: var(--slate-900); font-size: 14px; }
.cat-keywords { font-size: 11px; color: var(--slate-500); margin-top: 2px; }
.cat-price-input { width: 100%; padding: 8px 10px; border: 1px solid var(--slate-300); border-radius: 8px; font-family: var(--font-jetbrains); font-size: 13px; text-align: right; }
.cat-price-input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 4px rgba(59,130,246,0.25); }
.hist-row { padding: 14px 22px; border-bottom: 1px solid var(--slate-100); display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.hist-row:last-child { border-bottom: none; }
.hist-meta { font-size: 12px; color: var(--slate-500); margin-bottom: 4px; }
.hist-snippet { font-size: 13px; color: var(--slate-700); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hist-total { font-family: var(--font-bricolage); font-weight: 700; color: var(--slate-900); font-size: 15px; }
.empty-state { padding: 40px 22px; text-align: center; color: var(--slate-500); font-size: 14px; }

.usecase-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; }
.usecase-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 26px; transition: all 0.2s; }
.usecase-card:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.2); transform: translateY(-3px); }
.usecase-icon { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; background: linear-gradient(135deg, #3b82f6, #22d3ee); color: #fff; }
.usecase-icon svg { width: 22px; height: 22px; stroke-width: 2; }
.usecase-card h3 { font-size: 17px; color: #fff; margin-bottom: 8px; }
.usecase-card p { font-size: 14px; color: var(--slate-400); line-height: 1.6; }

.pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; align-items: stretch; }
@media (max-width: 880px) { .pricing-grid { grid-template-columns: 1fr; } }
.price-card { background: #fff; border: 1px solid var(--slate-200); border-radius: 18px; padding: 32px 28px; display: flex; flex-direction: column; transition: all 0.2s; position: relative; }
.price-card:hover { transform: translateY(-3px); box-shadow: 0 10px 15px -3px rgba(15,23,42,0.08); }
.price-card.featured { background: linear-gradient(180deg, #0a0f2c, #111838); border-color: #3b82f6; color: var(--slate-200); box-shadow: 0 20px 25px -5px rgba(15,23,42,0.1), 0 0 0 1px #3b82f6; transform: translateY(-6px); }
.price-card.featured:hover { transform: translateY(-9px); }
.price-badge { position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: linear-gradient(135deg, #22d3ee, #3b82f6); color: #fff; padding: 4px 12px; border-radius: 100px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; box-shadow: 0 4px 12px rgba(59,130,246,0.4); }
.price-tier { font-size: 13px; font-weight: 600; color: #3b82f6; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
.price-card.featured .price-tier { color: #67e8f9; }
.price-card h3 { font-size: 22px; margin-bottom: 8px; }
.price-card.featured h3 { color: #fff; }
.price-tagline { font-size: 14px; color: var(--slate-500); margin-bottom: 24px; }
.price-card.featured .price-tagline { color: var(--slate-400); }
.price-amount { display: flex; align-items: baseline; gap: 6px; margin-bottom: 24px; }
.price-amount .num { font-family: var(--font-bricolage); font-size: 44px; font-weight: 800; color: var(--slate-900); letter-spacing: -0.03em; }
.price-card.featured .price-amount .num { background: linear-gradient(135deg, #67e8f9, #60a5fa); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.price-amount .per { font-size: 14px; color: var(--slate-500); }
.price-card.featured .price-amount .per { color: var(--slate-400); }
.price-features { list-style: none; margin-bottom: 24px; flex: 1; padding: 0; }
.price-features li { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; color: var(--slate-700); padding: 7px 0; }
.price-card.featured .price-features li { color: var(--slate-200); }
.price-features li svg { color: #10b981; flex-shrink: 0; margin-top: 3px; }
.price-card.featured .price-features li svg { color: #34d399; }
.price-features li.muted { color: var(--slate-400); }
.price-features li.muted svg { color: var(--slate-300); }
.price-cta { width: 100%; justify-content: center; }

.faq-list { display: flex; flex-direction: column; gap: 12px; }
.faq-item { background: #fff; border: 1px solid var(--slate-200); border-radius: 14px; overflow: hidden; transition: all 0.2s; }
.faq-item.open { border-color: #3b82f6; box-shadow: 0 4px 14px rgba(59,130,246,0.1); }
.faq-q { width: 100%; text-align: left; background: transparent; border: none; cursor: pointer; padding: 20px 22px; display: flex; align-items: center; justify-content: space-between; gap: 16px; font-family: var(--font-bricolage); font-weight: 600; font-size: 16px; color: var(--slate-900); }
.faq-q .chevron { width: 32px; height: 32px; border-radius: 8px; background: var(--slate-100); color: var(--slate-600); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s; }
.faq-item.open .faq-q .chevron { background: #3b82f6; color: #fff; transform: rotate(180deg); }
.faq-a { max-height: 0; overflow: hidden; transition: max-height 0.3s ease, padding 0.3s ease; padding: 0 22px; color: var(--slate-600); font-size: 15px; line-height: 1.7; }
.faq-item.open .faq-a { max-height: 300px; padding: 0 22px 20px; }

.cta-banner { background: radial-gradient(ellipse 60% 100% at 50% 50%, #1a2350 0%, #0a0f2c 60%, #060a1f 100%); color: #fff; padding: 80px 40px; border-radius: 28px; text-align: center; position: relative; overflow: hidden; }
.cta-banner::before { content: ''; position: absolute; inset: 0; background-image: linear-gradient(rgba(99,102,241,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.08) 1px, transparent 1px); background-size: 56px 56px; mask-image: radial-gradient(ellipse 60% 60% at 50% 50%, black 30%, transparent 80%); -webkit-mask-image: radial-gradient(ellipse 60% 60% at 50% 50%, black 30%, transparent 80%); opacity: 0.4; }
.cta-banner > * { position: relative; z-index: 1; }
.cta-banner h2 { font-size: clamp(28px, 4vw, 40px); color: #fff; margin-bottom: 14px; max-width: 720px; margin-left: auto; margin-right: auto; }
.cta-banner h2 .accent { background: linear-gradient(120deg, #67e8f9, #60a5fa); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.cta-banner p { font-size: 17px; color: var(--slate-300); max-width: 560px; margin: 0 auto 32px; }
.cta-banner-ctas { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }

.team-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; max-width: 880px; margin: 0 auto; }
.team-card { background: #fff; border: 1px solid var(--slate-200); border-radius: 16px; padding: 24px; text-align: center; transition: all 0.2s; }
.team-card:hover { transform: translateY(-3px); box-shadow: 0 10px 15px -3px rgba(15,23,42,0.08); border-color: var(--slate-300); }
.avatar { width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center; font-family: var(--font-bricolage); font-weight: 700; font-size: 22px; color: #fff; }
.av-1 { background: linear-gradient(135deg, #f59e0b, #ef4444); }
.av-2 { background: linear-gradient(135deg, #3b82f6, #06b6d4); }
.av-3 { background: linear-gradient(135deg, #8b5cf6, #ec4899); }
.av-4 { background: linear-gradient(135deg, #10b981, #06b6d4); }
.team-name { font-weight: 700; color: var(--slate-900); font-size: 15px; }
.team-role { font-size: 12px; color: var(--slate-500); margin-top: 2px; }

.footer { background: #060a1f; color: var(--slate-400); padding: 56px 24px 32px; border-top: 1px solid rgba(255,255,255,0.06); }
.footer-top { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 32px; padding-bottom: 40px; border-bottom: 1px solid rgba(255,255,255,0.06); }
@media (max-width: 760px) { .footer-top { grid-template-columns: 1fr 1fr; } }
.footer h4 { color: #fff; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 16px; font-family: var(--font-manrope); }
.footer p { font-size: 14px; line-height: 1.6; max-width: 320px; margin-bottom: 14px; }
.footer ul { list-style: none; padding: 0; }
.footer li { margin-bottom: 8px; }
.footer a { color: var(--slate-400); text-decoration: none; font-size: 14px; transition: color 0.15s; }
.footer a:hover { color: #fff; }
.footer-bottom { max-width: 1200px; margin: 0 auto; padding-top: 28px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--slate-500); }
.trademark { font-size: 11px; color: var(--slate-500); text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.04); }

.user-avatar-sm { width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #22d3ee); color: #fff; font-weight: 600; font-size: 12px; display: flex; align-items: center; justify-content: center; }

.modal-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(6,10,31,0.72); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; padding: 24px; animation: fadeIn 0.2s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.modal { background: #fff; border-radius: 20px; width: 100%; max-width: 420px; padding: 36px 32px 32px; box-shadow: 0 25px 50px -12px rgba(15,23,42,0.25); position: relative; animation: modalIn 0.25s cubic-bezier(0.16,1,0.3,1); }
@keyframes modalIn { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
.modal-close { position: absolute; top: 16px; right: 16px; background: var(--slate-100); border: none; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; color: var(--slate-600); display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
.modal-close:hover { background: var(--slate-200); color: var(--slate-900); }
.modal-logo { display: flex; justify-content: center; margin-bottom: 18px; }
.modal h3 { text-align: center; font-size: 22px; margin-bottom: 6px; }
.modal .modal-sub { text-align: center; color: var(--slate-500); font-size: 14px; margin-bottom: 28px; }
.form-field { margin-bottom: 14px; }
.demo-hint { font-size: 12px; color: var(--slate-500); text-align: center; margin-top: 18px; padding: 10px; background: var(--slate-50); border-radius: 8px; }
.demo-hint strong { color: var(--slate-700); }

.toast-container { position: fixed; top: 20px; right: 20px; z-index: 2000; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
.toast { background: #fff; border: 1px solid var(--slate-200); border-left: 4px solid #10b981; border-radius: 10px; padding: 14px 18px; box-shadow: 0 20px 25px -5px rgba(15,23,42,0.1); min-width: 280px; max-width: 360px; display: flex; align-items: flex-start; gap: 12px; pointer-events: auto; animation: toastIn 0.3s cubic-bezier(0.16,1,0.3,1); }
.toast.info { border-left-color: #3b82f6; }
@keyframes toastIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
.toast-title { font-weight: 600; font-size: 14px; color: var(--slate-900); }
.toast-msg { font-size: 13px; color: var(--slate-600); margin-top: 2px; }

.chat-launcher { position: fixed; bottom: 24px; right: 24px; z-index: 900; width: 60px; height: 60px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: #fff; border: none; cursor: pointer; box-shadow: 0 10px 30px -5px rgba(59,130,246,0.5); display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
.chat-launcher:hover { transform: scale(1.06); box-shadow: 0 14px 36px -5px rgba(59,130,246,0.65); }
.chat-launcher::before { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid rgba(59,130,246,0.4); animation: ringPulse 2.4s ease-out infinite; }
@keyframes ringPulse { 0% { transform: scale(0.9); opacity: 0.8; } 100% { transform: scale(1.4); opacity: 0; } }
.chat-launcher .unread-dot { position: absolute; top: 6px; right: 6px; width: 14px; height: 14px; background: #10b981; border: 2px solid #fff; border-radius: 50%; font-size: 9px; font-weight: 700; color: #fff; display: flex; align-items: center; justify-content: center; }

.chat-panel { position: fixed; bottom: 24px; right: 24px; z-index: 901; width: 380px; max-width: calc(100vw - 32px); height: 580px; max-height: calc(100vh - 80px); background: #fff; border-radius: 20px; box-shadow: 0 25px 50px -12px rgba(15,23,42,0.25), 0 0 0 1px rgba(15,23,42,0.06); display: flex; flex-direction: column; overflow: hidden; animation: chatSlideIn 0.25s cubic-bezier(0.16,1,0.3,1); }
@keyframes chatSlideIn { from { opacity: 0; transform: translateY(20px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
.chat-header { background: linear-gradient(135deg, #0a0f2c, #1a2350); color: #fff; padding: 18px 20px; display: flex; align-items: center; gap: 12px; }
.chat-bot-avatar { width: 40px; height: 40px; border-radius: 12px; background: linear-gradient(135deg, #3b82f6, #22d3ee); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; position: relative; flex-shrink: 0; }
.chat-bot-avatar::after { content: ''; position: absolute; bottom: -2px; right: -2px; width: 12px; height: 12px; background: #34d399; border: 2px solid #0a0f2c; border-radius: 50%; }
.chat-header-text { flex: 1; line-height: 1.2; min-width: 0; }
.chat-header-name { font-weight: 700; color: #fff; font-size: 15px; }
.chat-header-status { font-size: 12px; color: var(--slate-300); display: flex; align-items: center; gap: 5px; }
.chat-header-status::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #34d399; }
.chat-close-btn { background: rgba(255,255,255,0.1); border: none; cursor: pointer; width: 32px; height: 32px; border-radius: 8px; color: #fff; display: flex; align-items: center; justify-content: center; transition: background 0.15s; }
.chat-close-btn:hover { background: rgba(255,255,255,0.18); }
.chat-messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px; background: var(--slate-50); }
.chat-msg { display: flex; gap: 10px; max-width: 88%; animation: msgIn 0.25s ease; }
@keyframes msgIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.chat-msg.bot { align-self: flex-start; }
.chat-msg.user { align-self: flex-end; flex-direction: row-reverse; }
.chat-msg-avatar { width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #fff; }
.chat-msg.bot .chat-msg-avatar { background: linear-gradient(135deg, #3b82f6, #22d3ee); }
.chat-msg.user .chat-msg-avatar { background: var(--slate-700); }
.chat-msg-bubble { padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; }
.chat-msg.bot .chat-msg-bubble { background: #fff; color: var(--slate-800); border: 1px solid var(--slate-200); border-top-left-radius: 4px; }
.chat-msg.user .chat-msg-bubble { background: #3b82f6; color: #fff; border-top-right-radius: 4px; }
.chat-typing { display: flex; gap: 4px; padding: 12px 14px; background: #fff; border: 1px solid var(--slate-200); border-radius: 14px; border-top-left-radius: 4px; align-self: flex-start; max-width: 60px; }
.chat-typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--slate-400); animation: typingBounce 1.2s ease-in-out infinite; }
.chat-typing span:nth-child(2) { animation-delay: 0.15s; }
.chat-typing span:nth-child(3) { animation-delay: 0.3s; }
@keyframes typingBounce { 0%,60%,100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-5px); opacity: 1; } }
.chat-suggestions { padding: 0 20px 12px; display: flex; flex-wrap: wrap; gap: 6px; background: var(--slate-50); }
.chat-suggestion { font-size: 12px; font-weight: 500; padding: 6px 12px; background: #fff; border: 1px solid var(--slate-300); color: var(--slate-700); border-radius: 100px; cursor: pointer; transition: all 0.15s; }
.chat-suggestion:hover { background: #3b82f6; color: #fff; border-color: #3b82f6; }
.chat-input-row { padding: 14px 16px; background: #fff; border-top: 1px solid var(--slate-200); display: flex; gap: 8px; align-items: flex-end; }
.chat-input { flex: 1; padding: 10px 14px; border: 1px solid var(--slate-300); border-radius: 12px; font-family: inherit; font-size: 14px; color: var(--slate-900); resize: none; outline: none; max-height: 100px; line-height: 1.4; }
.chat-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
.chat-send { width: 40px; height: 40px; border: none; border-radius: 12px; background: linear-gradient(135deg, #3b82f6, #2563eb); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s; flex-shrink: 0; }
.chat-send:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(59,130,246,0.4); }
.chat-send:disabled { opacity: 0.4; cursor: not-allowed; }
.chat-footer { padding: 8px 16px; background: #fff; border-top: 1px solid var(--slate-100); font-size: 10px; color: var(--slate-400); text-align: center; }
@media (max-width: 480px) { .chat-panel { right: 12px; bottom: 12px; left: 12px; width: auto; height: calc(100vh - 100px); } .chat-launcher { right: 16px; bottom: 16px; width: 54px; height: 54px; } }
@media (max-width: 720px) { .nav-links { display: none; } section { padding: 64px 0; } .hero { padding: 56px 20px 72px; } .price-card.featured { transform: none; } .price-card.featured:hover { transform: translateY(-3px); } }
`;
