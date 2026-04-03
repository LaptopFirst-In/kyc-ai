import { useState, useRef, useEffect } from "react";
import { Search, Building2, User, FileText, MapPin, Star, History, Send, Loader2, ExternalLink, ShieldCheck, Download, Settings, X, CheckCircle2, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { generateOrganizationReport, ReportData } from "./lib/gemini";

interface Message {
  id: string;
  type: "user" | "ai";
  content: string;
  report?: ReportData;
  query?: string;
}

interface ConfigStatus {
  hasToken: boolean;
  repo: string | null;
  branch: string;
  folder: string;
}

export default function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      type: "ai",
      content: "Hello! I'm VendorCheck AI. Provide me with a company name, founder name, or GST number, and I'll generate a detailed due diligence report for you.",
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [isSavingToGithub, setIsSavingToGithub] = useState<string | null>(null);
  const [githubSaveStatus, setGithubSaveStatus] = useState<{ [id: string]: "success" | "error" | null }>({});
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch("/api/config-status");
        if (response.ok) {
          const data = await response.json();
          setConfigStatus(data);
        }
      } catch (err) {
        console.error("Failed to fetch config status:", err);
      }
    };
    fetchConfig();
  }, []);

  const saveToGithub = async (messageId: string, query: string, content: string) => {
    setIsSavingToGithub(messageId);
    setGithubSaveStatus((prev) => ({ ...prev, [messageId]: null }));
    try {
      const response = await fetch("/api/save-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, content }),
      });
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || data.message || "Failed to save to GitHub");
      }
      console.log("Saved to GitHub:", data.fileName);
      setGithubSaveStatus((prev) => ({ ...prev, [messageId]: "success" }));
    } catch (err: any) {
      console.error("GitHub save failed:", err.message);
      setGithubSaveStatus((prev) => ({ ...prev, [messageId]: "error" }));
    } finally {
      setIsSavingToGithub(null);
    }
  };

  const handleExportPDF = async (messageId: string, query: string) => {
    const element = document.getElementById(`report-${messageId}`);
    if (!element) return;

    setIsExporting(messageId);
    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#f8fafc", // matches bg-slate-50
      });
      
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const maxWidth = pdfWidth - (margin * 2);
      const maxHeight = pdfHeight - (margin * 3); // extra for title
      
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min(maxWidth / imgWidth, maxHeight / imgHeight);
      
      const finalWidth = imgWidth * ratio;
      const finalHeight = imgHeight * ratio;
      const imgX = (pdfWidth - finalWidth) / 2;
      const imgY = 20; // margin top + title space

      pdf.setFontSize(16);
      pdf.setTextColor(79, 70, 229); // indigo-600
      pdf.text(`Due Diligence Report: ${query}`, margin, 15);
      
      pdf.addImage(
        imgData,
        "PNG",
        imgX,
        imgY,
        finalWidth,
        finalHeight
      );
      
      pdf.save(`VendorCheck_Report_${query.replace(/\s+/g, "_")}.pdf`);
    } catch (err) {
      console.error("PDF Export failed:", err);
      setError("Failed to export PDF. Please try again.");
    } finally {
      setIsExporting(null);
    }
  };

  const validateInput = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return "Please enter a company name, founder, or GST number.";
    
    // Check if it looks like a GST number (15 chars, alphanumeric)
    // Standard Indian GST: 2 digits + 10 chars (PAN) + 1 char (entity) + Z + 1 char (checksum)
    const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    
    // If it's 15 chars and mostly alphanumeric, check format
    if (trimmed.length === 15 && /^[0-9A-Z]+$/i.test(trimmed)) {
      if (!gstRegex.test(trimmed.toUpperCase())) {
        return "The GST number format seems invalid. Please check and try again.";
      }
    }
    
    return null;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedInput = input.trim();
    const validationError = validateInput(cleanedInput);
    
    if (validationError) {
      setError(validationError);
      return;
    }
    
    if (isLoading) return;
    setError(null);

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: cleanedInput,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const report = await generateOrganizationReport(cleanedInput);
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "ai",
        content: "Here is the detailed report I've compiled for you:",
        report,
        query: cleanedInput,
      };
      setMessages((prev) => [...prev, aiMessage]);
      
      // Automatically save to GitHub
      saveToGithub(aiMessage.id, cleanedInput, report.text);
    } catch (error) {
      console.error("Error generating report:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "ai",
        content: "I'm sorry, I encountered an error while researching that organization. Please try again with more specific details.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <ShieldCheck className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">VendorCheck AI</h1>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">IT Rental Due Diligence</p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-4 text-sm text-slate-600 font-medium">
          <div className="flex items-center gap-1.5">
            <Building2 className="w-4 h-4" />
            <span>Company Search</span>
          </div>
          <div className="flex items-center gap-1.5">
            <User className="w-4 h-4" />
            <span>Founder Check</span>
          </div>
          <div className="flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            <span>GST Verification</span>
          </div>
          <button 
            onClick={() => setShowConfig(true)}
            className="ml-4 p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-indigo-600"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Configuration Modal */}
      <AnimatePresence>
        {showConfig && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Settings className="w-5 h-5 text-indigo-600" />
                  GitHub Configuration
                </h2>
                <button onClick={() => setShowConfig(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${configStatus?.hasToken ? "bg-emerald-100" : "bg-rose-100"}`}>
                        {configStatus?.hasToken ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-rose-600" />}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">GitHub Token</p>
                        <p className="text-xs text-slate-500">{configStatus?.hasToken ? "Configured in Secrets" : "Missing in Secrets"}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${configStatus?.repo ? "bg-emerald-100" : "bg-rose-100"}`}>
                        {configStatus?.repo ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-rose-600" />}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">Repository</p>
                        <p className="text-xs text-slate-500 font-mono">{configStatus?.repo || "Missing in Secrets"}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Branch</p>
                      <p className="text-sm font-medium text-slate-700 font-mono">{configStatus?.branch || "main"}</p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Folder</p>
                      <p className="text-sm font-medium text-slate-700 font-mono">{configStatus?.folder || "reports"}</p>
                    </div>
                  </div>
                </div>

                {!configStatus?.hasToken || !configStatus?.repo ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-xs text-amber-700 leading-relaxed">
                      <strong>Setup Required:</strong> Add <code>GITHUB_TOKEN</code> and <code>GITHUB_REPO</code> to the <strong>Secrets</strong> panel in AI Studio to enable automatic report archiving.
                    </p>
                  </div>
                ) : (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                    <p className="text-xs text-emerald-700 leading-relaxed">
                      <strong>Ready!</strong> Reports will be automatically saved to your repository after generation.
                    </p>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
                <button 
                  onClick={() => setShowConfig(false)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-md"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 max-w-5xl mx-auto w-full">
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                  message.type === "user"
                    ? "bg-indigo-600 text-white rounded-tr-none"
                    : "bg-white border border-slate-200 text-slate-800 rounded-tl-none"
                }`}
              >
                <div className="text-sm md:text-base">
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </div>

                {message.report && (
                  <div className="mt-6 space-y-6 border-t border-slate-100 pt-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Due Diligence Report</h3>
                        {isSavingToGithub === message.id && (
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-400 uppercase tracking-wider animate-pulse">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Saving to GitHub...
                          </div>
                        )}
                        {githubSaveStatus[message.id] === "success" && (
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-500 uppercase tracking-wider">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Saved to GitHub
                          </div>
                        )}
                        {githubSaveStatus[message.id] === "error" && (
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-rose-500 uppercase tracking-wider">
                            <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                            GitHub Save Failed
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleExportPDF(message.id, message.query || "Report")}
                        disabled={isExporting === message.id}
                        className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-all disabled:opacity-50"
                      >
                        {isExporting === message.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Download className="w-3 h-3" />
                        )}
                        {isExporting === message.id ? "Exporting..." : "Export PDF"}
                      </button>
                    </div>
                    
                    <div id={`report-${message.id}`} className="bg-slate-50 rounded-xl p-6 border border-slate-200">
                      <div className="markdown-body text-slate-700">
                        <ReactMarkdown>{message.report.text}</ReactMarkdown>
                      </div>
                    </div>

                    {message.report.sources.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                          <Search className="w-4 h-4" />
                          Information Sources
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {message.report.sources.map((source, idx) => (
                            <a
                              key={idx}
                              href={source.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-full text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-indigo-300 hover:text-indigo-600 transition-all shadow-sm"
                            >
                              <ExternalLink className="w-3 h-3" />
                              {source.title || "Source"}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none p-4 shadow-sm flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
              <span className="text-sm font-medium text-slate-600 italic">
                Researching organization details and verifying records...
              </span>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Area */}
      <footer className="bg-white border-t border-slate-200 p-4 md:p-6 sticky bottom-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <form onSubmit={handleSubmit} className="max-w-5xl mx-auto relative">
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute -top-12 left-0 right-0 bg-red-50 border border-red-200 text-red-600 text-xs font-medium px-4 py-2 rounded-lg shadow-sm flex items-center gap-2"
              >
                <div className="bg-red-600 w-1 h-1 rounded-full animate-pulse" />
                {error}
              </motion.div>
            )}
          </AnimatePresence>
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Enter company name, founder, or GST number (e.g., 'Zomato' or 'Deepinder Goyal')"
            className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-6 pr-16 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-slate-800 placeholder:text-slate-400 font-medium shadow-inner"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-indigo-600 text-white p-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-all shadow-md active:scale-95"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
        <p className="text-center text-[10px] text-slate-400 mt-3 font-medium uppercase tracking-widest">
          Powered by Gemini 3 Flash & Google Search Grounding
        </p>
      </footer>
    </div>
  );
}
