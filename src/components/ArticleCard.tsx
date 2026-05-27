import React, { useState } from "react";
import { Clock, Sparkles, ChevronDown, ChevronUp, ExternalLink, AlertCircle, RefreshCw } from "lucide-react";
import { FeedArticle } from "../types";

interface ArticleCardProps {
  key?: string;
  art: FeedArticle & { feedName?: string };
  useCustomAi: boolean;
  customAiBaseUrl: string;
  customAiApiKey: string;
  customAiModel: string;
  isCompact?: boolean;
  isRead?: boolean;
  onToggleRead?: () => void;
  onMarkAsRead?: () => void;
}

// Re-implement the helper functions perfectly inside ArticleCard for total modularity
function getArticleCoverImage(art: FeedArticle): string {
  if (art.imageUrl) {
    return art.imageUrl;
  }
  const contentToSearch = `${art.summary || ''} ${art.content || ''}`;
  const imgRegex = /src=["'](https?:\/\/[^"'\s<>]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^"'\s<>]*)?)["']/i;
  const match = contentToSearch.match(imgRegex);
  if (match && match[1]) {
    return match[1];
  }

  // Generate deterministic premium stock image based on ID or title
  const covers = [
    "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=400&q=80", // Med tech
    "https://images.unsplash.com/photo-1530026405186-ed1ea0ac7a63?auto=format&fit=crop&w=400&q=80", // Microscope
    "https://images.unsplash.com/photo-1507413245164-6160d8298b31?auto=format&fit=crop&w=400&q=80", // Sci Lab
    "https://images.unsplash.com/photo-1532187643603-ba119ca4109e?auto=format&fit=crop&w=400&q=80", // Vaccine science
    "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=400&q=80", // Diagnostics
    "https://images.unsplash.com/photo-1631553127989-130a139a1fe0?auto=format&fit=crop&w=400&q=80"  // Robotic surgery
  ];
  let sum = 0;
  const key = art.id || art.title || "";
  for (let i = 0; i < key.length; i++) {
    sum += key.charCodeAt(i);
  }
  const index = sum % covers.length;
  return covers[index];
}

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

export function ArticleCard({
  art,
  useCustomAi,
  customAiBaseUrl,
  customAiApiKey,
  customAiModel,
  isCompact = false,
  isRead: propIsRead,
  onToggleRead,
  onMarkAsRead
}: ArticleCardProps) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryHtml, setSummaryHtml] = useState<string | null>(null);

  // Client-side read state tracking using localStorage for fast & resilient storage
  const [localIsRead, setLocalIsRead] = useState<boolean>(() => {
    try {
      return localStorage.getItem("rss_read_" + art.url) === "true";
    } catch (e) {
      return false;
    }
  });

  const isRead = propIsRead !== undefined ? propIsRead : localIsRead;

  const toggleReadStatus = () => {
    if (onToggleRead) {
      onToggleRead();
      return;
    }
    const nextRead = !localIsRead;
    setLocalIsRead(nextRead);
    try {
      if (nextRead) {
        localStorage.setItem("rss_read_" + art.url, "true");
      } else {
        localStorage.removeItem("rss_read_" + art.url);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const markAsRead = () => {
    if (onMarkAsRead) {
      onMarkAsRead();
      return;
    }
    if (!localIsRead) {
      setLocalIsRead(true);
      try {
        localStorage.setItem("rss_read_" + art.url, "true");
      } catch (e) {
        console.error(e);
      }
    }
  };

  const coverUrl = getArticleCoverImage(art);
  const targetUrl = cleanUrl(art.url);

  const fetchSummary = async () => {
    if (summaryHtml && !error) return; // already fetched successfully
    
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch(`/api/reader-content`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          url: art.url, // Send original url for server to resolve and fetch
          customAiSettings: {
            isEnabled: useCustomAi,
            baseUrl: customAiBaseUrl,
            apiKey: customAiApiKey,
            model: customAiModel
          }
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP 异常: 状态 $` + res.status);
      }

      const data = await res.json();
      if (data && data.contentHtml) {
        setSummaryHtml(data.contentHtml);
        if (data.aiSummary) {
          art.aiSummary = data.aiSummary;
        }
        if (data.imageUrl) {
          art.imageUrl = data.imageUrl;
        }
      } else if (data && data.error) {
        throw new Error(data.error);
      } else {
        throw new Error("大模型未能成功抓取并生成文章的核心深度总结。");
      }
    } catch (err: any) {
      console.error("[ArticleCard summary fetch failed]", err);
      setError(err.message || "拉取总结失败，您可以稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    // Prevent triggering if clicked on links
    if (expanded) {
      setExpanded(false);
    } else {
      setExpanded(true);
      fetchSummary();
      markAsRead();
    }
  };

  return (
    <div 
      className={`bg-[#121215]/90 border border-slate-800/80 hover:border-indigo-500/40 rounded-2xl overflow-hidden transition-all duration-300 flex flex-col justify-between shadow-lg shadow-black/20 hover:shadow-indigo-500/5 group cursor-pointer ${
        expanded ? 'ring-1 ring-indigo-500/30 border-indigo-500/30 h-auto' : 'hover:-translate-y-1'
      } ${isRead ? 'opacity-70 hover:opacity-100' : ''}`}
      onClick={handleToggleExpand}
    >
      {/* Cover Image Header */}
      <div className={`relative w-full overflow-hidden shrink-0 ${isCompact ? 'h-32' : 'h-38 md:h-42'}`}>
        <img 
          src={coverUrl} 
          alt={art.title} 
          referrerPolicy="no-referrer"
          className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-103 ${isRead ? 'opacity-70' : ''}`}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#121215] via-[#121215]/30 to-transparent" />
        
        {/* Read / Unread Status Badge overlaid on top-left of cover image */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleReadStatus();
          }}
          className={`absolute top-3 left-3 text-[9px] px-2.5 py-1 rounded-full font-bold select-none backdrop-blur-sm transition-all duration-200 border flex items-center gap-1.5 z-10 ${
            isRead 
              ? "text-slate-400 bg-slate-900/80 border-slate-800/80 hover:bg-slate-800/90" 
              : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20 shadow-sm shadow-emerald-500/10 hover:bg-emerald-500/15"
          }`}
          title={isRead ? "标记为未读" : "标记为已读"}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isRead ? "bg-slate-500" : "bg-emerald-400 animate-pulse"}`}></span>
          <span>{isRead ? "已读" : "未读"}</span>
        </button>

        {/* Hot status indicator overlaid on top right */}
        {art.content && (
          <span className="absolute top-3 right-3 text-[9px] text-[#6366f1]/90 bg-[#6366f1]/15 px-2 py-0.5 rounded-full border border-indigo-500/20 font-bold select-none backdrop-blur-sm">
            深度已抓取
          </span>
        )}
      </div>

      {/* Content Body */}
      <div className="p-4 md:p-5 flex-1 flex flex-col justify-between space-y-3.5">
        <div className="space-y-2.5">
          {/* Article Date / Badge */}
          <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono">
            {art.feedName ? (
              <span className="text-[9px] bg-slate-800/60 text-indigo-300 px-2.5 py-1 rounded-md border border-slate-700/55 max-w-[65%] truncate font-sans">
                {art.feedName}
              </span>
            ) : (
              <span className="flex items-center gap-1 bg-[#1b1b1f] px-2.5 py-1 rounded-md border border-slate-850 text-slate-400">
                <Clock className="w-3 h-3 text-slate-500 shrink-0" />
                {new Date(art.pubDate).toLocaleDateString()}
              </span>
            )}
            
            <span className="text-slate-500 text-[10px]">
              {new Date(art.pubDate).toLocaleDateString([], { month: '2-digit', day: '2-digit' })}
            </span>
          </div>

          {/* Article Title */}
          <h4 className={`text-sm font-bold leading-snug transition-colors line-clamp-2 select-text ${isRead ? 'text-slate-400 group-hover:text-indigo-400' : 'text-slate-100 group-hover:text-indigo-400'}`} onClick={e => e.stopPropagation()}>
            {art.title}
          </h4>

          {/* Summary Details */}
          {art.aiSummary ? (
            <div className="space-y-1.5" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-1.5 text-[9px] font-bold text-indigo-400 uppercase tracking-wider select-none">
                <span className="px-1.5 py-0.5 bg-indigo-500/10 rounded border border-indigo-500/20">✨ AI 精炼总结</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed font-sans line-clamp-4 select-text selection:bg-indigo-500/30">
                {art.aiSummary}
              </p>
            </div>
          ) : (
            <div className="space-y-1" onClick={e => e.stopPropagation()}>
              <p className="text-xs text-slate-450 leading-relaxed font-sans line-clamp-3 select-text">
                {art.summary || "源网站未携带额外摘要信息描述。"}
              </p>
              <div className="text-[9px] text-slate-500 font-medium flex items-center gap-1">
                <span>⚡ 暂无 AI 总结，点击下方按钮即可极速穿透提取</span>
              </div>
            </div>
          )}
        </div>

        {/* AI summary inline drawer container */}
        {expanded && (
          <div 
            className="mt-3 pt-3 border-t border-slate-850/80 animate-fade-in text-slate-200 select-text cursor-default"
            onClick={e => e.stopPropagation()}
          >
            {loading ? (
              <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-850 text-center space-y-3 my-2 select-none">
                <div className="relative flex justify-center py-2">
                  <div className="w-7 h-7 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400 absolute self-center animate-pulse" />
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-slate-200">正在穿透网站安全防线并进行智能总结...</p>
                  <p className="text-[9px] text-slate-450">AI 正在精准提炼全文单段中文核心要义，请稍等</p>
                </div>
              </div>
            ) : error ? (
              <div className="p-4 bg-rose-950/10 border border-rose-500/15 rounded-xl text-center space-y-2.5 my-2">
                <div className="flex items-center justify-center gap-2 text-rose-400 text-xs font-bold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>智能总结解析抓取受限</span>
                </div>
                <p className="text-[10px] text-slate-450 leading-relaxed px-1">
                  该专刊或学术源设置了强力人机图形屏蔽门盾（如 Cloudflare / 403 挑战），AI 无法自动穿透。建议使用极推荐直连：
                </p>
                <div className="flex flex-col gap-1.5 pt-1.5">
                  <a
                    href={`https://translate.google.com/translate?sl=auto&tl=zh-CN&u=${encodeURIComponent(targetUrl)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-1.5 bg-indigo-650 hover:bg-indigo-600 font-semibold text-[10px] text-white rounded-md transition-colors"
                  >
                    🚀 使用 Google 译介通道穿透中转浏览
                  </a>
                  <button
                    onClick={fetchSummary}
                    className="w-full py-1 bg-slate-800 hover:bg-slate-700 font-medium text-[10px] text-slate-300 rounded hover:text-white transition-colors flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3 animate-spin-once" />
                    <span>重试穿透 AI 提取</span>
                  </button>
                </div>
              </div>
            ) : summaryHtml ? (
              <div className="space-y-3">
                <div className="text-[11px] font-sans selection:bg-indigo-500/30 text-slate-200">
                  <div dangerouslySetInnerHTML={{ __html: summaryHtml }} />
                </div>
                
                {/* Embedded dynamic translated portal */}
                <div className="bg-[#1b1b1f]/3 w-full rounded-xl p-3 border border-slate-850/60 flex items-center justify-between gap-2 shrink-0 select-none text-[10px]">
                  <span className="text-slate-450">如需阅看多维表格/图谱原件？</span>
                  <a
                    href={`https://translate.google.com/translate?sl=auto&tl=zh-CN&u=${encodeURIComponent(targetUrl)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 font-semibold underline decoration-indigo-500/40"
                  >
                    <span>Google 翻译秒变原文 (秒级穿透)</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Card Actions Bottom */}
        <div className="flex justify-between items-center pt-2.5 border-t border-slate-805/45 shrink-0" onClick={e => e.stopPropagation()}>
          <button 
            type="button"
            onClick={handleToggleExpand}
            className={`text-[10px] flex items-center gap-1.5 font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
              expanded 
                ? "bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
                : "text-indigo-400 bg-indigo-500/5 hover:bg-indigo-500/10 border-indigo-500/10 hover:border-indigo-500/25"
            }`}
          >
            <span>{expanded ? "收起总结" : "✨ AI 核心总结"}</span>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />}
          </button>

          <a 
            href={targetUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            onClick={markAsRead}
            className="text-[10px] text-slate-450 hover:text-white flex items-center gap-1.5 transition-colors font-medium bg-slate-900 hover:bg-slate-850 border border-slate-800/80 px-2.5 py-1.5 rounded-lg"
          >
            <span>直达源站</span>
            <ExternalLink className="w-3 h-3 text-slate-400" />
          </a>
        </div>
      </div>
    </div>
  );
}
