import JSZip from "jszip";

export interface ExportArticle {
  id: string;
  title: string;
  url: string;
  summary: string;
  pubDate: string;
  content?: string;
  imageUrl?: string;
  aiSummary?: string;
}

// 1. Generate Interactive Single-Page HTML Reader
export function generateHtmlReader(title: string, description: string, articles: ExportArticle[]): string {
  const safeTitle = (title || "MedRss 离线导出版").replace(/"/g, '&quot;');
  const safeDesc = (description || "AI 深度抓取与精炼重构的精品内容合集").replace(/"/g, '&quot;');
  
  // Serialize articles safely
  const serializedArticles = JSON.stringify(articles);

  return `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle} - 离线交互阅读中心</title>
    <!-- Use Tailwind CSS CDN -->
    <script src="https://cdn.tailwindcss.com"></script>
    <!-- Lucide icons -->
    <script src="https://unpkg.com/lucide@latest"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        slate: {
                            450: '#94a3b8',
                            850: '#1e293b',
                        }
                    }
                }
            }
        }
    </script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        
        body {
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
        }
        .font-mono {
            font-family: 'JetBrains Mono', monospace;
        }
        
        ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }
        ::-webkit-scrollbar-track {
            background: rgba(15, 15, 15, 0.05);
        }
        .dark ::-webkit-scrollbar-track {
            background: rgba(30, 30, 35, 0.2);
        }
        ::-webkit-scrollbar-thumb {
            background: rgba(100, 116, 139, 0.2);
            border-radius: 999px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: rgba(100, 116, 139, 0.4);
        }
    </style>
</head>
<body class="bg-slate-50 text-slate-900 dark:bg-[#0c0c0e] dark:text-slate-100 transition-colors duration-200 h-screen flex flex-col overflow-hidden">

    <!-- Raw Data Embed Injection -->
    <script id="articles-data" type="application/json">${serializedArticles}</script>

    <!-- Top Navbar -->
    <header class="bg-white dark:bg-[#121215] border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between shrink-0 shadow-sm z-10 transition-colors">
        <div class="flex items-center gap-3">
            <div class="p-2 bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-500/10">
                <i data-lucide="book-open" class="w-5 h-5"></i>
            </div>
            <div>
                <h1 class="text-sm font-bold text-slate-800 dark:text-white tracking-tight leading-none">${safeTitle}</h1>
                <p class="text-[10px] text-slate-500 mt-1.5 truncate max-w-[200px] sm:max-w-md">${safeDesc}</p>
            </div>
        </div>

        <!-- Desktop Controls -->
        <div class="flex items-center gap-2">
            <!-- Search & Filter Area Inside Topbar -->
            <div class="relative hidden md:block">
                <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <i data-lucide="search" class="w-3.5 h-3.5"></i>
                </span>
                <input 
                    type="text" 
                    id="search-input" 
                    placeholder="搜索文章标题或摘要..." 
                    class="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-405 focus:outline-indigo-505 w-60"
                >
            </div>

            <!-- Stats Badge -->
            <div class="bg-indigo-500/10 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold font-mono">
                离线包: <span id="total-badge">0</span> 篇
            </div>

            <!-- Darkmode Toggle Switch -->
            <button 
                onclick="toggleDarkMode()" 
                class="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 dark:text-slate-400 transition-colors"
                title="切换黑白主题"
            >
                <i id="theme-icon" data-lucide="moon" class="w-4 h-4"></i>
            </button>
            
            <!-- Font sizing Adjustments -->
            <div class="flex items-center border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-slate-50 dark:bg-slate-900">
                <button onclick="changeFontSize(-1)" class="px-2.5 py-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 text-[10px] text-slate-500" title="减小字体">A-</button>
                <button onclick="changeFontSize(1)" class="px-2.5 py-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 text-[10px] text-slate-500 border-l border-slate-200 dark:border-slate-800" title="增大字体">A+</button>
            </div>
        </div>
    </header>

    <!-- Main Workspace Frame -->
    <main class="flex-1 flex overflow-hidden">
        
        <!-- Left Sidebar: Articles Scroll -->
        <section class="w-full md:w-[350px] lg:w-[400px] border-r border-slate-200 dark:border-slate-850 flex flex-col shrink-0 bg-white dark:bg-[#0f0f11] overflow-hidden">
            <!-- Sticky Filter Switch Bar -->
            <div class="p-3 border-b border-slate-100 dark:border-slate-850 flex items-center justify-between gap-3 shrink-0">
                <div class="flex bg-slate-100 dark:bg-[#121215] border border-slate-200 dark:border-slate-800 rounded-lg p-0.5 select-none text-[10px] flex-1">
                    <button 
                        id="filter-all-btn"
                        onclick="setUnreadFilter(false)"
                        class="px-3 py-1 bg-indigo-650 text-white rounded font-bold flex-1 transition-all"
                    >
                        全部
                    </button>
                    <button 
                        id="filter-unread-btn"
                        onclick="setUnreadFilter(true)"
                        class="px-3 py-1 text-slate-500 dark:text-slate-405 hover:text-indigo-400 rounded flex-1 transition-all flex items-center justify-center gap-1"
                    >
                        <span class="w-1 h-1 rounded-full bg-emerald-400 animate-pulse"></span>
                        未读 (<span id="unread-count">0</span>)
                    </button>
                </div>
                <button 
                    onclick="markAllAsRead()" 
                    class="p-1 px-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-300 text-[9px] font-semibold border border-slate-250 dark:border-slate-800 rounded-md transition-all shrink-0"
                >
                    全部已读
                </button>
            </div>

            <!-- Mobile Search Bar (Only visible on small viewports) -->
            <div class="p-3 border-b border-slate-100 dark:border-slate-850 block md:hidden bg-slate-50/50 dark:bg-slate-900/10 shrink-0">
                <input 
                    type="text" 
                    id="mobile-search-input" 
                    placeholder="全文搜索文章及摘要..." 
                    class="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-500 focus:outline-[#10b981]"
                >
            </div>

            <!-- Articles Scroll list container -->
            <div id="articles-list" class="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-850/60 p-2 space-y-1">
                <!-- Articles injected here via JS -->
            </div>
        </section>

        <!-- Right Pane: Active Article Detailed content view -->
        <section id="reader-pane" class="hidden md:flex flex-1 flex-col overflow-hidden bg-slate-50/50 dark:bg-[#070709]/20">
            <!-- Active Reader Placeholder -->
            <div id="reader-placeholder" class="flex-1 flex flex-col items-center justify-center text-center p-12 text-slate-400 dark:text-slate-600 gap-4">
                <i data-lucide="book" class="w-16 h-16 text-slate-300 dark:text-slate-800"></i>
                <div>
                    <h3 class="text-sm font-semibold text-slate-600 dark:text-slate-400/80 mb-1">请在左侧选择一篇文档开始阅览</h3>
                    <p class="text-[11px] text-slate-400 dark:text-slate-600 max-w-xs leading-relaxed">此导出版支持离线交互分析。文章阅读状态将在当前浏览器中自动持久化管理。</p>
                </div>
            </div>

            <!-- Active Reader Article Frame -->
            <div id="reader-content-frame" class="hidden flex-1 flex flex-col overflow-hidden animate-fade-in">
                <!-- Inner Article Details Panel -->
                <div class="flex-1 overflow-y-auto px-6 py-8 md:px-10">
                    <div id="active-article-view" class="max-w-3xl mx-auto space-y-6">
                        <!-- Cover Image Container -->
                        <div id="article-cover" class="hidden w-full h-[180px] md:h-[260px] rounded-2xl overflow-hidden shadow-md shrink-0 border border-slate-200 dark:border-slate-800">
                            <img id="article-cover-img" src="" class="w-full h-full object-cover" alt="Article Cover" onerror="this.parentElement.style.display='none'">
                        </div>

                        <!-- Main Metadata Header -->
                        <div class="space-y-3">
                            <h2 id="article-title" class="text-lg md:text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight leading-snug">
                                <!-- Article Title -->
                            </h2>
                            
                            <div class="flex flex-wrap items-center gap-2 text-[10px] md:text-xs text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-slate-850 pb-4">
                                <span id="article-pub-badge" class="font-mono bg-slate-100 dark:bg-slate-901 px-2 py-0.5 rounded text-slate-400">时间已同步</span>
                                <span>•</span>
                                <a id="article-external-link" href="#" target="_blank" rel="noreferrer" class="hover:text-indigo-400 underline flex items-center gap-1 text-slate-450 dark:text-slate-400 transition-colors">
                                    <span>直达网页源站</span>
                                    <i data-lucide="external-link" class="w-3 h-3"></i>
                                </a>
                            </div>
                        </div>

                        <!-- Three Segment tab view controller -->
                        <div class="flex border-b border-slate-200 dark:border-slate-850 bg-slate-100 dark:bg-[#101013] rounded-xl p-0.5 select-none text-xs">
                            <button id="tab-summary" onclick="setReaderTab('summary')" class="flex-1 py-1.5 font-semibold border-b-2 rounded-lg text-center transition-all flex items-center justify-center gap-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-white-400">
                                <span>1. 极简摘要</span>
                            </button>
                            <button id="tab-ai" onclick="setReaderTab('ai')" class="flex-1 py-1.5 font-semibold border-b-2 rounded-lg text-center transition-all flex items-center justify-center gap-1 border-transparent text-slate-400 hover:text-slate-200">
                                <i data-lucide="sparkles" class="w-3.5 h-3.5 text-emerald-400"></i>
                                <span>2. AI 黄金智提炼</span>
                            </button>
                            <button id="tab-content" onclick="setReaderTab('content')" class="flex-1 py-1.5 font-semibold border-b-2 rounded-lg text-center transition-all flex items-center justify-center gap-1 border-transparent text-slate-400 hover:text-slate-200">
                                <span>3. 原文正文细阅</span>
                            </button>
                        </div>

                        <!-- Rendered Text Sections -->
                        <div id="tab-content-container" class="space-y-5 select-text">
                            <!-- Injected Active Tab Details here -->
                        </div>

                        <!-- Ending Divider -->
                        <div class="pt-8 text-center text-xs text-slate-400 dark:text-slate-600 flex items-center justify-center gap-2 pb-6">
                            <div class="h-px bg-slate-200 dark:bg-slate-850 flex-1"></div>
                            <span class="font-mono text-[9px] dark:text-slate-600">离线阅览数据由 MedRss AI 驱动</span>
                            <div class="h-px bg-slate-200 dark:bg-slate-850 flex-1"></div>
                        </div>
                    </div>
                </div>

                <!-- Footer Reader Actions -->
                <div class="p-4 border-t border-slate-200 dark:border-slate-850 bg-white dark:bg-[#121215]/60 flex items-center justify-between shrink-0">
                    <span class="text-[9px] text-slate-400 dark:text-slate-605 font-mono">
                        对齐时间: <span class="download-date"></span>
                    </span>
                    <button onclick="closeReader()" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-md transition-all">
                        已读完
                    </button>
                </div>
            </div>
        </section>
    </main>

    <!-- Scripting Layer (Business Logic) -->
    <script>
        // Global States
        let dbArticles = [];
        let activeArticle = null;
        let activeTab = 'summary'; // 'summary' | 'ai' | 'content'
        let filterUnreadOnly = false;
        let fontScaleLevel = 0; // -2 to 4
        let searchQuery = '';

        const FONT_CLASSES = ["text-xs", "text-sm", "text-base", "text-lg", "text-xl"];
        const LEADING_CLASSES = ["leading-relaxed", "leading-relaxed", "leading-loose", "leading-loose", "leading-loose"];

        // Init Block
        window.addEventListener("DOMContentLoaded", () => {
            // Load embedded structural dataset safely
            try {
                const dataRaw = document.getElementById("articles-data").textContent;
                dbArticles = JSON.parse(dataRaw) || [];
            } catch (err) {
                console.error("Failed parsing embedded reader content datasets.", err);
            }

            // Sync stats
            document.getElementById("total-badge").textContent = dbArticles.length;
            const now = new Date();
            document.querySelectorAll(".download-date").forEach(el => el.textContent = now.toLocaleDateString());

            // Initialize Lucide Icons
            lucide.createIcons();

            // Set up search handlers
            const searchField = document.getElementById("search-input");
            const mobileSearchField = document.getElementById("mobile-search-input");
            
            searchField.addEventListener("input", (e) => {
                searchQuery = e.target.value.toLowerCase().trim();
                renderArticlesList();
            });
            mobileSearchField.addEventListener("input", (e) => {
                searchQuery = e.target.value.toLowerCase().trim();
                renderArticlesList();
            });

            // Darkmode check
            if (localStorage.getItem('theme-offline') === 'light') {
                document.documentElement.classList.remove('dark');
                document.getElementById("theme-icon").setAttribute("data-lucide", "sun");
            } else {
                document.documentElement.classList.add('dark');
            }
            
            renderArticlesList();
            lucide.createIcons();
        });

        // Helpers
        function toggleDarkMode() {
            const doc = document.documentElement;
            const icon = document.getElementById("theme-icon");
            if (doc.classList.contains('dark')) {
                doc.classList.remove('dark');
                localStorage.setItem('theme-offline', 'light');
                icon.setAttribute("data-lucide", "sun");
            } else {
                doc.classList.add('dark');
                localStorage.setItem('theme-offline', 'dark');
                icon.setAttribute("data-lucide", "moon");
            }
            lucide.createIcons();
        }

        function changeFontSize(direction) {
            fontScaleLevel = Math.max(-1, Math.min(3, fontScaleLevel + direction));
            updateActiveArticleContentText();
        }

        function getReadStatus(url) {
            return localStorage.getItem('read_status_' + url) === 'true';
        }

        function setReadStatus(url, value) {
            localStorage.setItem('read_status_' + url, value ? 'true' : 'false');
            updateUnreadCountBadge();
        }

        function updateUnreadCountBadge() {
            const count = dbArticles.filter(art => !getReadStatus(art.url)).length;
            document.getElementById("unread-count").textContent = count;
        }

        // Render functions
        function renderArticlesList() {
            const container = document.getElementById("articles-list");
            container.innerHTML = "";

            const filtered = dbArticles.filter(art => {
                const matchesSearch = !searchQuery || 
                    art.title.toLowerCase().includes(searchQuery) || 
                    art.summary.toLowerCase().includes(searchQuery);
                    
                const matchesFilter = !filterUnreadOnly || !getReadStatus(art.url);
                return matchesSearch && matchesFilter;
            });

            if (filtered.length === 0) {
                container.innerHTML = \`<div class="p-8 text-center text-xs text-slate-400 dark:text-slate-600">
                    <i data-lucide="compass" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
                    暂无符合条件的筛选文档
                </div>\`;
                lucide.createIcons();
                updateUnreadCountBadge();
                return;
            }

            filtered.forEach(art => {
                const isSelected = activeArticle && activeArticle.url === art.url;
                const isRead = getReadStatus(art.url);
                const hasAi = !!art.aiSummary;

                const card = document.createElement("div");
                card.className = \`p-3.5 mx-1 rounded-xl cursor-pointer transition-all border outline-none duration-150 \${
                    isSelected 
                      ? 'bg-indigo-600/10 border-indigo-505 dark:text-white shadow-md' 
                      : 'bg-transparent border-transparent hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300'
                }\`;

                card.onclick = () => selectArticle(art);

                const readablePubDate = new Date(art.pubDate).toLocaleDateString([], { month: '2-digit', day: '2-digit' });

                card.innerHTML = \`
                    <div class="flex items-start justify-between gap-2.5 mb-1.5">
                        <div class="flex items-center gap-2">
                            <span class="w-1.5 h-1.5 rounded-full shrink-0 \${isRead ? 'bg-slate-300 dark:bg-slate-800' : 'bg-emerald-400 animate-pulse'}" title="\${isRead ? '已读' : '新文章'}"></span>
                            <h4 class="text-xs font-bold truncate select-none leading-snug tracking-tight max-w-[240px] \${isRead ? 'text-slate-400 dark:text-slate-500 font-normal line-through' : 'text-slate-800 dark:text-slate-200'}">
                                \${art.title}
                            </h4>
                        </div>
                        \${hasAi ? \`<span class="text-[8px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold tracking-widest uppercase scale-90 px-1 py-0.5 rounded font-mono shrink-0">AI</span>\` : ''}
                    </div>
                    <p class="text-[10px] text-slate-500 dark:text-slate-500 line-clamp-2 leading-relaxed mb-2.5">\${art.summary}</p>
                    <div class="flex items-center justify-between text-[9px] text-slate-400 font-mono">
                        <span>\${readablePubDate}</span>
                        <span class="hover:underline flex items-center gap-0.5 text-indigo-500 dark:text-indigo-400 select-none">\${isRead ? '标记未读' : '标为已读'}</span>
                    </div>
                \`;

                // Set up inner click for toggled-read
                const toggleBtn = card.querySelector(".text-indigo-500, .text-indigo-400");
                toggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    setReadStatus(art.url, !isRead);
                    renderArticlesList();
                };

                container.appendChild(card);
            });

            updateUnreadCountBadge();
            lucide.createIcons();
        }

        function selectArticle(art) {
            activeArticle = art;
            setReadStatus(art.url, true);
            
            // Adjust layouts
            document.getElementById("reader-placeholder").style.display = "none";
            const contentFrame = document.getElementById("reader-content-frame");
            contentFrame.style.display = "flex";
            contentFrame.classList.remove("hidden");
            
            // On mobile, trigger responsive popup/drawer
            if (window.innerWidth < 768) {
                // simple layout alert fallback or we can show a floating full modal
                contentFrame.classList.add("fixed", "inset-0", "z-50", "bg-white", "dark:bg-[#0c0c0e]");
            }

            // Sync Header Detail Fields
            document.getElementById("article-title").textContent = art.title;
            const extLink = document.getElementById("article-external-link");
            extLink.href = art.url;

            const badge = document.getElementById("article-pub-badge");
            badge.textContent = new Date(art.pubDate).toLocaleString();

            // Cover handle
            const coverDiv = document.getElementById("article-cover");
            const img = document.getElementById("article-cover-img");
            if (art.imageUrl) {
                img.src = art.imageUrl;
                coverDiv.style.display = "block";
                coverDiv.classList.remove("hidden");
            } else {
                coverDiv.style.display = "none";
                coverDiv.classList.add("hidden");
            }

            // Tabs UI Reset
            setReaderTab(art.aiSummary ? 'ai' : 'summary');
            renderArticlesList();
        }

        function setReaderTab(tab) {
            activeTab = tab;
            
            // Toggle Visual tab class
            const tabs = {
                summary: document.getElementById("tab-summary"),
                ai: document.getElementById("tab-ai"),
                content: document.getElementById("tab-content")
            };

            Object.keys(tabs).forEach(t => {
                const element = tabs[t];
                if (t === tab) {
                    element.className = "flex-1 py-1.5 font-semibold text-slate-800 dark:text-white bg-white dark:bg-slate-900 rounded-lg text-center transition-all flex items-center justify-center gap-1 shadow-sm";
                } else {
                    element.className = "flex-1 py-1.5 font-semibold border-transparent text-slate-500 dark:text-slate-405 hover:text-slate-200 text-center transition-all flex items-center justify-center gap-1 hover:bg-slate-200/50 dark:hover:bg-slate-900/40 rounded-lg";
                }
            });

            updateActiveArticleContentText();
        }

        function updateActiveArticleContentText() {
            if (!activeArticle) return;
            const container = document.getElementById("tab-content-container");
            container.innerHTML = "";

            const textSzClass = FONT_CLASSES[fontScaleLevel + 1] || "text-sm";
            const leadClass = LEADING_CLASSES[fontScaleLevel + 1] || "leading-relaxed";

            if (activeTab === 'summary') {
                container.innerHTML = \`<div class="p-5 bg-white dark:bg-[#111115] border border-slate-200 dark:border-slate-850 rounded-2xl">
                    <h4 class="text-xs font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <i data-lucide="file-text" class="w-3.5 h-3.5"></i> 极简内容原摘要
                    </h4>
                    <p class="\${textSzClass} \${leadClass} text-slate-700 dark:text-slate-300 whitespace-pre-line">\${activeArticle.summary}</p>
                </div>\`;
            } else if (activeTab === 'ai') {
                if (activeArticle.aiSummary) {
                    container.innerHTML = \`<div class="p-5 bg-emerald-500/5 border border-emerald-500/20 dark:border-emerald-550/15 rounded-2xl shadow-sm">
                        <h4 class="text-xs font-bold text-emerald-500 dark:text-emerald-400 tracking-wider mb-3.5 flex items-center gap-1.5 select-none">
                            <i data-lucide="sparkles" class="w-4 h-4 text-emerald-400"></i> AI 深度黄金提炼中文翻译
                        </h4>
                        <p class="\${textSzClass} \${leadClass} text-slate-700 dark:text-slate-300 select-text whitespace-pre-line leading-relaxed">\${activeArticle.aiSummary}</p>
                    </div>\`;
                } else {
                    container.innerHTML = \`<div class="p-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-center text-xs text-slate-400 dark:text-slate-550 space-y-2">
                        <i data-lucide="sparkles" class="w-8 h-8 mx-auto text-slate-300 dark:text-slate-705"></i>
                        <p class="font-medium">此内容抓取暂未包含 AI 黄金总结</p>
                        <p class="text-[10px] text-slate-400 max-w-xs mx-auto">由于此文章非最新置顶推荐，或在抓取时未启用内置 AI 接口。您可以在原始部署面板中点击 [一键对话] 或阅读获取。</p>
                    </div>\`;
                }
            } else if (activeTab === 'content') {
                const bodyContent = activeArticle.content || activeArticle.summary;
                container.innerHTML = \`<div class="p-5 bg-white dark:bg-[#111115] border border-slate-200 dark:border-slate-850 rounded-2xl select-text">
                    <h4 class="text-xs font-bold text-slate-600 dark:text-slate-400 mb-3 flex items-center gap-1.5 select-none">
                        <i data-lucide="align-left" class="w-3.5 h-3.5"></i> 干净正文内容 (\${bodyContent.length} 字符)
                    </h4>
                    <p class="\${textSzClass} \${leadClass} text-slate-700 dark:text-slate-300 whitespace-pre-line select-text font-sans">\${bodyContent}</p>
                </div>\`;
            }

            lucide.createIcons();
        }

        function setUnreadFilter(unreadOnly) {
            filterUnreadOnly = unreadOnly;
            
            const allBtn = document.getElementById("filter-all-btn");
            const unreadBtn = document.getElementById("filter-unread-btn");

            if (unreadOnly) {
                unreadBtn.className = "px-3 py-1 bg-indigo-650 text-white rounded font-bold flex-1 transition-all";
                allBtn.className = "px-3 py-1 text-slate-500 hover:text-indigo-400 rounded flex-1 transition-all";
            } else {
                allBtn.className = "px-3 py-1 bg-indigo-650 text-white rounded font-bold flex-1 transition-all";
                unreadBtn.className = "px-3 py-1 text-slate-500 dark:text-slate-405 hover:text-indigo-400 rounded flex-1 transition-all flex items-center justify-center gap-1";
            }

            renderArticlesList();
        }

        function closeReader() {
            activeArticle = null;
            const contentFrame = document.getElementById("reader-content-frame");
            contentFrame.style.display = "none";
            contentFrame.classList.add("hidden");
            contentFrame.classList.remove("fixed", "inset-0", "z-50");
            
            document.getElementById("reader-placeholder").style.display = "flex";
            renderArticlesList();
        }

        function markAllAsRead() {
            dbArticles.forEach(art => {
                setReadStatus(art.url, true);
            });
            renderArticlesList();
        }
    </script>
</body>
</html>`;
}


// 2. Generate Portable React + Vite Code Base in standard ZIP File Buffer
export async function generateReactViteZip(title: string, description: string, articles: ExportArticle[]): Promise<Buffer> {
  const zip = new JSZip();

  const safeTitle = (title || "MedRss 独立订阅版").replace(/"/g, '\\"');
  const safeDesc = (description || "基于 React-Vite & Tailwind 构建的超强阅读引擎").replace(/"/g, '\\"');

  // Inject package.json
  const packageJson = {
    "name": "rss-react-vite-dashboard",
    "private": true,
    "version": "1.0.0",
    "type": "module",
    "scripts": {
      "dev": "vite",
      "build": "tsc && vite build",
      "preview": "vite preview"
    },
    "dependencies": {
      "react": "^19.0.0",
      "react-dom": "^19.0.0",
      "lucide-react": "^0.468.0"
    },
    "devDependencies": {
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      "@vitejs/plugin-react": "^4.3.4",
      "autoprefixer": "^10.4.20",
      "postcss": "^8.4.49",
      "tailwindcss": "^3.4.17",
      "typescript": "~5.6.2",
      "vite": "^6.0.3"
    }
  };
  zip.file("package.json", JSON.stringify(packageJson, null, 2));

  // tsconfig.json
  const tsconfig = {
    "compilerOptions": {
      "target": "ES2020",
      "useDefineForClassFields": true,
      "lib": ["DOM", "DOM.Iterable", "ES2020"],
      "module": "ESNext",
      "skipLibCheck": true,
      "moduleResolution": "node",
      "allowSyntheticDefaultImports": true,
      "strict": true,
      "forceConsistentCasingInFileNames": true,
      "moduleDetection": "force",
      "jsx": "react-jsx",
      "isolatedModules": true,
      "noEmit": true
    },
    "include": ["src"]
  };
  zip.file("tsconfig.json", JSON.stringify(tsconfig, null, 2));

  // vite.config.ts
  const viteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});`;
  zip.file("vite.config.ts", viteConfig);

  // tailwind.config.js
  const tailwindConfig = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
}`;
  zip.file("tailwind.config.js", tailwindConfig);

  // postcss.config.js
  const postcssConfig = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}`;
  zip.file("postcss.config.js", postcssConfig);

  // index.html
  const indexHtml = `<!doctype html>
<html lang="zh-CN" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle} - RSS 精炼阅读站</title>
  </head>
  <body class="bg-[#0b0b0d] text-slate-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
  zip.file("index.html", indexHtml);

  // Create src tree
  const src = zip.folder("src");
  if (!src) throw new Error("Could not construct ZIP path hierarchy.");

  // src/main.tsx
  const srcMain = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);`;
  src.file("main.tsx", srcMain);

  // src/index.css
  const srcCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  overflow-x: hidden;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: rgba(30, 30, 35, 0.2);
}
::-webkit-scrollbar-thumb {
  background: rgba(100, 116, 139, 0.2);
  border-radius: 999px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(100, 116, 139, 0.4);
}`;
  src.file("index.css", srcCss);

  // src/data.ts
  const srcData = `export interface FeedArticle {
  id: string;
  title: string;
  url: string;
  summary: string;
  pubDate: string;
  content?: string;
  imageUrl?: string;
  aiSummary?: string;
}

export interface RSSMeta {
  title: string;
  description: string;
  exportedAt: string;
}

export const RSS_METADATA: RSSMeta = {
  title: "${safeTitle}",
  description: "${safeDesc}",
  exportedAt: "${new Date().toISOString()}"
};

export const INSTALLED_ARTICLES: FeedArticle[] = ${JSON.stringify(articles, null, 2)};
`;
  src.file("data.ts", srcData);

  // src/App.tsx (A beautiful dashboard applet!)
  const srcApp = `import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  Moon, 
  Sun, 
  Search, 
  Rss, 
  Layers, 
  Clock, 
  Copy, 
  Check, 
  ExternalLink, 
  Sparkles, 
  Trash2, 
  BookOpenCheck,
  RotateCcw,
  Compass
} from 'lucide-react';
import { INSTALLED_ARTICLES, RSS_METADATA, FeedArticle } from './data';

export default function App() {
  const [articles, setArticles] = useState<FeedArticle[]>(INSTALLED_ARTICLES);
  const [selectedArticle, setSelectedArticle] = useState<FeedArticle | null>(null);
  const [activeTab, setActiveTab] = useState<'summary' | 'ai' | 'content'>('summary');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterUnreadOnly, setFilterUnreadOnly] = useState(false);
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('base');
  const [darkMode, setDarkMode] = useState(true);
  
  const [readUrls, setReadUrls] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('standalone_read_status_map');
    return saved ? JSON.parse(saved) : {};
  });

  useEffect(() => {
    localStorage.setItem('standalone_read_status_map', JSON.stringify(readUrls));
  }, [readUrls]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const toggleRead = (url: string) => {
    setReadUrls(prev => {
      const updated = { ...prev, [url]: !prev[url] };
      return updated;
    });
  };

  const markAllAsRead = () => {
    const next: Record<string, boolean> = {};
    articles.forEach(a => {
      next[a.url] = true;
    });
    setReadUrls(next);
  };

  const resetAllReadStatus = () => {
    setReadUrls({});
  };

  const selectArticle = (art: FeedArticle) => {
    setSelectedArticle(art);
    setReadUrls(prev => ({ ...prev, [art.url]: true }));
    setActiveTab(art.aiSummary ? 'ai' : 'summary');
  };

  // Filtering
  const filteredArticles = articles.filter(art => {
    const matchesSearch = !searchQuery || 
      art.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      art.summary.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesUnread = !filterUnreadOnly || !readUrls[art.url];
    return matchesSearch && matchesUnread;
  });

  const unreadCount = articles.filter(a => !readUrls[a.url]).length;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-[#0c0c0e] dark:text-slate-100 transition-colors duration-200">
      
      {/* Top Header */}
      <header className="bg-white dark:bg-[#121215] border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between shrink-0 shadow-sm z-10">
        <div class="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-500/10">
            <Rss className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-slate-850 dark:text-white leading-none">{RSS_METADATA.title}</h1>
            <p className="text-[10px] text-slate-500 mt-1.5 line-clamp-1 max-w-sm">{RSS_METADATA.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Main search and sizes */}
          <div className="relative hidden md:block">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-3.5 h-3.5" />
            </span>
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="快速检索打包的文章标题或大意..." 
              className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-700 dark:text-slate-200 focus:outline-[#6366f1] w-64"
            />
          </div>

          <div className="bg-indigo-500/10 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 rounded-lg px-2.5 py-1.5 text-[10px] font-mono font-semibold">
            合包共计: {articles.length} 篇
          </div>

          <button 
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-450 rounded-lg transition-colors"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <div className="flex items-center border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-slate-50 dark:bg-slate-900">
            <button 
              onClick={() => setFontSize('sm')} 
              className={\`px-2 py-1 text-[10px] hover:bg-slate-200 dark:hover:bg-slate-800 \${fontSize === 'sm' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400'}\`}
            >
              小
            </button>
            <button 
              onClick={() => setFontSize('base')} 
              className={\`px-2 py-1 text-[10px] hover:bg-slate-200 dark:hover:bg-slate-800 border-x border-slate-200 dark:border-slate-800 \${fontSize === 'base' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400'}\`}
            >
              中
            </button>
            <button 
              onClick={() => setFontSize('lg')} 
              className={\`px-2 py-1 text-[10px] hover:bg-slate-200 dark:hover:bg-slate-800 \${fontSize === 'lg' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400'}\`}
            >
              大
            </button>
          </div>
        </div>
      </header>

      {/* Main Board */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Sidebar */}
        <aside className="w-full md:w-[360px] lg:w-[410px] border-r border-slate-200 dark:border-slate-850 bg-white dark:bg-[#0f0f12] flex flex-col shrink-0 overflow-hidden">
          
          <div className="p-3 border-b border-slate-100 dark:border-slate-850 flex items-center justify-between gap-2 shrink-0">
            <div className="flex bg-slate-100 dark:bg-[#121215] border border-slate-200 dark:border-slate-800 rounded-lg p-0.5 text-[10px] flex-1">
              <button 
                onClick={() => setFilterUnreadOnly(false)}
                className={\`flex-1 py-1 rounded font-medium transition-all \${!filterUnreadOnly ? 'bg-indigo-600 text-white font-bold' : 'text-slate-500 dark:text-slate-450'}\`}
              >
                全部
              </button>
              <button 
                onClick={() => setFilterUnreadOnly(true)}
                className={\`flex-1 py-1 rounded font-medium transition-all flex items-center justify-center gap-1 \${filterUnreadOnly ? 'bg-indigo-600 text-white font-bold' : 'text-slate-500 dark:text-slate-450'}\`}
              >
                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse"></span>
                未读 ({unreadCount})
              </button>
            </div>

            <div className="flex gap-1.5 shrink-0">
              <button 
                onClick={markAllAsRead}
                className="p-1 px-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-350 text-[10px] font-semibold border border-slate-200 dark:border-slate-800 rounded-md transition-all shrink-0"
              >
                全部已读
              </button>
              <button 
                onClick={resetAllReadStatus}
                title="重置阅读状态"
                className="p-1 px-1.5 bg-slate-100 hover:bg-slate-250 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-450 border border-slate-200 dark:border-slate-800 rounded-md transition-all shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Search Mobile */}
          <div className="p-3 border-b border-slate-100 dark:border-slate-850 md:hidden block shrink-0">
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索所有文章标题..." 
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-700 dark:text-slate-200"
            />
          </div>

          {/* List Area */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredArticles.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-500 dark:text-slate-600">
                <Compass className="w-8 h-8 text-slate-400 dark:text-slate-800 mx-auto mb-2" />
                <span>暂无符合筛选条件的文章</span>
              </div>
            ) : (
              filteredArticles.map(art => {
                const isSelected = selectedArticle?.url === art.url;
                const isRead = !!readUrls[art.url];
                return (
                  <div 
                    key={art.url}
                    onClick={() => selectArticle(art)}
                    className={\`p-3.5 mx-1 rounded-xl cursor-pointer transition-all border outline-none \${
                      isSelected 
                        ? 'bg-indigo-600/10 border-indigo-505 text-white shadow-xl shadow-indigo-605/5' 
                        : 'bg-transparent border-transparent hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300'
                    }\`}
                  >
                    <div className="flex items-start justify-between gap-2.5 mb-1">
                      <div className="flex items-center gap-1.5 max-w-[85%]">
                        <span className={\`w-1.5 h-1.5 rounded-full shrink-0 \${isRead ? 'bg-slate-300 dark:bg-slate-800' : 'bg-emerald-400 animate-pulse'}\`}></span>
                        <h4 className={\`text-xs font-bold leading-normal truncate \${
                          isRead 
                            ? 'text-slate-400 dark:text-slate-500 font-normal line-through' 
                            : 'text-slate-855 dark:text-slate-200'
                        }\`}>
                          {art.title}
                        </h4>
                      </div>
                      {art.aiSummary && (
                        <span className="text-[8px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold scale-90 px-1 py-0.5 rounded font-mono shrink-0">AI</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-450 dark:text-slate-500 line-clamp-2 leading-relaxed mb-2">{art.summary}</p>
                    <div className="flex justify-between items-center text-[9px] text-slate-400 font-mono">
                      <span>{new Date(art.pubDate).toLocaleDateString([], { month: '2-digit', day: '2-digit' })}</span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRead(art.url);
                        }}
                        className="text-indigo-500 dark:text-indigo-400 hover:underline select-none"
                      >
                        {isRead ? "标记未读" : "设为已读"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Reader pane */}
        <section className="flex-1 flex flex-col overflow-hidden bg-slate-50/50 dark:bg-[#070709]/20">
          {!selectedArticle ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 text-slate-400 dark:text-slate-700 gap-4">
              <BookOpen className="w-16 h-16 opacity-30" />
              <div>
                <h3 className="text-sm font-semibold mb-1">开始阅览专属 RSS 合集</h3>
                <p className="text-[11px] leading-relaxed max-w-xs mx-auto text-slate-400 dark:text-slate-600">
                  点击左侧打包文章可在当前区域直接加载并畅快阅读。系统支持在 React 本地自愈状态读取。
                </p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto px-6 py-8 md:px-10">
                <div className="max-w-3xl mx-auto space-y-6">
                  
                  {selectedArticle.imageUrl && (
                    <div className="w-full h-[180px] md:h-[260px] rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800">
                      <img src={selectedArticle.imageUrl} className="w-full h-full object-cover" alt="Article Cover" />
                    </div>
                  )}

                  <div className="space-y-3">
                    <h2 className="text-lg md:text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight leading-snug">
                      {selectedArticle.title}
                    </h2>
                    
                    <div className="flex items-center gap-3 text-[10px] md:text-xs text-slate-400 border-b border-slate-200 dark:border-slate-850 pb-4">
                      <span className="font-mono bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded text-slate-450 dark:text-slate-500">
                        {new Date(selectedArticle.pubDate).toLocaleString()}
                      </span>
                      <span>•</span>
                      <a href={selectedArticle.url} target="_blank" rel="noreferrer" className="hover:text-indigo-400 flex items-center gap-1 underline transition-colors">
                        <span>直达源网站</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex border-b border-slate-200 dark:border-slate-850 bg-slate-100 dark:bg-[#101013] rounded-xl p-0.5 select-none text-xs">
                    <button 
                      onClick={() => setActiveTab('summary')}
                      className={\`flex-1 py-1.5 font-semibold rounded-lg text-center transition-all flex items-center justify-center gap-1 \${
                        activeTab === 'summary' ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-200'
                      }\`}
                    >
                      <span>1. 极简概要</span>
                    </button>
                    <button 
                      onClick={() => setActiveTab('ai')}
                      className={\`flex-1 py-1.5 font-semibold rounded-lg text-center transition-all flex items-center justify-center gap-1 \${
                        activeTab === 'ai' ? 'bg-white dark:bg-slate-900 text-slate-855 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-200'
                      }\`}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      <span>2. AI 深度黄金提炼</span>
                    </button>
                    <button 
                      onClick={() => setActiveTab('content')}
                      className={\`flex-1 py-1.5 font-semibold rounded-lg text-center transition-all flex items-center justify-center gap-1 \${
                        activeTab === 'content' ? 'bg-white dark:bg-slate-900 text-slate-855 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-200'
                      }\`}
                    >
                      <span>3. 分段正文细读</span>
                    </button>
                  </div>

                  {/* Tab Contents */}
                  <div className={\`space-y-5 select-text \${fontSize === 'sm' ? 'text-xs' : fontSize === 'base' ? 'text-sm' : 'text-base'}\`}>
                    {activeTab === 'summary' && (
                      <div className="p-5 bg-white dark:bg-[#111115] border border-slate-200 dark:border-slate-800 rounded-2xl">
                        <h4 className="text-xs font-bold text-indigo-505 dark:text-indigo-400 uppercase mb-2">内容极简原摘要</h4>
                        <p className="text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">{selectedArticle.summary}</p>
                      </div>
                    )}
                    
                    {activeTab === 'ai' && (
                      selectedArticle.aiSummary ? (
                        <div className="p-5 bg-emerald-500/5 border border-emerald-500/2 transition-all rounded-2xl shadow-sm">
                          <h4 className="text-xs font-bold text-emerald-555 dark:text-emerald-400 mb-3.5 flex items-center gap-1.5">
                            <Sparkles className="w-4 h-4 text-emerald-400" /> 
                            AI 深度黄金提炼翻译
                          </h4>
                          <p className="text-slate-705 dark:text-slate-300 whitespace-pre-line leading-relaxed">{selectedArticle.aiSummary}</p>
                        </div>
                      ) : (
                        <div className="p-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-center text-xs text-slate-400 dark:text-slate-605 space-y-2">
                          <Sparkles className="w-8 h-8 text-slate-400 dark:text-slate-705 mx-auto opacity-40" />
                          <p className="font-medium">此内容抓取暂未包含 AI 黄金总结</p>
                          <p className="text-[10px]">您可以去原始控制面板中选中此文章并点击 AI 全文深入对话。</p>
                        </div>
                      )
                    )}

                    {activeTab === 'content' && (
                      <div className="p-5 bg-white dark:bg-[#111115] border border-slate-200 dark:border-slate-800 rounded-2xl select-text">
                        <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400 mb-3 select-none">网页干净正文 ({selectedArticle.content?.length || 0} 字符)</h4>
                        <p className="text-slate-700 dark:text-slate-303 whitespace-pre-line select-text font-sans leading-relaxed">
                          {selectedArticle.content || selectedArticle.summary}
                        </p>
                      </div>
                    )}
                  </div>

                </div>
              </div>

              {/* Reader bottom toolbar */}
              <div className="p-4 border-t border-slate-200 dark:border-slate-850 bg-white dark:bg-[#121215]/60 flex items-center justify-end shrink-0">
                <button 
                  onClick={() => setSelectedArticle(null)}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold hover:shadow-lg transition-all"
                >
                  已读完
                </button>
              </div>

            </div>
          )}
        </section>

      </div>
    </div>
  );
}
`;
  src.file("App.tsx", srcApp);

  // Compile ZIP asynchronously to node buffer
  return await zip.generateAsync({ type: "nodebuffer" });
}
