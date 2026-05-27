import React, { useState, useEffect, useRef } from "react";
import { 
  Rss, 
  Layers, 
  Plus, 
  Trash2, 
  RefreshCw, 
  ExternalLink, 
  MessageSquare, 
  Send, 
  Sparkles, 
  Copy, 
  Check, 
  BookOpen, 
  AlertCircle, 
  Compass, 
  Clock, 
  Minimize2, 
  Maximize2,
  ListRestart,
  Sliders,
  Menu,
  Globe,
  X,
  Filter,
  Settings
} from "lucide-react";
import { RSSFeed, RSSBundle, FeedArticle, ChatMessage } from "./types";
import { ArticleCard } from "./components/ArticleCard";

// Helper to resolve an aesthetic illustration/cover image for any article card
function getArticleCoverImage(art: FeedArticle): string {
  // Use cached full text primary image if available
  if (art.imageUrl) {
    return art.imageUrl;
  }

  // Check if there is an image URL in the summary or content (e.g. src="...")
  const contentToSearch = `${art.summary || ''} ${art.content || ''}`;
  const imgRegex = /src=["'](https?:\/\/[^"'\s<>]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^"'\s<>]*)?)["']/i;
  const match = contentToSearch.match(imgRegex);
  if (match && match[1]) {
    return match[1];
  }

  // Pre-determined aesthetic Unsplash stock collection based on simple string hashing
  const covers = [
    "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=600&auto=format&fit=crop&q=80", // Digital Health
    "https://images.unsplash.com/photo-1530026405186-ed1ea0ac7a63?w=600&auto=format&fit=crop&q=80", // Microscope / Medical Research
    "https://images.unsplash.com/photo-1507413245164-6160d8298b31?w=600&auto=format&fit=crop&q=80", // Laboratory Science
    "https://images.unsplash.com/photo-1526253038957-bfa54e05968e?w=600&auto=format&fit=crop&q=80", // Stethoscope / Clinical
    "https://images.unsplash.com/photo-1532187863486-abf9d39d6618?w=600&auto=format&fit=crop&q=80", // Chemistry / Laboratory Bio
    "https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?w=600&auto=format&fit=crop&q=80", // Digital Analytics / Tech
    "https://images.unsplash.com/photo-1631553127967-90ec14e7737d?w=600&auto=format&fit=crop&q=80", // Biotech/Pharm
    "https://images.unsplash.com/photo-1518152006812-edab29b069ac?w=600&auto=format&fit=crop&q=80", // Circuit/Deep Learning
    "https://images.unsplash.com/photo-1512486130939-2c4f79935e4f?w=600&auto=format&fit=crop&q=80", // Medical Journal / Reading
    "https://images.unsplash.com/photo-1457369804613-52c61a468e7d?w=600&auto=format&fit=crop&q=80"  // Science Journal Books
  ];

  let hash = 0;
  const str = art.title || art.id || "";
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % covers.length;
  return covers[index];
}

// Helper to extract clean destination URL from redirect trackers like Yahoo search referrals
function cleanUrl(url: string): string {
  if (!url || typeof url !== "string") return url;
  try {
    if (url.includes("r.search.yahoo.com") || url.includes("/RU=") || url.includes("/ru=") || url.includes("?RU=") || url.includes("?ru=")) {
      const match = url.match(/[\/\?&]RU=([^&\/]+)/i);
      if (match && match[1]) {
        try {
          const decoded = decodeURIComponent(match[1]);
          if (decoded && decoded.startsWith("http")) {
            return decoded;
          }
        } catch (e) {
          const escaped = unescape(match[1]);
          if (escaped && escaped.startsWith("http")) {
            return escaped;
          }
        }
      }
    }
  } catch (err) {}
  return url;
}

export default function App() {
  // DB States
  const [feeds, setFeeds] = useState<RSSFeed[]>([]);
  const [bundles, setBundles] = useState<RSSBundle[]>([]);
  const [activeReaderArticle, setActiveReaderArticle] = useState<FeedArticle & { feedName?: string } | null>(null);
  
  // High fidelity reader state
  const [readerViewMode, setReaderViewMode] = useState<'clean' | 'original'>('clean');
  const [readerLoading, setReaderLoading] = useState<boolean>(false);
  const [readerError, setReaderError] = useState<string | null>(null);
  const [readerContent, setReaderContent] = useState<{ title: string; contentHtml: string } | null>(null);
  
  // Custom AI Settings & LocalStorage persistence
  const [useCustomAi, setUseCustomAi] = useState<boolean>(() => {
    return localStorage.getItem("useCustomAi") === "true";
  });
  const [customAiBaseUrl, setCustomAiBaseUrl] = useState<string>(() => {
    return localStorage.getItem("customAiBaseUrl") || "https://api.deepseek.com/v1";
  });
  const [customAiApiKey, setCustomAiApiKey] = useState<string>(() => {
    return localStorage.getItem("customAiApiKey") || "";
  });
  const [customAiModel, setCustomAiModel] = useState<string>(() => {
    return localStorage.getItem("customAiModel") || "deepseek-chat";
  });
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<"update" | "ai">("update");
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  const [showOriginalSplit, setShowOriginalSplit] = useState<boolean>(true);

  // Sync state changes to LocalStorage
  useEffect(() => {
    localStorage.setItem("useCustomAi", useCustomAi ? "true" : "false");
  }, [useCustomAi]);
  useEffect(() => {
    localStorage.setItem("customAiBaseUrl", customAiBaseUrl);
  }, [customAiBaseUrl]);
  useEffect(() => {
    localStorage.setItem("customAiApiKey", customAiApiKey);
  }, [customAiApiKey]);
  useEffect(() => {
    localStorage.setItem("customAiModel", customAiModel);
  }, [customAiModel]);

  // Hook to fetch full article contents inside the clean Reader view mode on-demand
  useEffect(() => {
    if (activeReaderArticle && showOriginalSplit) {
      setReaderLoading(true);
      setReaderError(null);
      setReaderContent(null);
      setReaderViewMode('clean'); // Auto default to distraction-free reading experience
      
      const targetUrl = activeReaderArticle.url;
      console.log("[Article Reader] Dispatching clean extraction request for url:", targetUrl);
      
      fetch(`/api/reader-content`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          url: targetUrl,
          customAiSettings: {
            isEnabled: useCustomAi,
            baseUrl: customAiBaseUrl,
            apiKey: customAiApiKey,
            model: customAiModel
          }
        })
      })
        .then(res => {
          if (!res.ok) {
            throw new Error(`HTTP 异常 ${res.status}`);
          }
          return res.json();
        })
        .then(data => {
          if (data && data.contentHtml && data.contentHtml.length > 50) {
            console.log("[Article Reader] Successfully parsed webpage structure server side!");
            setReaderContent(data);
          } else if (data && data.error) {
            throw new Error(data.error);
          } else {
            throw new Error("未能提取出有效的正文，已自动开启安全直连原始网页。");
          }
          setReaderLoading(false);
        })
        .catch(err => {
          console.warn("[Article Reader] Server side extractor failed or returned empty content. Fallback to raw page view: ", err.message || err);
          setReaderError(err.message || "拉取失败");
          setReaderLoading(false);
          // Auto fallback to high integrity proxy iframe on extract error so the webpage remains browsable
          setReaderViewMode('original');
        });
    }
  }, [activeReaderArticle, showOriginalSplit, useCustomAi, customAiBaseUrl, customAiApiKey, customAiModel]);

  // App UX States
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [copiedTextId, setCopiedTextId] = useState<string | null>(null);
  const [errorAlert, setErrorAlert] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    id: string;
    name: string;
    type: "feed" | "bundle";
  } | null>(null);
  
  // Modal controllers
  const [showAddFeedModal, setShowAddFeedModal] = useState(false);
  const [showAddBundleModal, setShowAddBundleModal] = useState(false);
  const [expandedArticleId, setExpandedArticleId] = useState<string | null>(null);
  
  // Submit states
  const [feedUrlInput, setFeedUrlInput] = useState("");
  const [isScrapingFeed, setIsScrapingFeed] = useState(false);
  const [isRefreshingFeedId, setIsRefreshingFeedId] = useState<string | null>(null);
  
  const [bundleNameInput, setBundleNameInput] = useState("");
  const [bundleDescInput, setBundleDescInput] = useState("");
  const [bundleCheckedFeeds, setBundleCheckedFeeds] = useState<string[]>([]);
  const [isCreatingBundle, setIsCreatingBundle] = useState(false);
  
  // Chat States
  const [chatMessages, setChatMessages] = useState<{ [bundleId: string]: ChatMessage[] }>({});
  const [currentChatInput, setCurrentChatInput] = useState("");
  const [isGeneratingReply, setIsGeneratingReply] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Active view tabs
  const [activeTab, setActiveTab] = useState<"articles" | "chat">("articles");

  // Article read/unread filtering state
  const [filterUnreadOnly, setFilterUnreadOnly] = useState(false);
  const [readUrls, setReadUrls] = useState<{ [url: string]: boolean }>(() => {
    try {
      const stored: { [url: string]: boolean } = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("rss_read_")) {
          const url = key.replace("rss_read_", "");
          if (localStorage.getItem(key) === "true") {
            stored[url] = true;
          }
        }
      }
      return stored;
    } catch (e) {
      return {};
    }
  });

  const handleToggleRead = (url: string) => {
    setReadUrls(prev => {
      const next = { ...prev };
      const key = "rss_read_" + url;
      if (next[url]) {
        delete next[url];
        localStorage.removeItem(key);
      } else {
        next[url] = true;
        localStorage.setItem(key, "true");
      }
      return next;
    });
  };

  const handleMarkAsRead = (url: string) => {
    setReadUrls(prev => {
      if (prev[url]) return prev;
      const key = "rss_read_" + url;
      localStorage.setItem(key, "true");
      return { ...prev, [url]: true };
    });
  };

  // State for crawler settings
  const [settings, setSettings] = useState<{ autoUpdate: boolean; updateIntervalHours: number }>({
    autoUpdate: true,
    updateIntervalHours: 24
  });

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.autoUpdate === "boolean") {
          setSettings(data);
        }
      }
    } catch (err) {
      console.error("Failed to fetch settings", err);
    }
  };

  const handleUpdateSettings = async (updater: (prev: { autoUpdate: boolean; updateIntervalHours: number }) => { autoUpdate: boolean; updateIntervalHours: number }) => {
    const nextSettings = updater(settings);
    setSettings(nextSettings);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextSettings)
      });
    } catch (err) {
      console.error("Failed to save settings", err);
      showError("保存设置失败，请稍后重试。");
    }
  };

  // Load initial data
  useEffect(() => {
    fetchFeeds();
    fetchBundles();
    fetchSettings();
  }, []);

  // Set default bundle selection once bundle list loads
  useEffect(() => {
    if (bundles.length > 0 && !selectedBundleId && !selectedFeedId) {
      setSelectedBundleId(bundles[0].id);
    }
  }, [bundles]);

  // Handle scroll to bottom of chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, selectedBundleId, activeTab]);

  const fetchFeeds = async () => {
    try {
      const res = await fetch("/api/feeds");
      const data = await res.json();
      if (data.feeds) {
        setFeeds(data.feeds);
      }
    } catch (err) {
      console.error("Failed to load RSS feeds", err);
      showError("无法加载订阅源列表，请稍后重试。");
    }
  };

  const fetchBundles = async () => {
    try {
      const res = await fetch("/api/bundles");
      const data = await res.json();
      if (data.bundles) {
        setBundles(data.bundles);
      }
    } catch (err) {
      console.error("Failed to load bundles", err);
      showError("无法加载订阅包，请稍后重试。");
    }
  };

  const triggerFeedRefresh = async (feedId: string) => {
    setIsRefreshingFeedId(feedId);
    setInfoMessage("正在抓取网站更新并拉取全文文章中...");
    try {
      const res = await fetch(`/api/feeds/${feedId}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customAiSettings: {
            isEnabled: useCustomAi,
            baseUrl: customAiBaseUrl,
            apiKey: customAiApiKey,
            model: customAiModel
          }
        })
      });
      const data = await res.json();
      
      if (res.status >= 400 || data.error) {
        throw new Error(data.error || "刷新失败");
      }
      
      // Update feed instance
      setFeeds(prev => prev.map(f => f.id === feedId ? data.feed : f));
      setInfoMessage("订阅源更新同步成功！已重新提取最新文章。");
    } catch (err: any) {
      console.error(err);
      showError(`更新源文章失败: ${err.message || "未知抓取错误"}`);
    } finally {
      setIsRefreshingFeedId(null);
      setTimeout(() => setInfoMessage(null), 3000);
    }
  };

  const createNewFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedUrlInput || !feedUrlInput.trim().startsWith("http")) {
      showError("请输入有效的网站地址，须以 http:// or https:// 开头。");
      return;
    }

    setIsScrapingFeed(true);
    setErrorAlert(null);
    setInfoMessage("正在通过 AI 深度扫描网页、提取文章列表，可能需要 10-15 秒...");
    try {
      const res = await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: feedUrlInput.trim(),
          customAiSettings: {
            isEnabled: useCustomAi,
            baseUrl: customAiBaseUrl,
            apiKey: customAiApiKey,
            model: customAiModel
          }
        })
      });
      
      const data = await res.json();
      if (res.status >= 400 || data.error) {
        throw new Error(data.error || "Scraping failed");
      }

      setFeeds(prev => [...prev, data.feed]);
      setFeedUrlInput("");
      setShowAddFeedModal(false);
      setInfoMessage("恭喜！AI 网页订阅生成完毕，最新文章及全文内容已提取成功！");
    } catch (err: any) {
      console.error(err);
      showError(`转换订阅源失败: ${err.message || "无法拉取该网页内容，请检查网址。"}`);
    } finally {
      setIsScrapingFeed(false);
      setTimeout(() => setInfoMessage(null), 4000);
    }
  };

  const deleteFeed = async (id: string) => {
    try {
      const res = await fetch(`/api/feeds/${id}`, { method: "DELETE" });
      if (res.ok) {
        setFeeds(prev => prev.filter(f => f.id !== id));
        // Soft refresh bundles since their feed lists may have updated
        fetchBundles();
        setInfoMessage("已成功移除该订阅源。");
      }
    } catch (err) {
      showError("删除订阅源失败。");
    } finally {
      setTimeout(() => setInfoMessage(null), 3000);
    }
  };

  const createNewBundle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bundleNameInput.trim()) {
      showError("请输入订阅包名称。");
      return;
    }
    if (bundleCheckedFeeds.length === 0) {
      showError("请至少勾选一个订阅源加入到订阅包中。");
      return;
    }

    setIsCreatingBundle(true);
    try {
      const res = await fetch("/api/bundles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: bundleNameInput.trim(),
          description: bundleDescInput.trim() || "合并订阅源精选包",
          feedIds: bundleCheckedFeeds
        })
      });
      
      const data = await res.json();
      if (res.status >= 400 || data.error) {
        throw new Error(data.error);
      }

      setBundles(prev => [...prev, data.bundle]);
      setSelectedBundleId(data.bundle.id);
      
      // Reset inputs
      setBundleNameInput("");
      setBundleDescInput("");
      setBundleCheckedFeeds([]);
      setShowAddBundleModal(false);
      setInfoMessage(`已成功创建合并订阅包 "${data.bundle.name}"！`);
    } catch (err: any) {
      showError(err.message || "创建合并订阅包失败。");
    } finally {
      setIsCreatingBundle(false);
      setTimeout(() => setInfoMessage(null), 3000);
    }
  };

  const deleteBundle = async (id: string) => {
    try {
      const res = await fetch(`/api/bundles/${id}`, { method: "DELETE" });
      if (res.ok) {
        setBundles(prev => prev.filter(b => b.id !== id));
        if (selectedBundleId === id) {
          setSelectedBundleId(null);
        }
        setInfoMessage("合并订阅包已删除。");
      }
    } catch (err) {
      showError("删除订阅包失败。");
    } finally {
      setTimeout(() => setInfoMessage(null), 3000);
    }
  };

  const handleExecuteDelete = async () => {
    if (!deleteConfirmTarget) return;
    const { id, type } = deleteConfirmTarget;
    setDeleteConfirmTarget(null);
    if (type === "feed") {
      await deleteFeed(id);
    } else {
      await deleteBundle(id);
    }
  };

  // Chat with Selected Bundle
  const handleSendChatMessage = async (presetText?: string) => {
    const textToSend = presetText || currentChatInput;
    if (!textToSend.trim() || !selectedBundleId) {
      return;
    }

    setErrorAlert(null);
    const activeBundle = bundles.find(b => b.id === selectedBundleId);
    if (!activeBundle) return;

    // Create current conversation space if missing
    const previousHistory = chatMessages[selectedBundleId] || [];
    
    const newUserMsg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      role: 'user',
      text: textToSend,
      created_at: new Date().toISOString()
    };

    const updatedHistory = [...previousHistory, newUserMsg];
    setChatMessages(prev => ({
      ...prev,
      [selectedBundleId]: updatedHistory
    }));
    
    // Clear typing input if not a preset clicked
    if (!presetText) {
      setCurrentChatInput("");
    }
    
    setIsGeneratingReply(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bundleId: selectedBundleId,
          messages: updatedHistory,
          customAiSettings: {
            isEnabled: useCustomAi,
            baseUrl: customAiBaseUrl,
            apiKey: customAiApiKey,
            model: customAiModel
          }
        })
      });

      const data = await response.json();
      if (response.status >= 400 || data.error) {
        throw new Error(data.error || "Failed to generate AI response.");
      }

      const aiReply: ChatMessage = {
        id: Math.random().toString(36).substring(2, 9),
        role: 'model',
        text: data.text,
        created_at: new Date().toISOString()
      };

      setChatMessages(prev => ({
        ...prev,
        [selectedBundleId]: [...updatedHistory, aiReply]
      }));
    } catch (err: any) {
      console.error(err);
      showError(`AI 对话引擎错误: ${err.message || "连接助手失败"}`);
      
      // Fallback message inside chat so UI logs it nicely
      const systemErrorMsg: ChatMessage = {
        id: Math.random().toString(36).substring(2, 9),
        role: 'model',
        text: `⚠️ 抱歉，助手在阅读此网页包时遇到了技术错误：\n"${err.message || "无法拉取全文向量进行总结，可能是模型限流或网络超时。"}"\n\n你可以尝试再发一条简单的问题，或者手动重新同步一下该网站源。`,
        created_at: new Date().toISOString()
      };
      
      setChatMessages(prev => ({
        ...prev,
        [selectedBundleId]: [...updatedHistory, systemErrorMsg]
      }));
    } finally {
      setIsGeneratingReply(false);
    }
  };

  // Helper clear chat of selected bundle
  const clearActiveChatHistory = () => {
    if (!selectedBundleId) return;
    setChatMessages(prev => ({
      ...prev,
      [selectedBundleId]: []
    }));
  };

  const showError = (msg: string) => {
    setErrorAlert(msg);
    setTimeout(() => {
      setErrorAlert(null);
    }, 6000);
  };

  const handleCopyToClipboard = (text: string, elementId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTextId(elementId);
    setTimeout(() => {
      setCopiedTextId(null);
    }, 2000);
  };

  // Get current active bundle data
  const activeBundleObj = bundles.find(b => b.id === selectedBundleId);
  
  // Calculate matched articles
  const activeArticles: (FeedArticle & { feedName: string })[] = [];
  if (activeBundleObj) {
    const includedFeeds = feeds.filter(f => activeBundleObj.feedIds.includes(f.id));
    includedFeeds.forEach(feed => {
      feed.articles.forEach(art => {
        activeArticles.push({
          ...art,
          feedName: feed.title
        });
      });
    });
  }
  // Sort by pubDate descending
  activeArticles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

  // Quick preset questions inside the chat panel
  const chatPresets = [
    "📝 提取最新亮点速读",
    "🔍 分析文章的主要研究事实",
    "💼 总结行业核心科技动向",
    "🌍 归纳近24小时的信息焦点"
  ];

  return (
    <div className="flex h-screen w-full bg-[#0A0A0B] text-slate-200 font-sans overflow-hidden">
      
      {/* Mobile sidebar overlay background */}
      {isMobileSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/70 z-40 md:hidden" 
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* ================= LEFT SIDEBAR ================= */}
      <aside className={`
        fixed top-0 bottom-0 left-0 w-80 bg-[#0F0F11] border-r border-[#1e293b]/70 flex flex-col shrink-0 z-50 transition-transform duration-300 md:relative md:translate-x-0 md:z-auto
        ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        
        {/* Core Header */}
        <div className="p-6 border-b border-spacing-1 border-slate-800/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/10 shrink-0">
              <Rss className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-md font-semibold tracking-tight text-white mb-0.5 truncate">MedRss Ai</h1>
              <p className="text-[10px] text-slate-400/80 uppercase tracking-widest font-mono truncate">Any Web to RSS</p>
            </div>
          </div>
          
          {/* Mobile sidebar close button */}
          <button
            type="button"
            onClick={() => setIsMobileSidebarOpen(false)}
            className="md:hidden p-1.5 bg-slate-855/20 hover:bg-slate-800 text-slate-405 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Global Stats */}
        <div className="px-6 py-3 border-b border-slate-800/40 bg-slate-800/10 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${settings.autoUpdate ? "bg-emerald-400" : "bg-amber-400"}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${settings.autoUpdate ? "bg-emerald-500" : "bg-amber-500"}`}></span>
            </span>
            <span className="text-[10px] text-zinc-400">
              {settings.autoUpdate ? `${settings.updateIntervalHours}小时自动抓取中` : "自动后台抓取已关闭"}
            </span>
          </div>
          <span className="text-[10px] font-mono bg-indigo-505 bg-indigo-500/15 text-indigo-400 px-2 py-0.5 rounded">
            API 正常
          </span>
        </div>

        {/* Interactive Scroll Body */}
        <div className="flex-1 p-5 overflow-y-auto space-y-6">
          
          {/* Section 1: Tracked Feeds (Our RSS Engines) */}
          <div>
            <div className="flex justify-between items-center mb-3 px-1">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">
                已生成网站订阅源 ({feeds.length})
              </div>
              <button 
                onClick={() => setShowAddFeedModal(true)}
                className="p-1 hover:bg-indigo-600/10 hover:text-indigo-400 text-slate-400 rounded-md transition-all"
                title="转换新网页至 RSS"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {feeds.length === 0 ? (
              <div className="p-4 bg-slate-900/40 border border-slate-800/60 rounded-xl text-center">
                <p className="text-xs text-slate-500 line-clamp-2">暂无订阅源。请点击右侧 [+] 按钮输入任意网站进行一键抓取转换！</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {feeds.map(feed => {
                  const isSelected = selectedFeedId === feed.id;
                  return (
                    <div 
                      key={feed.id} 
                      onClick={() => {
                        setSelectedFeedId(feed.id);
                        setSelectedBundleId(null);
                        setIsMobileSidebarOpen(false);
                      }}
                      className={`p-3 border rounded-xl hover:border-slate-700/80 transition-all cursor-pointer ${
                        isSelected 
                          ? 'bg-indigo-600/10 border-indigo-500 text-white shadow-lg shadow-indigo-500/5' 
                          : 'bg-[#161619] border-slate-800/60 text-slate-300 hover:bg-[#1a1a1e]'
                      }`}
                    >
                    <div className="flex justify-between items-start mb-1">
                      <h4 className="text-xs font-semibold text-slate-200 truncate pr-2" title={feed.title}>
                        {feed.title}
                      </h4>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => triggerFeedRefresh(feed.id)}
                          disabled={isRefreshingFeedId === feed.id}
                          className="p-1 text-slate-500 hover:text-indigo-400 rounded-md transition-all"
                          title="强制重新同步最新文章"
                        >
                          <RefreshCw className={`w-3 h-3 ${isRefreshingFeedId === feed.id ? 'animate-spin text-indigo-400' : ''}`} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmTarget({ id: feed.id, name: feed.title, type: "feed" });
                          }}
                          className="p-1 text-slate-500 hover:text-rose-400 rounded-md transition-all"
                          title="删除源"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    
                    <p className="text-[10px] text-slate-500 truncate mb-2">{feed.url}</p>
                    
                    <div className="flex items-center justify-between text-[9px] text-slate-400 font-mono">
                      <span className="flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5 shrink-0" />
                        {new Date(feed.last_updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="bg-[#242429] text-slate-300 px-1.5 py-0.5 rounded">
                        文章: {feed.articles?.length || 0}
                      </span>
                    </div>

                    {/* Original RSS Feed Export */}
                    <div className="mt-2 pt-2 border-t border-slate-800/30 flex justify-between items-center bg-[#1b1b1f]/30 px-1 py-0.5 rounded">
                      <span className="text-[10px] text-slate-500">外部订阅 XML</span>
                      <button
                        onClick={() => handleCopyToClipboard(`${window.location.origin}/rss/feed/${feed.id}`, `feedxml-${feed.id}`)}
                        className="text-[9px] text-indigo-400 hover:underline flex items-center gap-1"
                      >
                        {copiedTextId === `feedxml-${feed.id}` ? (
                          <>已复制 <Check className="w-2.5 h-2.5 text-emerald-400" /></>
                        ) : (
                          <>复制链接 <Copy className="w-2.5 h-2.5" /></>
                        )}
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 2: Bundles (Merged Packages) */}
          <div>
            <div className="flex justify-between items-center mb-3 px-1">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">
                合并订阅包 ({bundles.length})
              </div>
              <button 
                onClick={() => setShowAddBundleModal(true)}
                className="p-1 hover:bg-emerald-600/10 hover:text-emerald-400 text-slate-400 rounded-md transition-all"
                title="创建新 RSS 包"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {bundles.length === 0 ? (
              <div className="p-4 bg-slate-900/40 border border-slate-800/60 rounded-xl text-center">
                <p className="text-xs text-slate-500 line-clamp-2">
                  无订阅包。你可以将上述多个网页源打包成一个专属 RSS 订阅包。
                </p>
                <button
                  onClick={() => setShowAddBundleModal(true)}
                  className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 font-medium inline-flex items-center gap-1"
                >
                  去创建第一个 <Plus className="w-3" />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {bundles.map(bundle => {
                  const isSelected = selectedBundleId === bundle.id;
                  return (
                    <div 
                      key={bundle.id}
                      onClick={() => {
                        setSelectedBundleId(bundle.id);
                        setSelectedFeedId(null);
                        setIsChatOpen(true);
                        setIsMobileSidebarOpen(false);
                      }}
                      className={`p-3 rounded-xl cursor-pointer transition-all border ${
                        isSelected 
                          ? 'bg-indigo-600/10 border-indigo-500 text-white shadow-lg shadow-indigo-500/5' 
                          : 'bg-[#121215] border-slate-800 hover:border-slate-700 text-slate-300 hover:bg-[#17171a]'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-indigo-400 animate-pulse' : 'bg-slate-500'}`} />
                          <h4 className="text-xs font-semibold truncate max-w-[150px]">{bundle.name}</h4>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmTarget({ id: bundle.id, name: bundle.name, type: "bundle" });
                          }}
                          className="p-1 text-slate-500 hover:text-rose-400 rounded-md hover:bg-slate-800/50"
                          title="解散合并包"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>

                      <p className="text-[10px] text-slate-500 truncate mb-2">{bundle.description}</p>
                      
                      <div className="flex justify-between items-center text-[9px] font-mono">
                        <span className="text-slate-400">包含源: {bundle.feedIds?.length || 0} 个</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyToClipboard(`${window.location.origin}/rss/bundle/${bundle.id}`, `bundlexml-${bundle.id}`);
                          }}
                          className="text-indigo-400 hover:underline flex items-center gap-1 bg-[#1e1e24] px-1.5 py-0.5 rounded shrink-0"
                        >
                          {copiedTextId === `bundlexml-${bundle.id}` ? (
                            <>已复制 <Check className="w-2.5 h-2.5 text-emerald-400" /></>
                          ) : (
                            <>复制合并 RSS <Copy className="w-2.5 h-2.5" /></>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          
        </div>

        {/* User Workspace Info & App Credits */}
        <div className="p-4 border-t border-slate-800/80 bg-[#0A0A0B] flex flex-col gap-1 text-[10px] text-slate-500">
          <div className="flex justify-between">
            <span>数据存储位置</span>
            <span className="font-mono text-slate-400">data/db.json</span>
          </div>
          <div className="flex justify-between">
            <span>AI 大模型内核</span>
            <span className="font-mono text-indigo-400">
              {useCustomAi ? customAiModel : "Gemini 1.5 Flash"}
            </span>
          </div>
        </div>
      </aside>

      {/* ================= MAIN CONTENT WORKSPACE ================= */}
      <main className="flex-1 flex flex-col bg-[#0D0D0E] overflow-hidden">
        
        {/* Top Header info */}
        <header className="h-16 border-b border-slate-800/80 px-4 md:px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            {/* Hamburger toggle button on mobile */}
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              className="md:hidden p-2 hover:bg-slate-800/50 text-slate-400 hover:text-white rounded-xl shrink-0 transition-colors"
              title="打开导航菜单"
            >
              <Menu className="w-5 h-5" />
            </button>

            {selectedFeedId ? (
              <>
                <span className="text-slate-500 text-sm hidden sm:inline">当前订阅源</span>
                <span className="text-slate-600 hidden sm:inline">/</span>
                {feeds.find(f => f.id === selectedFeedId) ? (
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-white font-semibold text-sm md:text-md truncate">
                      {feeds.find(f => f.id === selectedFeedId)?.title}
                    </span>
                    <span className="text-[10px] bg-[#6366f1]/20 text-indigo-300 px-2 py-0.5 rounded-full font-mono shrink-0">
                      共计 {feeds.find(f => f.id === selectedFeedId)?.articles?.length || 0} 篇
                    </span>
                  </div>
                ) : (
                  <span className="text-slate-400 italic text-sm">加载中...</span>
                )}
              </>
            ) : (
              <>
                <span className="text-slate-500 text-sm hidden sm:inline">当前合并包</span>
                <span className="text-slate-600 hidden sm:inline">/</span>
                {activeBundleObj ? (
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-white font-semibold text-sm md:text-md truncate">{activeBundleObj.name}</span>
                    <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-mono shrink-0">
                      共计 {activeArticles.length} 篇最新内容
                    </span>
                  </div>
                ) : (
                  <span className="text-slate-400 italic text-xs md:text-sm truncate">请在左侧菜单选择或添加</span>
                )}
              </>
            )}
          </div>
          
          <div className="flex items-center gap-2 md:gap-4 shrink-0">
            {selectedBundleId && (
              <button
                type="button"
                onClick={() => setIsChatOpen(!isChatOpen)}
                className={`px-3 py-1.5 md:px-3.5 border rounded-full text-[11px] font-semibold inline-flex items-center gap-1.5 transition-all outline-none shrink-0 ${
                  isChatOpen
                    ? "bg-indigo-600 hover:bg-indigo-700 border-indigo-505 text-white shadow-lg shadow-indigo-600/20"
                    : "bg-slate-800/60 hover:bg-slate-705 border-slate-705 text-slate-300 hover:text-indigo-300"
                }`}
                title={isChatOpen ? "关闭 AI 对话" : "开启 AI 对话"}
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="hidden sm:inline">{isChatOpen ? "关闭 AI 对话" : "开启 AI 对话"}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setActiveSettingsTab("update"); // Default to update tab when opened
                setShowSettingsModal(true);
              }}
              className="px-3 py-1.5 md:px-3.5 bg-slate-800/60 hover:bg-indigo-650/10 hover:border-indigo-505/20 border border-slate-705 text-slate-300 hover:text-indigo-300 rounded-full text-[11px] font-semibold inline-flex items-center gap-1.5 transition-all outline-none shrink-0"
              title="系统设置"
            >
              <Settings className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span className="hidden sm:inline">系统设置</span>
            </button>
            <div className="hidden lg:flex items-center gap-2 text-[11px] text-slate-400 bg-slate-800/[0.35] px-3.5 py-1.5 rounded-full border border-slate-800/50 shrink-0">
              <span className={`animate-pulse w-1.5 h-1.5 rounded-full ${settings.autoUpdate ? "bg-indigo-400" : "bg-amber-400"}`}></span>
              {settings.autoUpdate ? `${settings.updateIntervalHours}小时智能抓取` : "手动抓取模式"}
            </div>
            <div className="hidden md:block h-8 w-px bg-slate-800 shrink-0"></div>
            <div className="hidden md:flex items-center gap-2 shrink-0">
              <span className="text-xs text-slate-400 text-right">
                <span className="block text-slate-300 font-medium">管理员会话</span>
                <span className="block text-[9px] text-slate-500">graciegt2023</span>
              </span>
              <img 
                src="https://ui-avatars.com/api/?name=Flux+User&background=6366f1&color=fff&size=64&bold=true" 
                className="w-8 h-8 rounded-full border border-slate-700" 
                alt="Avatar"
              />
            </div>
          </div>
        </header>

        {/* Global Alert Overlay container */}
        {errorAlert && (
          <div className="mx-6 mt-4 p-4 bg-rose-950/30 border border-rose-900/40 rounded-xl text-rose-200 text-xs flex items-center gap-3 animate-fade-in relative z-20">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <div className="flex-1">{errorAlert}</div>
          </div>
        )}

        {infoMessage && (
          <div className="mx-6 mt-4 p-4 bg-indigo-950/20 border border-indigo-900/30 rounded-xl text-indigo-200 text-xs flex items-center gap-3 animate-fade-in relative z-20">
            <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
            <div className="flex-1 font-medium">{infoMessage}</div>
          </div>
        )}

        {/* No selection default screen */}
        {!selectedBundleId && !selectedFeedId ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-400 space-y-4">
            <Layers className="w-16 h-16 text-slate-700 animate-pulse" />
            <div>
              <h2 className="text-lg font-medium text-white mb-2">欢迎来到 MedRss AI</h2>
              <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                这里能够将任何不支持 RSS 的博客、新闻栏目及科技门户转换成高度标准的 RSS Feed，支持每隔 24h 自动重载刷新，并提供 AI 深度全文交互对话！
              </p>
            </div>
            <div className="flex gap-4">
              <button 
                onClick={() => setShowAddFeedModal(true)}
                className="px-4 py-2 bg-[#1b1b1f] hover:bg-[#25252b] border border-slate-800 rounded-lg text-xs font-semibold text-slate-300 transition-colors"
              >
                1. 转换网站源
              </button>
              <button 
                onClick={() => setShowAddBundleModal(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-xs font-semibold text-white transition-colors"
              >
                2. 合并成打包包
              </button>
            </div>
          </div>
        ) : selectedFeedId ? (
          /* ================= SINGLE FEED CARDS VIEW ================= */
          <div className="flex-1 overflow-y-auto bg-[#0A0A0B]/30 p-4 md:p-8 flex flex-col space-y-4 md:space-y-6">
            {(() => {
              const currentFeed = feeds.find(f => f.id === selectedFeedId);
              if (!currentFeed) {
                return (
                  <div className="p-8 text-center text-slate-500">
                    <p>正在拉取源内容详情中...</p>
                  </div>
                );
              }
              return (
                <div className="space-y-6 animate-fade-in">
                  {/* Feed Header Detail Block */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 md:p-6 bg-[#121215] border border-slate-800/80 rounded-2xl shadow-xl">
                    <div className="space-y-2 max-w-2xl">
                      <div className="flex items-center gap-3">
                        <span className="p-2.5 bg-indigo-600/15 text-indigo-400 rounded-xl border border-indigo-500/10">
                          <Rss className="w-5 h-5" />
                        </span>
                        <div>
                          <h2 className="text-md font-bold text-white tracking-tight">{currentFeed.title}</h2>
                          <p className="text-[11px] text-slate-500 mt-0.5">{currentFeed.url}</p>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed mt-2 pl-1 select-text">
                        最后自动抓取重对齐 : <span className="text-indigo-400 font-mono font-semibold">{new Date(currentFeed.last_updated_at).toLocaleString()}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <button
                        onClick={() => triggerFeedRefresh(currentFeed.id)}
                        disabled={isRefreshingFeedId === currentFeed.id}
                        className="px-3.5 py-2 bg-[#1b1b1f] hover:bg-[#25252b] border border-slate-800 text-slate-200 hover:text-white rounded-xl text-xs font-medium inline-flex items-center gap-2 transition-all"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingFeedId === currentFeed.id ? 'animate-spin text-indigo-400' : ''}`} />
                        {isRefreshingFeedId === currentFeed.id ? "拉取同步中..." : "重新抓取更新"}
                      </button>

                      <button
                        onClick={() => handleCopyToClipboard(`${window.location.origin}/rss/feed/${currentFeed.id}`, `feedxml-det-${currentFeed.id}`)}
                        className="px-3.5 py-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition-all shadow-md shadow-indigo-500/10"
                      >
                        {copiedTextId === `feedxml-det-${currentFeed.id}` ? (
                          <>已复制 <Check className="w-3.5 h-3.5 text-emerald-300" /></>
                        ) : (
                          <>复制 RSS 链接 <Copy className="w-3.5 h-3.5" /></>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Dual Export Feature Card */}
                  <div className="p-4 md:p-5 bg-gradient-to-r from-indigo-950/25 via-[#121215] to-[#121215] border border-indigo-500/15 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg animate-fade-in select-none">
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-slate-300 dark:text-indigo-300 flex items-center gap-1.5ClassName">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                        订阅源全量静态化与开发框架多态导出
                      </h4>
                      <p className="text-[10px] text-slate-400 leading-relaxed max-w-xl">
                        此功能将当前源缓存的所有首图、AI 提炼与完整正文打包。支持一键转存为 <strong>交互式 HTML 离线单页 (含多网页主题搜索阅读器)</strong> 或 <strong>React + Vite + Tailwind 独立前端项目源码 ZIP</strong>！
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <a
                        href={`/api/export/html?feedId=${currentFeed.id}`}
                        download
                        className="px-3.5 py-2 bg-[#17171c] hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-800 hover:border-indigo-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md"
                      >
                        <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                        <span>导出 HTML 离线阅读</span>
                      </a>
                      <a
                        href={`/api/export/react-vite?feedId=${currentFeed.id}`}
                        download
                        className="px-3.5 py-2 bg-[#6366f1] hover:bg-indigo-600 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-indigo-600/10"
                      >
                        <Layers className="w-3.5 h-3.5 text-white" />
                        <span>导出 React/Vite 源码</span>
                      </a>
                    </div>
                  </div>

                  {/* Feed Article Cards Grid */}
                  <div className="space-y-4">
                    <div className="flex justify-between items-center px-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">文章卡片列表</h3>
                        {/* Interactive toggle switch for fast Filtering */}
                        <div className="flex bg-[#121215] border border-slate-800 rounded-lg p-0.5 select-none">
                          <button
                            type="button"
                            onClick={() => setFilterUnreadOnly(false)}
                            className={`px-2.5 py-1 text-[10px] font-medium rounded transition-all flex items-center gap-1.5 ${
                              !filterUnreadOnly
                                ? "bg-indigo-600 text-white font-bold"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            全部
                          </button>
                          <button
                            type="button"
                            onClick={() => setFilterUnreadOnly(true)}
                            className={`px-2.5 py-1 text-[10px] font-medium rounded transition-all flex items-center gap-1.5 ${
                              filterUnreadOnly
                                ? "bg-indigo-600 text-white font-bold"
                                : "text-slate-450 hover:text-slate-200"
                            }`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            未读 ({(currentFeed.articles || []).filter(art => !readUrls[art.url]).length})
                          </button>
                        </div>
                      </div>
                      <span className="text-xs text-slate-500 font-mono">共计 {currentFeed.articles?.length || 0} 篇</span>
                    </div>

                    {!currentFeed.articles || currentFeed.articles.length === 0 ? (
                      <div className="p-12 bg-[#121215]/50 border border-slate-800/80 rounded-2xl text-center space-y-3">
                        <Compass className="w-12 h-12 text-slate-700 mx-auto animate-pulse" />
                        <p className="text-xs text-slate-400">
                          该订阅源下目前暂未提取到任何文章。
                        </p>
                        <button
                          onClick={() => triggerFeedRefresh(currentFeed.id)}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold"
                        >
                          立即强制更新抓取
                        </button>
                      </div>
                    ) : (
                      (() => {
                        const filtered = [...currentFeed.articles]
                          .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
                          .filter(art => !filterUnreadOnly || !readUrls[art.url]);

                        if (filtered.length === 0) {
                          return (
                            <div className="p-12 bg-[#121215]/30 border border-slate-800/80 rounded-2xl text-center space-y-2.5">
                              <Check className="w-8 h-8 text-emerald-400 mx-auto" />
                              <p className="text-xs text-slate-400">
                                选项下暂无内容。如果是未读筛选，说明您已全部阅读完毕！
                              </p>
                            </div>
                          );
                        }

                        return (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {filtered.map((art, idx) => (
                              <ArticleCard
                                key={art.id + "-" + idx}
                                art={art}
                                useCustomAi={useCustomAi}
                                customAiBaseUrl={customAiBaseUrl}
                                customAiApiKey={customAiApiKey}
                                customAiModel={customAiModel}
                                isRead={!!readUrls[art.url]}
                                onToggleRead={() => handleToggleRead(art.url)}
                                onMarkAsRead={() => handleMarkAsRead(art.url)}
                              />
                            ))}
                          </div>
                        );
                      })()
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          /* ================= TWO PANELS ACTIVE WORKSPACE ================= */
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            
            {/* Tab switch bar for mobile screens when chat is open */}
            {isChatOpen && (
              <div className="flex md:hidden border-b border-slate-850 bg-[#0F0F11] shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveTab("articles")}
                  className={`flex-1 py-3 text-center text-xs font-semibold border-b-2 transition-all ${
                    activeTab === "articles"
                      ? "border-indigo-500 text-white bg-indigo-600/5 font-bold"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  文章列表 ({activeArticles.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("chat")}
                  className={`flex-1 py-3 text-center text-xs font-semibold border-b-2 transition-all ${
                    activeTab === "chat"
                      ? "border-indigo-500 text-white bg-indigo-600/5 font-bold"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  AI 智能对话
                </button>
              </div>
            )}

            {/* Split Panel Left - Custom Tracked Articles inside active bundle */}
            <div className={`border-r border-[#1e293b]/70 flex flex-col overflow-hidden bg-[#0A0A0B]/30 transition-all duration-300 w-full ${
              isChatOpen ? 'md:w-[58%]' : 'w-full'
            } ${isChatOpen && activeTab !== "articles" ? 'hidden md:flex' : 'flex'}`}>
              
              <div className="p-4 md:p-6 border-b border-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-indigo-400" />
                    <h2 className="text-sm font-semibold text-white">订阅合并包文档</h2>
                  </div>
                  
                  {/* Interactive filter toggle for Bundle View */}
                  <div className="flex bg-[#121215] border border-slate-800 rounded-lg p-0.5 select-none text-[10px]">
                    <button
                      type="button"
                      onClick={() => setFilterUnreadOnly(false)}
                      className={`px-2.5 py-0.5 rounded transition-all font-medium ${
                        !filterUnreadOnly
                          ? "bg-indigo-600 text-white font-bold"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      全部
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterUnreadOnly(true)}
                      className={`px-2.5 py-0.5 rounded transition-all font-medium flex items-center gap-1 ${
                        filterUnreadOnly
                          ? "bg-indigo-600 text-white font-bold"
                          : "text-slate-450 hover:text-slate-200"
                      }`}
                    >
                      <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse"></span>
                      未读 ({activeArticles.filter(art => !readUrls[art.url]).length})
                    </button>
                  </div>

                  <span className="text-[10px] bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded-md border border-indigo-505/15">
                    共 {activeArticles.length} 篇最新内容
                  </span>
                </div>
                
                <button
                  onClick={() => setIsChatOpen(!isChatOpen)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 border transition-all ${
                    isChatOpen
                      ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                      : 'bg-indigo-600/10 hover:bg-indigo-600/20 border-indigo-500/20 text-indigo-400'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isChatOpen ? "关闭 AI 对话" : "开启 AI 对话"}
                </button>
              </div>

              {/* Articles dynamic list content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {activeArticles.length > 0 && !isChatOpen && (
                  <div className="p-4 bg-indigo-600/10 border border-indigo-500/20 rounded-xl flex items-center justify-between gap-4 animate-fade-in">
                    <div className="space-y-0.5">
                      <h4 className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                        智能 AI 阅览对话助手已就绪
                      </h4>
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        大模型会自动抓取并解析本包中每个订阅源最新文章的完整正文（清理网页广告和无关代码）。点击右上角【开启 AI 对话】，可让 AI 帮您翻译翻译、一键生成今日科技快讯摘要！
                      </p>
                    </div>
                    <button
                      onClick={() => setIsChatOpen(true)}
                      className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shrink-0 transition-colors shadow-lg shadow-indigo-500/15"
                    >
                      立即对话
                    </button>
                  </div>
                )}

                {/* Combined Bundle Exporter Panel */}
                {activeArticles.length > 0 && (
                  <div className="p-4 bg-gradient-to-r from-emerald-950/20 via-[#121215] to-[#121215] border border-emerald-500/15 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg animate-fade-in select-none">
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-slate-350 dark:text-emerald-400 flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-emerald-400" />
                        合并包批量静态化与开发框架多态导出
                      </h4>
                      <p className="text-[10px] text-slate-400 leading-relaxed max-w-xl">
                        一键将此订阅合并包内的全部文章打包归档，导出为 <strong>互动式 HTML 离线单页 (含多网页主题搜索阅读器)</strong> 或是 <strong>React + Vite + Tailwind 独立源码 ZIP 项目包</strong>！
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <a
                        href={`/api/export/html?bundleId=${activeBundleObj?.id}`}
                        download
                        className="px-3.5 py-2 bg-[#17171c] hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-800 hover:border-emerald-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md"
                      >
                        <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
                        <span>导出 HTML 离线阅读</span>
                      </a>
                      <a
                        href={`/api/export/react-vite?bundleId=${activeBundleObj?.id}`}
                        download
                        className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-emerald-600/15"
                      >
                        <Layers className="w-3.5 h-3.5 text-white" />
                        <span>导出 React/Vite 源码</span>
                      </a>
                    </div>
                  </div>
                )}

                {activeArticles.length === 0 ? (
                  <div className="p-8 bg-slate-900/30 border border-slate-850 rounded-xl text-center space-y-3">
                    <Compass className="w-10 h-10 text-slate-700 mx-auto" />
                    <p className="text-xs text-slate-500 leading-relaxed">
                      此订阅包包含的网站源目前暂未抓取/尚未包含任何文章。
                    </p>
                    {activeBundleObj && (
                      <div className="text-xs text-slate-400">
                        您可以为该合并包底下的源网站强制执行
                        <span className="text-indigo-400 font-semibold">【手动重新同步】</span>
                        进行一页抓取。
                      </div>
                    )}
                  </div>
                ) : (
                  (() => {
                    const filtered = activeArticles.filter(art => !filterUnreadOnly || !readUrls[art.url]);

                    if (filtered.length === 0) {
                      return (
                        <div className="p-12 bg-[#121215]/30 border border-slate-800/80 rounded-2xl text-center space-y-2.5">
                          <Check className="w-8 h-8 text-emerald-400 mx-auto" />
                          <p className="text-xs text-slate-400">
                            合并订阅包在该选项下当前无文章内容。如果是未读筛选，说明您已全部阅读完毕！
                          </p>
                        </div>
                      );
                    }

                    return (
                      <div className={`grid gap-5 ${isChatOpen ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
                        {filtered.map((art, index) => (
                          <ArticleCard
                            key={art.id + "-" + index}
                            art={art}
                            useCustomAi={useCustomAi}
                            customAiBaseUrl={customAiBaseUrl}
                            customAiApiKey={customAiApiKey}
                            customAiModel={customAiModel}
                            isCompact={isChatOpen}
                            isRead={!!readUrls[art.url]}
                            onToggleRead={() => handleToggleRead(art.url)}
                            onMarkAsRead={() => handleMarkAsRead(art.url)}
                          />
                        ))}
                      </div>
                    );
                  })()
                )}
              </div>
            </div>

            {/* Split Panel Right - AI Bundle Assistant Drawer style */}
            {isChatOpen && (
              <div className={`w-full md:w-[42%] flex flex-col bg-[#0D0D0E] border-l border-slate-800/80 animate-fade-in ${
                activeTab === "chat" ? "flex" : "hidden md:flex"
              }`}>
                
                {/* Chat Top Info header bar */}
                <div className="p-6 border-b border-slate-800/40 flex justify-between items-center shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 bg-indigo-500/20 text-indigo-400 rounded-lg flex items-center justify-center border border-indigo-500/20 shrink-0">
                      <Sparkles className="w-3.5 h-3.5 animation-pulse" />
                    </div>
                    <div>
                      <h2 className="text-xs font-bold text-white tracking-wider uppercase">AI 智能文章包对话</h2>
                      <p className="text-[10px] text-slate-500">自动承载打包中所有订阅的正文上下文进行分析</p>
                    </div>
                  </div>

                  <button 
                    onClick={clearActiveChatHistory}
                    className="text-[10px] text-slate-400 hover:text-rose-450 font-medium transition-colors border border-slate-800/80 hover:border-rose-950 px-2.5 py-1 rounded-lg"
                  >
                    重置
                  </button>
                </div>

                {/* Chat Messages Scrolling content */}
                <div 
                  ref={chatScrollRef}
                  className="flex-1 overflow-y-auto p-6 space-y-6"
                >
                  {/* Default Welcome Message from AI */}
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-lg bg-indigo-600 shrink-0 flex items-center justify-center text-white text-xs font-bold">
                      AI
                    </div>
                    <div className="max-w-xl bg-[#141416] border border-slate-800/80 p-4 rounded-xl rounded-tl-none">
                      <p className="text-xs leading-relaxed text-slate-300">
                        您好！我是您的合并包 AI 阅览助手。我已经对齐并解析出了当前合并包中的正文。
                      </p>
                      <p className="text-[11px] leading-relaxed text-slate-400 mt-2">
                        您可以让我“翻译选定核心内容”、“总结今天的科技新闻”或“提炼分析主要干货”。
                      </p>
                    </div>
                  </div>

                  {/* Map real history messages */}
                  {selectedBundleId && (chatMessages[selectedBundleId] || []).map((msg) => {
                    const isUser = msg.role === 'user';
                    return (
                      <div 
                        key={msg.id}
                        className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
                      >
                        {isUser ? (
                          <div className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-500 font-bold shrink-0 flex items-center justify-center text-[10px] text-indigo-300">
                            我
                          </div>
                        ) : (
                          <div className="w-7 h-7 rounded-lg bg-indigo-600 shrink-0 flex items-center justify-center text-white text-xs font-bold">
                            AI
                          </div>
                        )}

                        <div className={`max-w-[85%] p-3.5 rounded-xl ${
                          isUser 
                            ? 'bg-indigo-600/20 border border-indigo-500/30 rounded-tr-none text-indigo-150' 
                            : 'bg-[#141416]/80 border border-slate-800/60 rounded-tl-none text-slate-300'
                        } text-xs leading-relaxed whitespace-pre-line font-sans`}>
                          {msg.text}
                        </div>
                      </div>
                    );
                  })}

                  {/* AI Typings indicator placeholder */}
                  {isGeneratingReply && (
                    <div className="flex gap-3">
                      <div className="w-7 h-7 rounded-lg bg-indigo-600 shrink-0 flex items-center justify-center text-white text-xs font-bold">
                        AI
                      </div>
                      <div className="max-w-xs bg-[#141416] border border-slate-800/80 p-3.5 rounded-xl rounded-tl-none text-slate-400 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                          </span>
                          <span>正在代理爬取全文并对齐大模型中...</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Instant Clicking Presets Block */}
                {activeArticles.length > 0 && (
                  <div className="px-6 py-3 border-t border-slate-800/60 bg-[#0e0e11] shrink-0">
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 mb-2 uppercase font-mono tracking-wider font-semibold">
                      <Sparkles className="w-3 h-3 text-indigo-400 animate-pulse" />
                      点击快速推荐问题:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {chatPresets.map((preset, i) => (
                        <button
                          key={i}
                          onClick={() => handleSendChatMessage(preset)}
                          disabled={isGeneratingReply}
                          className="text-[10px] bg-[#161619] hover:bg-slate-800/80 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-800/85 hover:border-slate-705 transition-all text-left"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Chat Input form area */}
                <div className="p-6 border-t border-slate-800/70 bg-[#09090b]/80 shrink-0">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={clearActiveChatHistory}
                      title="清空当前历史对话内容"
                      disabled={!selectedBundleId || (chatMessages[selectedBundleId] || []).length === 0}
                      className="px-3 bg-red-950/25 hover:bg-rose-900/40 border border-rose-950 hover:border-rose-800 text-rose-400 disabled:opacity-20 disabled:pointer-events-none rounded-xl transition-all flex items-center justify-center shrink-0"
                    >
                      <Trash2 className="w-4 h-4 cursor-pointer" />
                    </button>
                    <div className="relative flex-1">
                      <input 
                        type="text" 
                        value={currentChatInput}
                        onChange={(e) => setCurrentChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleSendChatMessage();
                          }
                        }}
                        placeholder={activeArticles.length === 0 ? "该包底下空空如也，请先添加订阅源并在上方提取..." : "输入消息让 AI 总结或翻译某篇文章..."}
                        disabled={isGeneratingReply || activeArticles.length === 0}
                        className="w-full bg-[#141416] border border-slate-800/80 rounded-xl pl-4 pr-12 py-3 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 disabled:opacity-50"
                      />
                      <button 
                        onClick={() => handleSendChatMessage()}
                        disabled={isGeneratingReply || !currentChatInput.trim() || activeArticles.length === 0}
                        type="button"
                        className="absolute right-2 top-1.5 p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="text-[9px] text-center text-slate-650 mt-3 pt-0.5 uppercase tracking-wide font-mono flex items-center justify-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-emerald-500 animate-ping"></span>
                    <span>
                      {useCustomAi 
                        ? `自定义 API端点已启用 (模型: ${customAiModel})` 
                        : "Powered by Gemini 1.5 内置安全解析"
                      }
                    </span>
                  </div>
                </div>

              </div>
            )}

          </div>
        )}

      </main>

      {/* ================= MODAL: ADD SOURCE WEBPAGE ================= */}
      {showAddFeedModal && (
        <div className="fixed inset-0 bg-[#000000]/80 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-[#121215] border border-slate-800 max-w-md w-full rounded-2xl overflow-hidden shadow-2xl">
            
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Rss className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">转换新网址生成 RSS 源</h3>
              </div>
              <button 
                onClick={() => setShowAddFeedModal(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕ 关闭
              </button>
            </div>

            <form onSubmit={createNewFeed} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block">
                  目标网站 URL 地址
                </label>
                <input 
                  type="url" 
                  value={feedUrlInput}
                  onChange={(e) => setFeedUrlInput(e.target.value)}
                  placeholder="https://e.g. news.ycombinator.com"
                  required
                  disabled={isScrapingFeed}
                  className="w-full bg-[#1A1A1C] border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-100 placeholder:text-slate-650 focus:outline-none focus:border-indigo-500"
                />
                <span className="text-[10px] text-slate-500 block leading-relaxed">
                  * 支持任何传统无 RSS Feed 输出的普通网站、科技媒体、极客博客或新闻板块。{useCustomAi ? `${customAiModel} 模型` : "Gemini"} 将会自动扫描 HTML 片段，提取标题并进行定期 24h 信息更新。
                </span>
              </div>

              {isScrapingFeed && (
                <div className="p-3 bg-indigo-950/20 border border-indigo-900/35 rounded-xl space-y-2 text-indigo-300">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="animate-spin text-indigo-400">⚡</span>
                    <span className="font-semibold text-slate-200">AI 正在深度解析网页...</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    系统正在拉取原生 HTML，并指派 {useCustomAi ? customAiModel : "Gemini"} 大模型分析核心新闻、链接、日期特征：
                  </p>
                  <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                    <div className="bg-indigo-500 h-full animate-pulse w-3/4"></div>
                  </div>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-2 border-t border-slate-800">
                <button 
                  type="button"
                  onClick={() => setShowAddFeedModal(false)}
                  disabled={isScrapingFeed}
                  className="px-4 py-2 bg-[#1b1b1f] hover:bg-[#25252b] text-slate-400 hover:text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  disabled={isScrapingFeed}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  {isScrapingFeed ? "生成中..." : "开始一键转换为 RSS"}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: CREATE SUBSCRIPTION BUNDLE ================= */}
      {showAddBundleModal && (
        <div className="fixed inset-0 bg-[#000000]/80 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-[#121215] border border-slate-800 max-w-md w-full rounded-2xl overflow-hidden shadow-2xl">
            
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">组合封装多个订阅源</h3>
              </div>
              <button 
                onClick={() => setShowAddBundleModal(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕ 关闭
              </button>
            </div>

            <form onSubmit={createNewBundle} className="p-6 space-y-4">
              
              <div className="space-y-2">
                <label className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block">
                  合并包名称
                </label>
                <input 
                  type="text" 
                  value={bundleNameInput}
                  onChange={(e) => setBundleNameInput(e.target.value)}
                  placeholder="例如: 每日必读科技包"
                  required
                  className="w-full bg-[#1A1A1C] border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-100 placeholder:text-slate-650 focus:outline-[#10b981] focus:ring-0"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block">
                  简要描述 (可选)
                </label>
                <input 
                  type="text" 
                  value={bundleDescInput}
                  onChange={(e) => setBundleDescInput(e.target.value)}
                  placeholder="整理行业资讯、对齐竞争情报..."
                  className="w-full bg-[#1A1A1C] border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-100 placeholder:text-slate-650 focus:outline-[#10b981] focus:ring-0"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] text-slate-450 font-bold uppercase tracking-wider block">
                  选择打包进入的源网站 ({bundleCheckedFeeds.length} 已选)
                </label>
                <div className="max-h-[160px] overflow-y-auto border border-slate-800/80 rounded-xl bg-[#0f0f11] p-2 space-y-1">
                  {feeds.map(feed => (
                    <label key={feed.id} className="flex items-center gap-2.5 p-2 hover:bg-slate-900 rounded-lg cursor-pointer text-xs text-slate-300">
                      <input 
                        type="checkbox"
                        checked={bundleCheckedFeeds.includes(feed.id)}
                        onChange={() => {
                          if (bundleCheckedFeeds.includes(feed.id)) {
                            setBundleCheckedFeeds(bundleCheckedFeeds.filter(id => id !== feed.id));
                          } else {
                            setBundleCheckedFeeds([...bundleCheckedFeeds, feed.id]);
                          }
                        }}
                        className="rounded border-slate-800 text-indigo-600 focus:ring-indigo-500/30 bg-slate-950 w-3.5 h-3.5"
                      />
                      <span>{feed.title}</span>
                    </label>
                  ))}
                  {feeds.length === 0 && (
                    <div className="text-center py-6 text-slate-500">
                      暂无可用的订阅源，请先在下方添加
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-5 border-t border-slate-800">
                <button 
                  type="button"
                  onClick={() => setShowAddBundleModal(false)}
                  className="px-4 py-2 bg-[#1b1b1f] hover:bg-[#25252b] text-slate-400 hover:text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  disabled={isCreatingBundle || feeds.length === 0}
                  className="px-4 py-2 bg-[#10b981] hover:bg-[#059669] text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  确认打包
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div className="fixed inset-0 bg-[#000000]/80 flex items-center justify-center p-4 z-50 animate-fade-in animate-duration-200">
          <div className="bg-[#121215] border border-slate-800 max-w-md w-full rounded-2xl overflow-hidden shadow-2xl">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">系统运行与 AI 接口联合设置</h3>
              </div>
              <button 
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-400 hover:text-white text-xs transition-colors"
              >
                ✕ 关闭
              </button>
            </div>

            {/* Premium Tab Bar */}
            <div className="flex border-b border-slate-800/60 bg-[#0e0e11] select-none text-xs">
              <button
                type="button"
                onClick={() => setActiveSettingsTab("update")}
                className={`flex-1 py-3 font-semibold border-b-2 text-center transition-all flex items-center justify-center gap-1.5 ${
                  activeSettingsTab === "update"
                    ? "border-indigo-500 text-white bg-slate-900/10"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/5"
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>自动更新计划</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSettingsTab("ai")}
                className={`flex-1 py-3 font-semibold border-b-2 text-center transition-all flex items-center justify-center gap-1.5 ${
                  activeSettingsTab === "ai"
                    ? "border-indigo-500 text-white bg-slate-900/10"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/5"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI 大模型配置</span>
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
              
              {/* TAB 1: AUTO UPDATE PLAN */}
              {activeSettingsTab === "update" && (
                <div className="space-y-4 animate-fade-in">
                  <div className="flex items-center justify-between bg-slate-900/45 p-3.5 border border-slate-800/80 rounded-xl">
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">后台自动探测抓取</h4>
                      <p className="text-[10px] text-slate-500">开启后定时轮询刷新所有以添加的 RSS 订阅源</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUpdateSettings(prev => ({ ...prev, autoUpdate: !prev.autoUpdate }))}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        settings.autoUpdate ? 'bg-indigo-600' : 'bg-slate-800'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          settings.autoUpdate ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {settings.autoUpdate ? (
                    <div className="space-y-2.5 bg-slate-900/20 p-3.5 border border-slate-800/40 rounded-xl">
                      <label className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block">
                        自动更新间隔频率
                      </label>
                      <select
                        value={settings.updateIntervalHours}
                        onChange={(e) => handleUpdateSettings(prev => ({ ...prev, updateIntervalHours: parseInt(e.target.value) }))}
                        className="w-full bg-[#161619] border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-[#10b981] focus:ring-0"
                      >
                        <option value={1}>每 1 小时 抓取探测 (高频响应)</option>
                        <option value={2}>每 2 小时 抓取探测</option>
                        <option value={4}>每 4 小时 抓取探测 (推荐)</option>
                        <option value={8}>每 8 小时 抓取探测</option>
                        <option value={12}>每 12 小时 抓取探测</option>
                        <option value={24}>每 24 小时 抓取探测 (平缓轮询)</option>
                        <option value={48}>每 48 小时 抓取探测 (节省资源)</option>
                      </select>
                      <span className="text-[10px] text-slate-500 block leading-normal pt-1">
                        * 系统将在后台线程定期根据此时间阈值检查并自动增量提取源网站最新文章数据。
                      </span>
                    </div>
                  ) : (
                    <div className="p-4 bg-amber-500/5 border border-amber-500/10 rounded-xl">
                      <p className="text-[11px] text-amber-400 leading-relaxed">
                        ⚠️ **当前为全手动更新模式**: 自动后台抓取暂不可用。您需要手动在特定的订阅源主页点击 <strong>【重新拉取同步】</strong> 来更新最新资讯。
                      </p>
                    </div>
                  )}

                  <div className="p-3.5 bg-slate-900/60 border border-slate-800/80 rounded-xl text-[10px] text-slate-400 leading-normal">
                    💡 **更新机制**: 服务器使用 light-weight 定时任务进行智能周期探测，支持手动与自动无缝并存。
                  </div>
                </div>
              )}

              {/* TAB 2: AI CORE MODEL CONFIG */}
              {activeSettingsTab === "ai" && (
                <div className="space-y-4 animate-fade-in">
                  {/* Toggle Switch */}
                  <div className="flex items-center justify-between bg-slate-900/45 p-3.5 border border-slate-800/80 rounded-xl">
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">启用第三方大语言模型</h4>
                      <p className="text-[10px] text-slate-500">开启后将替代系统内置的官方 Gemini 1.5 Flash 接口</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={useCustomAi}
                        onChange={(e) => setUseCustomAi(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-slate-400 peer-checked:after:bg-indigo-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600/35"></div>
                    </label>
                  </div>

                  {/* Form inputs */}
                  <div className={`space-y-4 transition-all duration-200 ${useCustomAi ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                    
                    <div className="space-y-2">
                      <label className="text-[11px] text-slate-450 font-bold uppercase tracking-wider block">
                        大语言模型 Base URL (兼容 OpenAI 规格)
                      </label>
                      <input 
                        type="text" 
                        value={customAiBaseUrl}
                        onChange={(e) => setCustomAiBaseUrl(e.target.value)}
                        placeholder="https://api.deepseek.com/v1"
                        className="w-full bg-[#161619] border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-[#10b981] focus:ring-0"
                      />
                      <span className="text-[10px] text-slate-500 block leading-normal pt-1">
                        例如 DeepSeek: <code className="text-[9px] bg-slate-900 px-1 py-0.5 rounded text-indigo-300">https://api.deepseek.com/v1</code> 或 阿里通义: <code className="text-[9px] bg-slate-900 px-1.5 py-0.5 rounded text-indigo-300">https://dashscope.aliyuncs.com/compatible-mode/v1</code>
                      </span>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[11px] text-slate-450 font-bold uppercase tracking-wider block">
                        API Key (授权令牌)
                      </label>
                      <input 
                        type="password" 
                        value={customAiApiKey}
                        onChange={(e) => setCustomAiApiKey(e.target.value)}
                        placeholder="输入授权 API Key"
                        className="w-full bg-[#161619] border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-[#10b981] focus:ring-0"
                      />
                      <span className="text-[10px] text-slate-500 block">
                        * 秘钥储存在当前浏览器的 localStorage 中，安全不上云。
                      </span>
                    </div>

                    <div className="space-y-2">
                       <label className="text-[11px] text-slate-450 font-bold uppercase tracking-wider block">
                         指定模型版本名称 (Model ID)
                       </label>
                       <input 
                         type="text" 
                         value={customAiModel}
                         onChange={(e) => setCustomAiModel(e.target.value)}
                         placeholder="deepseek-chat"
                         className="w-full bg-[#161619] border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-[#10b981] focus:ring-0"
                       />
                       <span className="text-[10px] text-slate-500 block">
                         例如 DeepSeek: <code className="text-[9px] bg-slate-900 px-1.5 py-0.5 rounded text-indigo-300">deepseek-chat</code>，通义千问: <code className="text-[9px] bg-slate-900 px-1.5 py-0.5 rounded text-indigo-300">qwen-plus</code>
                       </span>
                    </div>

                  </div>

                  {/* Tips */}
                  <div className="p-3.5 bg-slate-900/60 border border-slate-800/80 rounded-xl">
                    <p className="text-[10px] text-slate-400 leading-normal">
                      💡 **说明**: 确认启用后，订阅包内的 AI 对话以及后续的文章深度内容提炼，都将自动代理至所选择的第三方大语言模型。
                    </p>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 justify-end pt-3 border-t border-slate-800 shrink-0">
                <button 
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/10 hover:shadow-indigo-600/20"
                >
                  确定并保存设置
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

{/* ================= MODAL: SECURE DELETE CONFIRMATION ================= */}
      {deleteConfirmTarget && (
        <div className="fixed inset-0 bg-[#000000]/80 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-[#121215] border border-red-950/80 max-w-sm w-full rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-rose-950/40 flex items-center gap-3 bg-red-950/5">
              <div className="w-8 h-8 rounded-full bg-rose-950/45 text-rose-400 flex items-center justify-center border border-rose-900/40">
                <AlertCircle className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-white">确认执行删除？</h3>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                您正在删除 {deleteConfirmTarget.type === "feed" ? "网站订阅源" : "合并订阅包"}: <strong className="text-white">“{deleteConfirmTarget.name}”</strong>。
              </p>
              <p className="text-[11px] text-slate-500 bg-[#161619] p-3 rounded-xl border border-slate-800">
                {deleteConfirmTarget.type === "feed" 
                  ? "⚠️ 此操作不可逆！该订阅源及其已提取的全部文章、对齐正文、缓存信息将被彻底移除。" 
                  : "💡 源网站订阅及文章仍会被保留，仅解散此订阅包。"}
              </p>
              
              <div className="flex gap-3 justify-end pt-2 border-t border-slate-800">
                <button 
                  type="button"
                  onClick={() => setDeleteConfirmTarget(null)}
                  className="px-4 py-2 bg-[#1b1b1f] hover:bg-[#25252b] text-slate-400 hover:text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  取消
                </button>
                <button 
                  type="button"
                  onClick={handleExecuteDelete}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-lg shadow-rose-950/20"
                >
                  确认删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: IMMERSIVE ARTICLE READER ================= */}
      {activeReaderArticle && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 md:p-6 z-50 animate-fade-in">
          <div 
            className={`bg-[#0F0F11] border border-slate-800 w-full rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[95vh] md:max-h-[90vh] transition-all duration-300 ${
              showOriginalSplit ? 'max-w-[94%] xl:max-w-7xl' : 'max-w-3xl'
            } animate-slide-up`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header / Top Ribbon with actions */}
            <div className="p-4 border-b border-slate-800/80 bg-[#121215] flex flex-wrap gap-3 items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] bg-indigo-500/10 text-indigo-300 px-2.5 py-1 rounded-md border border-indigo-505/15 font-sans font-medium">
                  {activeReaderArticle.feedName || "MedRss Ai 订阅源"}
                </span>
                <span className="text-slate-600 text-xs">•</span>
                <span className="text-[11px] text-slate-500 font-mono">
                  {new Date(activeReaderArticle.pubDate).toLocaleString()}
                </span>
              </div>
              
              <div className="flex items-center flex-wrap gap-2.5">
                {/* original screen divider toggle */}
                <button
                  type="button"
                  onClick={() => setShowOriginalSplit(!showOriginalSplit)}
                  className={`px-2.5 py-1.5 rounded-lg transition-colors inline-flex items-center gap-1.5 text-[11px] font-semibold border ${
                    showOriginalSplit 
                      ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/25' 
                      : 'bg-slate-900 text-slate-400 hover:text-white border-slate-800/80'
                  }`}
                  title="开/关 极速对照原文链接页面"
                >
                  <Globe className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{showOriginalSplit ? "收起原文分栏" : "分栏对照原文"}</span>
                </button>

                <a 
                  href={cleanUrl(activeReaderArticle.url)} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors inline-flex items-center gap-1 text-[11px]"
                  title="在新标签页中查看原文网页"
                >
                  <span className="hidden sm:inline">新标签查看</span>
                  <ExternalLink className="w-4 h-4" />
                </a>

                <button
                  onClick={() => {
                    const matchedBundle = bundles.find(b => b.feedIds.includes(selectedFeedId || ''));
                    if (matchedBundle) {
                      setSelectedBundleId(matchedBundle.id);
                    } else if (bundles.length > 0) {
                      setSelectedBundleId(bundles[0].id);
                    }
                    setIsChatOpen(true);
                    setActiveTab("chat");
                    setCurrentChatInput(`请专门帮我详细解读并提炼以下这篇文章的核心意义、主要观点及产业启示：\n《${activeReaderArticle.title}》\n原文链接：${cleanUrl(activeReaderArticle.url)}`);
                    setActiveReaderArticle(null);
                  }}
                  className="p-1.5 hover:bg-indigo-600/10 text-indigo-400 hover:text-indigo-300 rounded-lg transition-colors inline-flex items-center gap-1 text-[11px] font-semibold border border-indigo-500/15"
                  title="导入本订阅合并包，开始 AI 深度大模型对话解答"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI 智能解读</span>
                </button>

                <button
                  onClick={() => setActiveReaderArticle(null)}
                  className="p-1.5 bg-slate-850 hover:bg-slate-800 text-slate-100 rounded-lg transition-colors"
                  title="关闭阅读器"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Split Screen Container Body */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
              
              {/* LEFT CHANNEL: AI Cleansed Representation with beautiful scroll context */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col bg-[#0F0F11]">
                {/* Cover Banner inside reader only if not split or split is closed to preserve vertical height */}
                <div className="relative w-full h-36 md:h-48 bg-slate-900 overflow-hidden shrink-0">
                  <img 
                    src={getArticleCoverImage(activeReaderArticle)} 
                    alt={activeReaderArticle.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0F0F11] via-[#0F0F11]/40 to-transparent" />
                </div>

                {/* Reader Contents */}
                <div className="p-6 md:p-8 space-y-6 flex-1">
                  {/* Large Title */}
                  <h2 className="text-lg md:text-xl font-extrabold text-white tracking-tight leading-snug select-text">
                    {activeReaderArticle.title}
                  </h2>

                  <div className="h-px bg-slate-800/80" />

                  {/* Article text paragraphs */}
                  <div className="prose prose-invert max-w-none text-slate-350 leading-relaxed space-y-4 font-sans select-text">
                    {activeReaderArticle.content ? (
                      (() => {
                        const paragraphs = activeReaderArticle.content
                          .split('\n')
                          .map(p => p.trim())
                          .filter(p => p.length > 0);
                        
                        return paragraphs.map((para, pIdx) => (
                          <p key={pIdx} className="text-slate-300 leading-relaxed font-sans text-justify text-sm">
                            {para}
                          </p>
                        ));
                      })()
                    ) : (
                      <div className="space-y-4">
                        <p className="text-slate-400 font-sans text-sm italic">
                          {activeReaderArticle.summary || "本书签暂无额外对齐的正文描述。"}
                        </p>
                        <div className="p-4 bg-yellow-600/10 border border-yellow-500/20 rounded-xl flex items-start gap-3">
                          <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                          <div>
                            <h4 className="text-xs font-bold text-yellow-300">尚未提取到本篇文章的多维度正文</h4>
                            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                              大模型精简解析后台通常在首次加载订阅、或周期内刷新该通道时自动进行全文对齐，您可以点击上方【AI 智能解读】将本文输入对话侧栏，利用大模型实时提取详情并给出精确回答！
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* RIGHT CHANNEL: Embedded Live Webpage Browser frame or Clean Reader (Rendered inside split layout) */}
              {showOriginalSplit && (
                <div className="w-full lg:w-1/2 flex flex-col bg-[#111114] border-t lg:border-t-0 lg:border-l border-slate-800">
                  {/* Small internal status block bar & Tab selector */}
                  <div className="px-4 py-2 border-b border-slate-800/80 bg-[#141418] flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-1 bg-slate-900/60 p-0.5 rounded-lg border border-slate-800/60">
                      <button
                        onClick={() => setReaderViewMode('clean')}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                          readerViewMode === 'clean'
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-slate-400 hover:text-white hover:bg-slate-800/40"
                        }`}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>原文全览 (精排)</span>
                      </button>
                      <button
                        onClick={() => setReaderViewMode('original')}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                          readerViewMode === 'original'
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-slate-400 hover:text-white hover:bg-slate-800/40"
                        }`}
                      >
                        <Globe className="w-3.5 h-3.5" />
                        <span>原生网页 (视窗)</span>
                      </button>
                    </div>
                    
                    <div className="flex items-center gap-2 overflow-hidden min-w-0">
                      {readerViewMode === 'clean' ? (
                        <button
                          onClick={() => {
                            if (readerContent) {
                              navigator.clipboard.writeText(
                                `${readerContent.title}\n\n${readerContent.contentHtml.replace(/<[^>]+>/g, '')}`
                              );
                              setCopiedTextId("reader-copy");
                              setTimeout(() => setCopiedTextId(null), 2000);
                            }
                          }}
                          disabled={!readerContent}
                          className="px-2 py-1 text-[10px] bg-slate-800 hover:bg-slate-750 disabled:opacity-50 text-slate-300 rounded-md transition-colors flex items-center gap-1 border border-slate-700/50"
                          title="复制全文纯文本"
                        >
                          {copiedTextId === "reader-copy" ? "已复制！" : "复制纯文本"}
                        </button>
                      ) : (
                        <button 
                          onClick={() => {
                            const ifr = document.getElementById("original-webpage-live-frame") as HTMLIFrameElement;
                            if (ifr) {
                              ifr.src = `/api/proxy-webpage?url=${encodeURIComponent(activeReaderArticle.url)}`;
                            }
                          }}
                          className="p-1 hover:bg-slate-850 rounded-md text-slate-400 hover:text-white transition-colors"
                          title="重载当前网页"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Warning/Status advice label dynamically matches the mode */}
                  {readerViewMode === 'clean' ? (
                    <div className="px-4 py-1.5 bg-indigo-950/20 border-b border-indigo-900/30 text-[10px] text-indigo-400 leading-snug shrink-0 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0 animate-pulse" />
                      <span className="truncate">极速学术视窗：外观已精排，AI 将自动归纳并仅呈现全文的单段中文核心深度总结，助您极速获取核心要义。</span>
                    </div>
                  ) : (
                    <div className="px-4 py-1.5 bg-[#1e1b12]/30 border-b border-amber-900/10 text-[10px] text-amber-500 leading-snug shrink-0 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="truncate">免跳转安全加载：内置代理通道已自动绕过目标学术站或专刊的 X-Frame / CSP 等安全限制，无需跳出软件即可流畅浏览原文全文。</span>
                    </div>
                  )}

                  {/* Content Container based on render mode */}
                  <div className="flex-1 w-full bg-[#0b0b0d] relative overflow-hidden flex flex-col min-h-0">
                    {readerViewMode === 'clean' ? (
                      <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
                        {readerLoading ? (
                          <div className="h-full flex flex-col items-center justify-center space-y-4 text-center my-24">
                            <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-slate-200">正在穿透网站安全防线并进行智能总结...</p>
                              <p className="text-xs text-slate-400">正在抓取全文并由 AI 自适应生成极简单段中文深度总结，请稍等</p>
                            </div>
                          </div>
                        ) : readerError && !readerContent ? (
                          <div className="p-6 bg-slate-900/50 border border-slate-800 rounded-xl space-y-4 max-w-md mx-auto my-12 text-center">
                            <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
                            <div className="space-y-2">
                              <h4 className="text-sm font-bold text-slate-200">智能总结抓取受限</h4>
                              <p className="text-xs text-slate-400 leading-relaxed px-4">
                                {readerError}
                              </p>
                            </div>
                            <button
                              onClick={() => setReaderViewMode('original')}
                              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition-colors"
                            >
                              切换到原生网页原始视窗
                            </button>
                          </div>
                        ) : readerContent ? (
                          <div className="space-y-6 select-text">
                            {/* Inner Title of Article */}
                            <h1 className="text-xl md:text-2xl font-black text-slate-100 tracking-tight leading-snug">
                              {readerContent.title}
                            </h1>
                            
                            <div className="flex items-center gap-3 text-xs text-slate-400 border-b border-slate-850 pb-4">
                              <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded font-medium">AI 单段中文核心总结</span>
                              <span>•</span>
                              <a 
                                href={cleanUrl(activeReaderArticle.url)} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="hover:text-indigo-400 flex items-center gap-1 text-slate-400 underline transition-colors"
                              >
                                <span>新标签页打开源站</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>

                            {/* Rendered HTML Body */}
                            <div 
                              className="prose prose-invert max-w-none text-slate-300 font-sans leading-relaxed text-sm md:text-[15px] space-y-5"
                              dangerouslySetInnerHTML={{ __html: readerContent.contentHtml }}
                            />
                            
                            {/* Ending Divider of Reading context */}
                            <div className="pt-12 text-center text-xs text-slate-500 flex items-center justify-center gap-2 pb-6">
                              <div className="h-px bg-slate-850 flex-1"></div>
                              <span className="font-mono text-[10px] text-slate-500">AI 全文精炼总结已完美译介</span>
                              <div className="h-px bg-slate-850 flex-1"></div>
                            </div>
                          </div>
                        ) : (
                          <div className="h-full flex items-center justify-center text-slate-500 py-12">
                            正文未就绪
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="w-full h-full flex flex-col">
                        {/* Elegant toolbar with direct access and multiple helper engines */}
                        <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0 select-none">
                          <div className="flex items-center gap-2 max-w-[50%]">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span className="text-xs text-slate-300 font-medium truncate">
                              正在载入: {cleanUrl(activeReaderArticle.url)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => {
                                const iframe = document.getElementById('original-webpage-live-frame') as HTMLIFrameElement;
                                if (iframe) {
                                  iframe.src = `/api/proxy-webpage?url=${encodeURIComponent(activeReaderArticle.url)}`;
                                }
                              }}
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-300 hover:text-white rounded transition-colors"
                              title="重新加载内置代理网页"
                            >
                              重试原生
                            </button>
                            
                            <a
                              href={`https://translate.google.com/translate?sl=auto&tl=zh-CN&u=${encodeURIComponent(cleanUrl(activeReaderArticle.url))}`}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2 py-1 bg-indigo-650 hover:bg-indigo-600 text-[10px] font-semibold text-indigo-200 hover:text-white rounded transition-colors"
                              title="如果目标网页因人机验证(如403)被墙，谷歌翻译网页版可实现超强中转穿透"
                            >
                              谷歌翻译中转 (推荐)
                            </a>
                            
                            <a
                              href={`https://web.archive.org/web/2/${cleanUrl(activeReaderArticle.url)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-300 hover:text-white rounded transition-colors"
                              title="从 Wayback Machine 互联网档案馆调取历史快照"
                            >
                              时光机快照
                            </a>
                            
                            <a
                              href={cleanUrl(activeReaderArticle.url)}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-[10px] font-semibold text-white rounded transition-colors flex items-center gap-1"
                            >
                              <span>新标签页直达</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                        
                        <iframe 
                          id="original-webpage-live-frame"
                          src={`/api/proxy-webpage?url=${encodeURIComponent(activeReaderArticle.url)}`} 
                          className="w-full flex-1 border-0 bg-slate-950"
                          title="Article Webpage Preview"
                          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>

            {/* Bottom Footer Ribbon with closing actions */}
            <div className="p-4 border-t border-slate-850 bg-[#121215]/60 flex items-center justify-between shrink-0">
              <span className="text-[10px] text-slate-500 font-mono">
                由 MedRss AI 高清引擎对齐渲染
              </span>
              <button
                onClick={() => setActiveReaderArticle(null)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold hover:shadow-lg hover:shadow-indigo-600/15 transition-all"
              >
                已读完
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
