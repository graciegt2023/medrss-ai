import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { RSSFeed, RSSBundle, FeedArticle, ChatMessage } from "./src/types";
import Parser from "rss-parser";
import { generateHtmlReader, generateReactViteZip } from "./src/exportTemplate";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Set up simple database storage
const DB_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DB_DIR, "db.json");

interface Database {
  feeds: RSSFeed[];
  bundles: RSSBundle[];
  settings?: {
    autoUpdate: boolean;
    updateIntervalHours: number;
  };
}

function initDB(): Database {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const defaultDB: Database = { feeds: [], bundles: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDB, null, 2));
    return defaultDB;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse db, resetting", e);
    const defaultDB: Database = { feeds: [], bundles: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDB, null, 2));
    return defaultDB;
  }
}

function saveDB(data: Database) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Robust JSON extraction utility to safely parse response from different AI models
function safeParseJsonContent(rawText: string): any {
  if (!rawText) return {};
  const trimmed = rawText.trim();
  
  // Try direct parse first
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    console.warn("[JSON Parser] Direct JSON.parse failed. Attempting robust clean-up/extraction...");
  }

  // 1. Try stripping markdown fence blocks (e.g. ```json ... ``` or ``` ... ```)
  let cleanStr = trimmed;
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/ig;
  let fenceMatch;
  while ((fenceMatch = fenceRegex.exec(trimmed)) !== null) {
    const blockContent = fenceMatch[1].trim();
    try {
      return JSON.parse(blockContent);
    } catch (e) {
      // Keep searching in the block using structural scanner below
      cleanStr = blockContent;
    }
  }

  // 2. Structural Scanning Fallback: Scan every '{' and match with closing '}' from right-to-left
  const braceIndices: number[] = [];
  for (let i = 0; i < cleanStr.length; i++) {
    if (cleanStr[i] === '{') braceIndices.push(i);
  }
  
  for (const startIdx of braceIndices) {
    for (let endIdx = cleanStr.length - 1; endIdx > startIdx; endIdx--) {
      if (cleanStr[endIdx] === '}') {
        const candidate = cleanStr.substring(startIdx, endIdx + 1);
        try {
          return JSON.parse(candidate);
        } catch (e) {
          // Try a few minor syntax fixes
          try {
            const fixed = candidate
              .replace(/,\s*([}\]])/g, '$1') // remove trailing commas
              .replace(/[\x00-\x1F\x7F-\x9F]/g, ""); // strip control characters
            return JSON.parse(fixed);
          } catch (eInner) {
            // Check next closing brace
          }
        }
      }
    }
  }

  // 3. Fallback for Array outputs starting with '['
  const bracketIndices: number[] = [];
  for (let i = 0; i < cleanStr.length; i++) {
    if (cleanStr[i] === '[') bracketIndices.push(i);
  }

  for (const startIdx of bracketIndices) {
    for (let endIdx = cleanStr.length - 1; endIdx > startIdx; endIdx--) {
      if (cleanStr[endIdx] === ']') {
        const candidate = cleanStr.substring(startIdx, endIdx + 1);
        try {
          return JSON.parse(candidate);
        } catch (e) {
          try {
            const fixed = candidate
              .replace(/,\s*([}\]])/g, '$1')
              .replace(/[\x00-\x1F\x7F-\x9F]/g, "");
            return JSON.parse(fixed);
          } catch (eInner) {}
        }
      }
    }
  }

  throw new Error(`Invalid JSON format. Could not parse or extract a valid JSON structure from response: "${trimmed.substring(0, 150)}..."`);
}

// Extract and resolve actual destination URLs from tracker/search engine redirect chains (e.g. Yahoo search referrals)
function resolveRedirectUrl(url: string): string {
  if (!url || typeof url !== "string") return url;
  
  try {
    // 1. Yahoo redirect link format: /RU=https%3a%2f%2f... or RU=https%3a%2f%2f...
    if (url.includes("r.search.yahoo.com") || url.includes("/RU=") || url.includes("/ru=") || url.includes("?RU=") || url.includes("?ru=")) {
      // Decode any nested RU parameter
      const ruMatch = url.match(/[\/\?&]RU=([^&\/]+)/i);
      if (ruMatch && ruMatch[1]) {
        try {
          const decoded = decodeURIComponent(ruMatch[1]);
          if (decoded && decoded.startsWith("http")) {
            console.log(`[URL Resolver] Successfully intercepted and decoded Yahoo redirect: ${url} -> ${decoded}`);
            return decoded;
          }
        } catch (decErr) {
          // Fallback parsing in case decodeURIComponent is strict on specific url encodings
          const simpleDecoded = unescape(ruMatch[1]);
          if (simpleDecoded && simpleDecoded.startsWith("http")) {
            console.log(`[URL Resolver] Decoded Yahoo redirect via unescape: ${simpleDecoded}`);
            return simpleDecoded;
          }
        }
      }
    }

    // 2. Generic url parameter redirect (e.g. ?url=... or ?redirect=...)
    if (url.includes("?") || url.includes("&")) {
      const parsed = new URL(url);
      const possibleParams = ["url", "dest", "target", "destination", "redirect", "to", "link", "ru"];
      for (const param of possibleParams) {
        const val = parsed.searchParams.get(param);
        if (val && val.startsWith("http")) {
          console.log(`[URL Resolver] Intercepted parameter-based redirect via '${param}': ${url} -> ${val}`);
          return val;
        }
      }
    }
  } catch (err: any) {
    console.warn(`[URL Resolver] Error resolving potential redirect for ${url}:`, err.message);
  }
  return url;
}

// Helper to inspect HTML content for Cloudflare protection checks, captchas, and other crawling block pages
function isCloudBlockOrErrorPage(html: string): boolean {
  if (!html) return true;
  const text = html.trim();
  if (text.length < 200) return true;

  const lower = text.toLowerCase();
  
  // Title tag checks (using resilient attribute-matching regex)
  const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const titleVal = titleMatch[1].toLowerCase().trim();
    
    // Check for exact matching or highly specific security/error titles
    const exactErrorTitles = [
      "403 forbidden", "403", "404", "500", "502", "503", "504",
      "access denied", "access forbidden", "forbidden", "unauthorized",
      "attention required!", "just a moment...", "just a moment", "security check",
      "cloudflare", "site lock", "web security", "ip block", "not acceptable",
      "unauthorized access", "blocked", "web shield", "ddos protection", "captcha"
    ];
    
    if (exactErrorTitles.includes(titleVal)) {
      return true;
    }
    
    // Highly specific error indicators in the title
    if (
      titleVal.includes("please verify") ||
      titleVal.includes("security check") ||
      titleVal.includes("robot check") ||
      titleVal === "attention required!" ||
      titleVal === "one more step" ||
      titleVal.includes("ddos protection") ||
      titleVal.includes("cloudflare") ||
      titleVal.includes("cloudfront error") ||
      titleVal.includes("403 forbidden") ||
      titleVal.includes("500 internal server error") ||
      titleVal.includes("502 bad gateway") ||
      titleVal.includes("503 service unavailable") ||
      titleVal.includes("504 gateway timeout") ||
      titleVal.startsWith("error 403") ||
      titleVal.startsWith("error 503") ||
      titleVal.startsWith("error 500") ||
      titleVal.startsWith("access denied") ||
      titleVal === "suspected robot activity" ||
      titleVal === "checking your browser" ||
      (titleVal.includes("yahoo") && (titleVal.includes("999") || titleVal.includes("forbidden") || titleVal.includes("access denied")))
    ) {
      return true;
    }
  }

  // Body and script content checks for bot protection filters and Yahoo 403 Forbidden pages
  if (
    lower.includes("challenges.cloudflare.com") ||
    lower.includes("cf-challenge") ||
    lower.includes("cloudflare-challenge") ||
    lower.includes("please enable js and disable any ad blocker") ||
    lower.includes("please turn on javascript") ||
    lower.includes("enable cookies to continue") ||
    (lower.includes("enable cookies") && lower.includes("cloudflare")) ||
    lower.includes("ddos-guard") ||
    lower.includes("sucuri-shield") ||
    lower.includes("verify you are a human") ||
    lower.includes("verify you are human") ||
    lower.includes("checking your browser") ||
    lower.includes("checking if the site connection is secure") ||
    lower.includes("bot protection") ||
    lower.includes("bot verification") ||
    lower.includes("human verification") ||
    lower.includes("403 forbidden") ||
    lower.includes("yahoo! - 403") ||
    lower.includes("yahoo! - 999") ||
    lower.includes("access denied") ||
    lower.includes("unauthorized access") ||
    lower.includes("security clearance") ||
    lower.includes("wayback machine has not archived") ||
    lower.includes("not archived that url") ||
    lower.includes("page is not available on the web") ||
    lower.includes("google search - cache") && lower.includes("error 404") ||
    (lower.includes("cloudflare") && (lower.includes("captcha") || lower.includes("block") || lower.includes("challenge-form")))
  ) {
    return true;
  }

  return false;
}

// Lazy Gemini SDK client initialization
function getGeminiClient(customApiKey?: string): GoogleGenAI {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in Settings > Secrets.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// Helper to fetch any webpage with timeout and user agent
async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "max-age=0",
        "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        ...options.headers,
      },
      signal: controller.signal
    });
    clearTimeout(id);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: Status ${res.status}`);
    }
    return await res.text();
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Proxy-supported web crawler node proxy redirect wrapper to resolve 403 Forbidden and cloud blocks
async function fetchWithProxyFallback(url: string, options: any = {}, timeoutMs = 35000): Promise<string> {
  url = resolveRedirectUrl(url);
  const proxyEndpoints = [
    { name: "Direct", url: url, timeout: 6000 },
    { name: "Direct (Googlebot SEO Bypass)", url: url, timeout: 6005, headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" } },
    { name: "Direct (Social Crawler Preview Bypass)", url: url, timeout: 6010, headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Accept": "*/*" } },
    { name: "Direct (Mobile Safari Bypass)", url: url, timeout: 6015, headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8" } },
    { name: "Direct (Chrome MacOS Bypass)", url: url, timeout: 6020, headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8" } },
    { name: "Jina Reader Proxy", url: `https://r.jina.ai/${url}`, timeout: 12000, headers: { "Accept": "text/plain", "X-No-Links": "false", "X-No-Images": "false" } },
    { name: "corsproxy.org", url: `https://corsproxy.org/?url=${encodeURIComponent(url)}`, timeout: 10000 },
    { name: "corsproxy.io", url: `https://corsproxy.io/?${encodeURIComponent(url)}`, timeout: 10000 },
    { name: "cors.lol", url: `https://cors.lol/?url=${encodeURIComponent(url)}`, timeout: 10000 },
    { name: "Google Web Cache Bypass", url: `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`, timeout: 12000 },
    { name: "Wayback Machine Cache Bypass", url: `https://web.archive.org/web/2/${url}`, timeout: 15000 },
    { name: "yacdn.org", url: `https://yacdn.org/proxy/${url}`, timeout: 12000 },
    { name: "api.codetabs.com", url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, timeout: 12000 },
    { name: "allorigins.winJSON", url: `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, timeout: 30000 },
    { name: "allorigins.win", url: `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, timeout: 30000 },
    { name: "thingproxy.freeboard.io", url: `https://thingproxy.freeboard.io/fetch/${url}`, timeout: 12000 }
  ];

  let lastError: any = null;
  for (const proxy of proxyEndpoints) {
    try {
      const proxyMaxTimeout = proxy.timeout;
      const currentTimeout = timeoutMs < 15000 ? Math.min(proxyMaxTimeout, timeoutMs) : proxyMaxTimeout;
      
      console.log(`[Crawler Flow] Engaging node ${proxy.name} for candidate retrieval...`);
      
      // For Direct / Jina modes, we support the customized crawler headers to satisfy target server checks
      const fetchOpts: any = { signal: options.signal };
      if (proxy.name.startsWith("Direct") || proxy.name === "Jina Reader Proxy") {
        fetchOpts.headers = { ...(proxy.headers || {}), ...(options.headers || {}) };
      }
      
      const resText = await fetchWithTimeout(proxy.url, fetchOpts, currentTimeout);
      
      let cleanText = resText || "";
      if (proxy.name.endsWith("JSON") && cleanText.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(cleanText);
          if (parsed.contents) {
            cleanText = parsed.contents;
          }
        } catch (e) {
          // ignore parsing error
        }
      }

      if (cleanText && cleanText.trim().length > 150) {
        if (isCloudBlockOrErrorPage(cleanText)) {
          console.log(`[Crawler Flow] Node ${proxy.name} returned a validation checkpoint. Routing to next alternative...`);
          continue;
        }
        console.log(`[Crawler Flow] Successfully resolved content using ${proxy.name} (Payload size: ${cleanText.length} characters)`);
        return cleanText;
      }
    } catch (err: any) {
      console.log(`[Crawler Flow] Node ${proxy.name} completed status sequence. Activating next redundancy route.`);
      lastError = err;
    }
  }

  throw new Error(`Target website returned Status 403 Forbidden/Cloud Blocked, and all ${proxyEndpoints.length - 1} web proxy fallback nodes failed to retrieve clean webpage contents. (Last error: ${lastError?.message || lastError})`);
}

// Emergency Zero-AI Rules Extraction Engine for general websites
function heuristicExtractFeed(rawHtml: string, baseUrl: string): { feedTitle: string, feedDescription: string, articles: any[] } {
  console.log(`[Heuristics Engine] Running zero-AI fallback parser on retrieved HTML for ${baseUrl}...`);
  
  // Extract feed title
  let feedTitle = "Web Feed";
  const titleMatch = rawHtml.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    feedTitle = titleMatch[1]
      .replace(/&#038;/g, '&')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/<\/?[^>]+(>|$)/g, "")
      .replace(/[^a-zA-Z0-9\s\u4e00-\u9fa5\-\|]/g, '')
      .trim();
  }
  
  // Clean target URL for domain
  let domain = baseUrl;
  try {
    domain = new URL(baseUrl).hostname;
  } catch (e) {}

  const articles: any[] = [];
  const seenUrls = new Set<string>();

  // Helper to add unique valid articles
  const addArticle = (title: string, href: string, summary: string, dateStr?: string) => {
    try {
      if (!href || href.startsWith("#") || href.includes("javascript:") || href.includes("mailto:") || href.includes("tel:") || href.startsWith("whatsapp:")) return;
      const absoluteUrl = new URL(href, baseUrl).href;
      
      // Filter out mainpages, categories, pages, tags, feeds, etc.
      const parsed = new URL(absoluteUrl);
      if (parsed.pathname === "/" || parsed.pathname === "" || parsed.pathname.startsWith("/category/") || parsed.pathname.startsWith("/tag/") || parsed.pathname.startsWith("/author/") || parsed.pathname.includes("/feed/")) {
        return;
      }
      
      const cleanTitle = title.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (cleanTitle.length < 8 || cleanTitle.toLowerCase().includes("read more") || cleanTitle.toLowerCase().includes("continue reading") || cleanTitle.toLowerCase().includes("no comments")) {
        return;
      }
      
      if (seenUrls.has(absoluteUrl)) return;
      seenUrls.add(absoluteUrl);

      const cleanSummary = summary.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().substring(0, 300);

      articles.push({
        title: cleanTitle,
        url: absoluteUrl,
        summary: cleanSummary || "点击阅读原文查看此更新的完整详情。",
        pubDate: dateStr || new Date().toISOString()
      });
    } catch (e) {}
  };

  // 1. Try grouping by standard WordPress <article> blocks
  const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = articleRegex.exec(rawHtml)) !== null && articles.length < 15) {
    const block = match[1];
    // Find URL & Title in the block. Usually inside an h1/h2/h3 or standard link
    const linkMatch = block.match(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (linkMatch) {
      const href = linkMatch[1];
      const linkText = linkMatch[2];
      
      // Try to find a header text for cleaner title
      const hMatch = block.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
      let title = hMatch ? hMatch[1] : linkText;
      // strip any a links inside header text
      title = title.replace(/<a[^>]*>([\s\S]*?)<\/a>/i, "$1");

      // Try to find datetime
      const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/i) || block.match(/<time[^>]*>([\s\S]*?)<\/time>/i);
      const pubDate = timeMatch ? timeMatch[1] : undefined;

      // Try to find summary
      const pMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const summary = pMatch ? pMatch[1] : "点击阅读原文查看此更新的完整详情。";

      addArticle(title, href, summary, pubDate);
    }
  }

  // 2. If <article> matching didn't yield enough, try matching header links
  if (articles.length < 3) {
    console.log("[Heuristics Engine] Under 3 articles found via article tags. Swapping to Heading links fallback...");
    const headingLinkRegex = /<h([2-4])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let headMatch;
    while ((headMatch = headingLinkRegex.exec(rawHtml)) !== null && articles.length < 15) {
      const headingContent = headMatch[2];
      const linkMatch = headingContent.match(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      if (linkMatch) {
        const href = linkMatch[1];
        const title = linkMatch[2];
        addArticle(title, href, "点击阅读原文查看此更新的完整详情。");
      }
    }
  }

  // 3. Last resort general links scanning
  if (articles.length === 0) {
    console.log("[Heuristics Engine] No articles found via wrappers. Performing global link scanning...");
    // Find absolute URLs with keyword path patterns or specific extensions
    const generalLinkRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let genMatch;
    while ((genMatch = generalLinkRegex.exec(rawHtml)) !== null && articles.length < 10) {
      const href = genMatch[1];
      const title = genMatch[2];
      if (href && (href.startsWith("http") || href.split("/").length > 3)) {
        addArticle(title, href, "点击阅读原文查看此更新的完整详情。");
      }
    }
  }

  console.log(`[Heuristics Engine] Zero-AI Scraper discovered ${articles.length} posts for ${feedTitle}`);

  return {
    feedTitle,
    feedDescription: `本地免 AI 应急抓取引擎生成的 RSS 订阅源 (${domain})`,
    articles
  };
}

// Clean HTML to capture maximum details but keep payload lightweight
function cleanHTML(html: string, baseUrl: string): string {
  // Strip head, styles, and scripts entirely
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Extract title if available
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1].trim() : '';

  const bodyMatch = clean.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    clean = bodyMatch[1];
  }
  
  // Convert standard anchor tags to readable structured link formats for Gemini
  clean = clean.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (match, href, text) => {
    let absoluteUrl = href;
    try {
      if (href && !href.startsWith('javascript:') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
        absoluteUrl = new URL(href, baseUrl).href;
      }
    } catch (e) {
      // Ignore
    }
    const cleanText = text.replace(/<[^>]+>/g, '').trim();
    if (cleanText && absoluteUrl && absoluteUrl.startsWith('http')) {
      return ` [ARTICLE_LINK: ${cleanText} | URL: ${absoluteUrl}] `;
    }
    return '';
  });

  // Strip other HTML elements
  clean = clean.replace(/<[^>]+>/g, ' ');
  // Compress spaces
  clean = clean.replace(/\s+/g, ' ').trim();
  
  return `Page Title: ${pageTitle}\n${clean.substring(0, 50000)}`;
}

// Lightweight webpage main content extractor
function extractMainContent(html: string): string {
  // Strip head, scripts, styles, forms, headers, footers, navs, comments
  let clean = html;
  clean = clean.replace(/<!--[\s\S]*?-->/g, ''); // Remove HTML comments
  clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  clean = clean.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
  clean = clean.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  clean = clean.replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '');
  
  // Strip header, footer, nav, sidebar tags completely
  clean = clean.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '');
  clean = clean.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '');
  clean = clean.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '');
  clean = clean.replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, '');
  clean = clean.replace(/<div\b[^>]*?(?:class|id)="[^"]*?(?:footer|header|nav|sidebar|comment|ad|menu|share|recommend)[^"]*"[^>]*?>[\s\S]*?<\/div>/gi, '');

  let body = clean;
  const bodyMatch = clean.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    body = bodyMatch[1];
  }

  // Formatting key structural elements
  body = body.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
  body = body.replace(/<br\s*\/?>/gi, '\n');
  body = body.replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n# $1\n');
  
  // Strip remaining HTML tags
  body = body.replace(/<[^>]+>/g, ' ');
  
  // Decode core HTML entities
  body = body.replace(/&nbsp;/g, ' ')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&amp;/g, '&')
             .replace(/&quot;/g, '"')
             .replace(/&apos;/g, "'")
             .replace(/&#39;/g, "'");

  // Format clean line-by-line list
  const lines = body.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  return lines.join('\n');
}

// Helper to resolve absolute URLs
function resolveAbsoluteUrl(relativeUrl: string, baseUrl: string): string {
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch (e) {
    return relativeUrl;
  }
}

// Extract main/cover image from HTML content
function extractCoverImageFromHtml(html: string, articleUrl: string): string | undefined {
  if (!html) return undefined;
  
  // 1. Try og:image meta tag
  const ogMatch = html.match(/<meta\s+[^>]*property=["']og:image["']\s+content=["']([^"']+)["']/i) || 
                  html.match(/<meta\s+[^>]*content=["']([^"']+)["']\s+property=["']og:image["']/i);
  if (ogMatch && ogMatch[1]) {
    return resolveAbsoluteUrl(ogMatch[1], articleUrl);
  }

  // 2. Try twitter:image meta tag
  const twitterMatch = html.match(/<meta\s+[^>]*name=["']twitter:image["']\s+content=["']([^"']+)["']/i) ||
                       html.match(/<meta\s+[^>]*content=["']([^"']+)["']\s+name=["']twitter:image["']/i);
  if (twitterMatch && twitterMatch[1]) {
    return resolveAbsoluteUrl(twitterMatch[1], articleUrl);
  }

  // 3. Try link image_src
  const linkImgMatch = html.match(/<link\s+[^>]*rel=["']image_src["']\s+href=["']([^"']+)["']/i) ||
                        html.match(/<link\s+[^>]*href=["']([^"']+)["']\s+rel=["']image_src["']/i);
  if (linkImgMatch && linkImgMatch[1]) {
    return resolveAbsoluteUrl(linkImgMatch[1], articleUrl);
  }

  // 4. Try parsing <img> tags inside HTML, avoiding logos, icons, small tracking pixels
  const imgRegex = /<img\s+[^>]*src=["']([^"']+)["']/gi;
  let match;
  const candidates: string[] = [];
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (
      src.includes("pixel") ||
      src.includes("spacer") ||
      src.includes("avatar") ||
      src.includes("logo") ||
      src.includes("icon") ||
      src.includes("ad") ||
      src.includes("share") ||
      src.endsWith(".gif") ||
      src.startsWith("data:")
    ) {
      continue;
    }
    candidates.push(resolveAbsoluteUrl(src, articleUrl));
  }

  if (candidates.length > 0) {
    return candidates[0];
  }

  return undefined;
}

// Fetch and store clean article full text contents using our lightweight extractor
async function populateArticleContents(articles: FeedArticle[], baseUrl: string, customAiSettings?: any): Promise<FeedArticle[]> {
  const fetchPromises = articles.map(async (art, idx) => {
    try {
      if (!art.url || !art.url.startsWith("http")) {
        art.content = art.summary;
        return art;
      }
      console.log(`Pre-fetching clean content for article [${idx + 1}/${articles.length}]: ${art.title} (${art.url})`);
      const html = await fetchWithProxyFallback(art.url, {}, 6000); // 6s timeout per article
      const cleaned = extractMainContent(html);
      
      // Cache up to 8000 characters of clean content
      art.content = cleaned.substring(0, 8000) || art.summary;

      // Extract main/cover image from original HTML
      const discoveredImg = extractCoverImageFromHtml(html, art.url);
      if (discoveredImg) {
        art.imageUrl = discoveredImg;
        console.log(`[Cover Image Discovered] Found main image for ${art.title}: ${discoveredImg}`);
      }

      // Generate AI summary for the top 10 articles in the list
      if (idx < 10) {
        console.log(`[Auto AI Summarize] Generating Chinese summary for top-tier article [${idx + 1}]: ${art.title}`);
        try {
          const summary = await summarizeArticleTextWithAi(art.title, art.content, customAiSettings);
          if (summary && summary.length > 20) {
            art.aiSummary = summary;
          }
        } catch (sumErr) {
          console.error(`[Auto AI Summarize Error] Failed summarizing ${art.title}:`, sumErr);
        }
      }
    } catch (e) {
      console.error(`Could not pre-fetch article text from ${art.url}, falling back to summary.`, e);
      art.content = art.summary;
    }
    return art;
  });

  return Promise.all(fetchPromises);
}

// Merge list of old and new articles cleanly (de-duplicate by URL)
// Ensures already crawled historical articles are kept fully intact (preserving their generated IDs, content body, cover images, and AI summaries)
// and new articles are merged. Historical limits (like capping at 50) are removed to support permanent retention.
function mergeArticles(oldArticles: FeedArticle[], newArticles: FeedArticle[]): FeedArticle[] {
  const merged: FeedArticle[] = [];
  const urlsSeen = new Set<string>();

  // 1. Prioritize and keep existing historical articles exactly as they are in the database (unmodified)
  for (const old of oldArticles) {
    if (old && old.url) {
      const urlKey = old.url.toLowerCase().trim();
      if (!urlsSeen.has(urlKey)) {
        merged.push(old);
        urlsSeen.add(urlKey);
      }
    }
  }

  // 2. Safely add newly-crawler articles that do not exist yet in history
  for (const art of newArticles) {
    if (art && art.url) {
      const urlKey = art.url.toLowerCase().trim();
      if (!urlsSeen.has(urlKey)) {
        merged.push(art);
        urlsSeen.add(urlKey);
      }
    }
  }

  // Sort by publication date desc to make sure oldest stay at bottom, and do NOT slice/cap so they are permanently preserved
  return merged.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
}

// Helper to search DuckDuckGo HTML search results
async function searchWebViaDuckDuckGo(query: string): Promise<string> {
  console.log(`[DDG Crawler] Fetching DuckDuckGo HTML search page for query: "${query}"...`);
  // Use long duration with proxy fallback to guarantee a results retrieval
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  return await fetchWithProxyFallback(ddgUrl, {}, 30000);
}

// Clean and Parse DuckDuckGo search results safely with regex
function parseDuckDuckGoResults(html: string): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const cleanHtml = html.replace(/<!--[\s\S]*?-->/g, "");
  
  // RegEx to search for result blocks: Class result is common on html.duckduckgo.com
  const resultBlockRegex = /<div class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let match;
  let matchesFound = 0;
  
  while ((match = resultBlockRegex.exec(cleanHtml)) !== null && matchesFound < 15) {
    const block = match[1];
    
    // Extract title and deep URL
    const hrefTitleRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
    const hrefTitleMatch = hrefTitleRegex.exec(block);
    
    if (hrefTitleMatch) {
      let rawUrl = hrefTitleMatch[1];
      let title = hrefTitleMatch[2].replace(/<\/?[^>]+(>|$)/g, "").trim();
      
      // Decode DDG redirect URL if needed (uddg=URL)
      if (rawUrl.includes("uddg=")) {
        try {
          const urlObj = new URL(rawUrl.startsWith("http") ? rawUrl : "https:" + rawUrl);
          const uddg = urlObj.searchParams.get("uddg");
          if (uddg) {
            rawUrl = uddg;
          }
        } catch (e) {}
      }
      
      // Extract snippet
      const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
      const snippetMatch = snippetRegex.exec(block);
      let snippet = "";
      if (snippetMatch) {
        snippet = snippetMatch[1].replace(/<\/?[^>]+(>|$)/g, "").trim();
      } else {
        const divSnippetRegex = /<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
        const divSnippetMatch = divSnippetRegex.exec(block);
        if (divSnippetMatch) {
          snippet = divSnippetMatch[1].replace(/<\/?[^>]+(>|$)/g, "").trim();
        }
      }
      
      const cleanText = (str: string) => str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, "/")
        .replace(/&#39;/g, "'")
        .replace(/&#039;/g, "'")
        .replace(/&#038;/g, "&")
        .replace(/&nbsp;/g, " ")
        .trim();

      title = cleanText(title);
      snippet = cleanText(snippet);
      
      if (rawUrl && title && !rawUrl.includes("duckduckgo.com") && !rawUrl.includes("ad_provider")) {
        results.push({ title, url: rawUrl, snippet });
        matchesFound++;
      }
    }
  }

  if (results.length === 0) {
    console.log("[DDG Parser] resultBlockRegex returned 0, attempting simpler anchor parser...");
    const anchorRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/gi;
    let fallbackMatch;
    while ((fallbackMatch = anchorRegex.exec(cleanHtml)) !== null && results.length < 15) {
      let urlStr = fallbackMatch[1];
      let titleStr = fallbackMatch[2].replace(/<\/?[^>]+(>|$)/g, "").trim();
      let snippetStr = fallbackMatch[3].replace(/<\/?[^>]+(>|$)/g, "").trim();

      if (urlStr.includes("uddg=")) {
        try {
          const urlObj = new URL(urlStr.startsWith("http") ? urlStr : "https:" + urlStr);
          const uddg = urlObj.searchParams.get("uddg");
          if (uddg) urlStr = uddg;
        } catch (e) {}
      }

      const cleanText = (str: string) => str
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#039;/g, "'")
        .trim();

      results.push({
        title: cleanText(titleStr),
        url: urlStr,
        snippet: cleanText(snippetStr)
      });
    }
  }

  return results;
}

// Safely extract links from any search engine results page HTML
function extractLinksFromSearchEngine(html: string, domain: string): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const cleanHtml = html.replace(/<!--[\s\S]*?-->/g, "");
  
  // Clean domain prefix (remove www. and trailing slashes)
  const cleanDomain = domain.replace(/^www\./, "").replace(/\/$/, "");
  
  // High reliability regex to parse any anchor elements with HTTP/S address matching the domain
  const simplerAnchorRegex = /<a\s+[^>]*href=["'](https?:\/\/[^"'\s>]+?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  
  let match;
  const seenUrls = new Set<string>();
  
  while ((match = simplerAnchorRegex.exec(cleanHtml)) !== null && results.length < 25) {
    let url = match[1];
    let anchorText = match[2].replace(/<\/?[^>]+(>|$)/g, "").trim();
    
    // Clean duckduckgo redirects if any
    if (url.includes("uddg=")) {
      try {
        const urlObj = new URL(url);
        const uddg = urlObj.searchParams.get("uddg");
        if (uddg) url = uddg;
      } catch (e) {}
    }
    
    // Must contain the domain and not match clutter keywords
    if (url.includes(cleanDomain)) {
      try {
        const parsed = new URL(url);
        const lowPath = parsed.pathname.toLowerCase();
        
        // Filter common layout artifacts, logins, shares, feeds, or terms pages
        const matchesClutter = 
          lowPath.includes("/tag/") || 
          lowPath.includes("/category/") || 
          lowPath.includes("/search") ||
          lowPath.includes("/share") ||
          lowPath.includes("/login") ||
          lowPath.includes("/privacy-policy") ||
          lowPath.includes("/cookie-policy") ||
          parsed.search.includes("share=") ||
          parsed.search.includes("utm_") ||
          lowPath === "/" || 
          lowPath === "" ||
          url.endsWith(".rss") ||
          url.endsWith(".xml") ||
          url.endsWith(".png") ||
          url.endsWith(".jpg");
          
        if (!matchesClutter && !seenUrls.has(url)) {
          seenUrls.add(url);
          
          anchorText = anchorText
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#039;/g, "'")
            .replace(/\s+/g, " ")
            .trim();
            
          if (anchorText.length > 5) {
            results.push({
              title: anchorText,
              url: url,
              snippet: ""
            });
          }
        }
      } catch (e) {}
    }
  }
  return results;
}

// Search web with multiple fallback engines to ensure maximum success rate
async function searchWebFallback(domain: string, query: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const searchEngines = [
    {
      name: "DuckDuckGo HTML",
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    },
    {
      name: "Yahoo Search",
      url: `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`,
    },
    {
      name: "Bing Search",
      url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    }
  ];

  for (const engine of searchEngines) {
    try {
      console.log(`[Search Fallback] Crawling engine ${engine.name} for "${query}"...`);
      // Yahoo, DDG, Bing might have different cloud guards; fallback proxies will handle them
      const html = await fetchWithProxyFallback(engine.url, {}, 25000);
      
      let results: Array<{ title: string; url: string; snippet: string }> = [];
      if (engine.name.includes("DuckDuckGo")) {
        results = parseDuckDuckGoResults(html);
      }
      
      // If DDG specific parsing got nothing, or for other engines, extract links directly matching domain
      if (results.length === 0) {
        results = extractLinksFromSearchEngine(html, domain);
      }

      if (results.length > 0) {
        console.log(`[Search Fallback] Successfully crawled ${results.length} links using ${engine.name}!`);
        return results;
      }
    } catch (err: any) {
      console.warn(`[Search Fallback] Engine ${engine.name} was blocked or returned no results: ${err.message || err}. Trying next search engine node...`);
    }
  }
  
  throw new Error("All public fallback search engines and proxy redirects were blocked or failed. Please configure a Custom AI with your own API Key.");
}

// Convert DDG search data collection to RSS Feed structure via the active AI configurations
async function formatSearchResultsWithAi(
  results: Array<{ title: string; url: string; snippet: string }>,
  targetUrl: string,
  domain: string,
  customAiSettings?: any
): Promise<{ feedTitle: string; feedDescription: string; articles: any[] }> {
  const resultsText = results.map((r, i) => `Result #${i+1}:\nTitle: ${r.title}\nURL: ${r.url}\nSummary: ${r.snippet}\n`).join("\n");
  
  // Choice 1: Custom User AI endpoint (e.g. DeepSeek/OpenAI etc.)
  if (customAiSettings && customAiSettings.isEnabled && customAiSettings.apiKey && customAiSettings.baseUrl && customAiSettings.model) {
    console.log(`[DDG Fallback] Formatting search results via active Custom AI: ${customAiSettings.model}`);
    try {
      const endpoint = `${customAiSettings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const promptText = `你是一名专家级 RSS Feed 生成器。我们要根据最新新闻检索出的搜索匹配结果，重构成标准、干净的 RSS JSON 数据包。
目标网站：${targetUrl} (域名: ${domain})

下面是检索到的搜索结果内容列表：
================
${resultsText}
================

你必须提取出：
1. feedTitle: 合理拟定一个能概括该网站的名称（原网站名，可根据域名及文章判断，例如 "Medical Device Network" 等）
2. feedDescription: 用于描述该网站或其主要关注方向的极简中文宣传语
3. articles: 从上述搜索结果里提炼出排在最前面的核心相关文章（排除无关广告或导航页，最多10篇），每篇必须包含：
   - title: 正确的中文/中英对照文章标题
   - url: 上面给定的原始文章 href 绝对 URL（务必保持一致，切勿自己捏造）
   - summary: 2-3句极简中文内容及背景提炼
   - pubDate: 标准 ISO 时间戳格式（如果没提供具体日期，请合理设定一个 2026 年近期的标准发布时间字符串，如 2026-05-26T08:00:00Z）

你必须严格原样输出一个符合以下 JSON 规范的字符串（不要添加 Markdown 块标记 \`\`\`json 或任何其他前缀后缀）：
{
  "feedTitle": "网站名称",
  "feedDescription": "网站极简描述",
  "articles": [
    {
      "title": "文章标题",
      "url": "跳转原始 URL",
      "summary": "极简中文解析...",
      "pubDate": "2026-05-26T08:00:00Z"
    }
  ]
}`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${customAiSettings.apiKey}`
        },
        body: JSON.stringify({
          model: customAiSettings.model,
          messages: [
            { role: "system", content: "You are an expert news organizer. Return strictly the raw JSON without markdown formatting." },
            { role: "user", content: promptText }
          ],
          temperature: 0.1
        })
      });

      if (response.ok) {
        const resJson = await response.json();
        const content = resJson.choices?.[0]?.message?.content || "{}";
        return safeParseJsonContent(content);
      }
      console.warn(`[DDG Fallback] Custom AI formatting returned status ${response.status}. Trying Gemini fallback formatting...`);
    } catch (e) {
      console.error("[DDG Fallback] Custom AI formatting failed, trying Gemini formatting...", e);
    }
  }

  // Choice 2: Native Gemini client (if available)
  try {
    const isGeminiKey = customAiSettings && customAiSettings.isEnabled && customAiSettings.apiKey && 
      (customAiSettings.apiKey.startsWith("AIzaSy") || (customAiSettings.model && customAiSettings.model.toLowerCase().includes("gemini")));
    const useApiKey = isGeminiKey ? customAiSettings.apiKey : undefined;
    const ai = getGeminiClient(useApiKey);
    
    console.log("[DDG Fallback] Formatting search results via Gemini model...");
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Please convert this list of web search results for the website ${targetUrl} (domain: ${domain}) into a strictly formatted JSON Feed:
      
      Search Results:
      ${resultsText}`,
      config: {
        systemInstruction: "You are an expert news organizer. Map search results to the requested JSON RSS schema. Set realistic dates for the articles (current year is 2026). Return raw JSON.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            feedTitle: { type: Type.STRING },
            feedDescription: { type: Type.STRING },
            articles: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  url: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  pubDate: { type: Type.STRING }
                },
                required: ["title", "url", "summary"]
              }
            }
          },
          required: ["feedTitle", "feedDescription", "articles"]
        }
      }
    });

    const text = response.text || "{}";
    return safeParseJsonContent(text);
  } catch (err) {
    console.error("[DDG Fallback] Gemini formatting also failed. Using zero-AI heuristics...", err);
    // Choice 3: Simple heuristic map to satisfy fallback constraints
    const articles = results.map(r => ({
      title: r.title,
      url: r.url,
      summary: r.snippet || "通过 DuckDuckGo 搜索同步获取的新闻快讯文章。",
      pubDate: new Date().toISOString()
    }));
    return {
      feedTitle: domain.replace("www.", "") + " Live Feed",
      feedDescription: `从 ${domain} 的互联网公开检索结果中提炼出的实时公告更新通道。`,
      articles
    };
  }
}

// Search grounding fallback using Gemini's native Google Search Tool and a robust 2-step process
async function fetchFeedWithGeminiSearch(url: string, customAiSettings?: any): Promise<{ feedTitle: string, feedDescription: string, articles: any[] }> {
  console.log(`Fallback: Using Gemini Google Search Tool to discover feed content for ${url}`);
  
  // Extract domain name for better searching
  let domain = url;
  try {
    const parsedUrl = new URL(url);
    domain = parsedUrl.hostname;
  } catch (e) {
    // Ignore URL parsing error
  }

  // Pre-emptive optimize: If custom AI is enabled and isn't a Gemini API key, completely bypass the system's rate-limited Gemini key.
  const isCustomAiEnabled = customAiSettings && customAiSettings.isEnabled && customAiSettings.apiKey && customAiSettings.baseUrl && customAiSettings.model;
  const isCustomGemini = isCustomAiEnabled && 
    (customAiSettings.apiKey.startsWith("AIzaSy") || customAiSettings.model.toLowerCase().includes("gemini"));

  if (isCustomAiEnabled && !isCustomGemini) {
    console.log(`[Custom AI Search] Custom non-Gemini AI (${customAiSettings.model}) is active. Bypassing system Gemini search and executing multi-engine search crawls directly.`);
    try {
      const query = `site:${domain} OR "${domain}" news articles`;
      const results = await searchWebFallback(domain, query);
      console.log(`[Custom AI Search] Successfully crawled ${results.length} articles. Formatting via Custom AI (${customAiSettings.model})...`);
      return await formatSearchResultsWithAi(results, url, domain, customAiSettings);
    } catch (crawlerErr: any) {
      console.error(`[Custom AI Search] Direct search engine crawler fallback failed:`, crawlerErr);
      // Let it fall through to standard Gemini Search tool as last-standing effort
    }
  }

  try {
    const isGeminiKey = customAiSettings && customAiSettings.isEnabled && customAiSettings.apiKey && 
      (customAiSettings.apiKey.startsWith("AIzaSy") || (customAiSettings.model && customAiSettings.model.toLowerCase().includes("gemini")));
    
    const useApiKey = isGeminiKey ? customAiSettings.apiKey : undefined;
    const ai = getGeminiClient(useApiKey);

    // STEP 1: Query the Google Search tool without JSON constraints.
    // This allows the model to search freely, query multiple options, and gather accurate recent articles.
    const searchQuery = `Find the 10 most recent posts, news articles, or announcements from the website ${url} (or domain: ${domain}). Extract their exact titles, original absolute deep-link URLs (preferring articles under the ${domain} domain directly, not search engines), publication dates, and summary descriptions.`;
    
    const searchResponse = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: searchQuery,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: "You are an expert news researcher. Search the live web to find the most recent published articles/posts for the given website URL or domain. Provide a clean, detailed list including the website name, description, and the list of articles with their Titles, absolute original URLs, short 2-line Summaries, and approximate Publication Dates.",
      }
    });

    const searchReport = searchResponse.text || "";
    console.log("Gemini Search Grounding report retrieved:", searchReport.substring(0, 300) + "...");

    // STEP 2: Feed the unstructured search results back into Gemini to parse into the strictly structured schema.
    const parseResponse = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Please parse this researcher's report and format it strictly as a JSON object matching the target schemas.

Here is the researcher's report containing the website details and article listings:
---
${searchReport}
---

Your response MUST be a valid JSON object matching the requested schema. If some dates or descriptions are missing from the report, please reconstruct them appropriately based on current index context or use defaults. All article URLs MUST be absolute (e.g. starting with http:// or https://).`,
      config: {
        systemInstruction: "You are an expert JSON parsing assistant. Convert the provided news list report into the required JSON schema format. Return strictly valid JSON.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            feedTitle: { type: Type.STRING },
            feedDescription: { type: Type.STRING },
            articles: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  url: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  pubDate: { type: Type.STRING }
                },
                required: ["title", "url", "summary"]
              }
            }
          },
          required: ["feedTitle", "feedDescription", "articles"]
        }
      }
    });

    const rawText = parseResponse.text || "{}";
    return safeParseJsonContent(rawText);
  } catch (err: any) {
    console.warn(`[Search Fallback] Gemini Search grounding API failed (Error: ${err.message || err}). Transitioning to multi-engine search-crawler fallback...`);
    try {
      // Crawl multiple public search engine nodes
      const query = `site:${domain} OR "${domain}" news articles`;
      const results = await searchWebFallback(domain, query);
      
      console.log(`[Search Fallback] Successfully crawled ${results.length} search results. Formatting with active AI engine...`);
      return await formatSearchResultsWithAi(results, url, domain, customAiSettings);
    } catch (fallbackErr: any) {
      console.error(`[Search Fallback] Multi-engine search-crawler fallback failed as well: ${fallbackErr.message || fallbackErr}`);
      
      // If even fallback fails, raise the original quota error to let user know
      const isQuotaExceeded = err.message && (err.message.includes("429") || err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("quota"));
      if (isQuotaExceeded) {
        throw new Error(`系统内置的 Gemini AI 接口配额已耗尽。由于目标网站对云爬虫进行了封锁阻拦截，为了完美恢复扫描，请先打开右上角 [AI 接口配置] 并填入您自己的 API 密钥（推荐配置 DeepSeek，其稳定持久、提取迅速且绝对安全不上云）。`);
      }
      throw err;
    }
  }
}

// Helper to try parsing the target URL directly as a standard RSS feed.
// If it works, we skip AI scraping and extract natively.
async function tryParsingAsNativeRss(url: string): Promise<{ feedTitle: string; feedDescription: string; articles: any[]; isNativeRss: boolean } | null> {
  const parser = new Parser();
  console.log(`[Native RSS Check] Attempting to parse URL as direct RSS Feed: ${url}`);
  try {
    const parsed = await parser.parseURL(url);
    if (parsed) {
      console.log(`[Native RSS Check] Successfully parsed direct RSS feed: ${parsed.title}`);
      const articles = (parsed.items || []).slice(0, 30).map((item: any) => ({
        title: item.title || "Untitled Article",
        url: item.link || item.guid || url,
        summary: item.contentSnippet || item.summary || item.content || "No description provided.",
        pubDate: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()
      }));
      return {
        feedTitle: parsed.title || "Standard RSS Feed",
        feedDescription: parsed.description || "Direct RSS subscription feed",
        articles: articles,
        isNativeRss: true
      };
    }
  } catch (err: any) {
    console.log(`[Native RSS Check] URL ${url} is not a valid direct RSS feed, falling back to AI/scraping: ${err.message || err}`);
  }
  return null;
}

// Helper core action to parse website HTML contents via active AI model
async function generateFeedWithAi(cleanedHtml: string, url: string, customAiSettings?: any, rawHtmlForFallback?: string): Promise<{ feedTitle: string; feedDescription: string; articles: any[] }> {
  // Guard: If the crawled HTML matches a Cloudflare security page, captcha, or empty content, fail early to trigger Google Search fallback.
  if (isCloudBlockOrErrorPage(cleanedHtml) || cleanedHtml.length < 150) {
    throw new Error("Target webpage content matches security blocker, Cloudflare challenge, or lacks actual text content.");
  }

  // Option 1: User-enabled Custom OpenAI-compatible API (e.g. DeepSeek/OpenAI etc.)
  if (customAiSettings && customAiSettings.isEnabled && customAiSettings.apiKey && customAiSettings.baseUrl && customAiSettings.model) {
    console.log(`Forwarding extraction to Custom AI model: ${customAiSettings.model} at ${customAiSettings.baseUrl}`);
    try {
      const endpoint = `${customAiSettings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      
      const promptText = `你是一名专家级 RSS Feed 生成器。给定指定网址 $${url} 的网页清洗后文本内容，提取：
1. 网站标题 (feedTitle)
2. 网站描述 (feedDescription)
3. 包含最新 10 篇文章、公告或新闻项目的文章列表 (articles)

你必须严格返回一个符合以下规范的 JSON 格式：
{
  "feedTitle": "网站名称",
  "feedDescription": "网站描述或宣传语",
  "articles": [
    {
      "title": "文章标题",
      "url": "跳转到文章的绝对路径原始 URL",
      "summary": "2-3句极简中文内容概括",
      "pubDate": "ISO 格式或标准日期字符串"
    }
  ]
}

以下是要读取提取的清洗后页面 HTML 数据：
================
${cleanedHtml}
================

返回内容中必须直接包裹有且仅有符合上述要求的 JSON String（直接返回，不要添加 markdown 包裹说明，格式为纯裸 text JSON）。`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${customAiSettings.apiKey}`
        },
        body: JSON.stringify({
          model: customAiSettings.model,
          messages: [
            { role: "system", content: "You are an expert utility helper that generates strictly valid JSON formatting. Do not output conversational wrapper texts." },
            { role: "user", content: promptText }
          ],
          temperature: 0.2
        })
      });

      if (!response.ok) {
        const errTxt = await response.text();
        throw new Error(`Custom AI Endpoint responded with status ${response.status}: ${errTxt}`);
      }

      const resJson = await response.json();
      const content = resJson.choices?.[0]?.message?.content || "{}";
      return safeParseJsonContent(content);
    } catch (e: any) {
      console.error("Scraping with Custom AI failed, attempting Gemini fallback. Error:", e);
      // Fall through to Gemini if custom fails
    }
  }

  // Option 2: Default standard Gemini SDK
  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Please extract feed details and articles from this website URL: ${url}\n\nCleaned content:\n${cleanedHtml}`,
      config: {
        systemInstruction: "You are an expert RSS Feed Generator. Given the website text content, identify the website name, description, and list of the top 10 most recent articles or news items. Return strictly in JSON format matching the schema rules.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            feedTitle: { type: Type.STRING, description: "Title of the website" },
            feedDescription: { type: Type.STRING, description: "Description or slogan of the website" },
            articles: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  url: { type: Type.STRING, description: "Absolute URL to the article" },
                  summary: { type: Type.STRING },
                  pubDate: { type: Type.STRING }
                },
                required: ["title", "url", "summary"]
              }
            }
          },
          required: ["feedTitle", "feedDescription", "articles"]
        }
      }
    });

    const bodyText = response.text || "{}";
    return safeParseJsonContent(bodyText);
  } catch (err: any) {
    const isQuotaExceeded = err.message && (err.message.includes("429") || err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("quota"));
    
    if (rawHtmlForFallback) {
      console.warn(`[AI Engine] Gemini API call failed (Error: ${err.message || err}). Falling back to emergency zero-AI heuristic element parser...`);
      try {
        return heuristicExtractFeed(rawHtmlForFallback, url);
      } catch (heuristicErr: any) {
        console.error(`Emergency zero-AI parser fallback also failed: ${heuristicErr.message || heuristicErr}`);
      }
    }

    if (isQuotaExceeded) {
      throw new Error(`系统内置的 Gemini AI 接口配额已耗尽。由于目标网站对云爬虫进行了封锁阻拦截，请优先点击右上角 [AI 接口配置] 并填入您自己的 API Key（如 DeepSeek，其稳定不限速、提取精准且不耗用系统配额）。`);
    }
    throw err;
  }
}

// Core action to update a web feed
async function processUpdateFeed(feed: RSSFeed, customAiSettings?: any): Promise<RSSFeed> {
  console.log(`Starting scheduled refresh for feed: ${feed.title} (${feed.url})`);
  let parsed: any;
  
  // Try parsing as native RSS first
  const nativeRss = await tryParsingAsNativeRss(feed.url);
  if (nativeRss) {
    parsed = nativeRss;
    feed.isNativeRss = true;
  } else {
    try {
      const rawHtml = await fetchWithProxyFallback(feed.url, {}, 15000);
      const cleaned = cleanHTML(rawHtml, feed.url);
      parsed = await generateFeedWithAi(cleaned, feed.url, customAiSettings, rawHtml);
      feed.isNativeRss = false;
    } catch (err: any) {
      console.log(`[Crawler Info] Direct scrape fetch bypassed for ${feed.url} (Anti-bot block). Invoking Gemini Dynamic Search fallback...`);
      try {
        parsed = await fetchFeedWithGeminiSearch(feed.url, customAiSettings);
        feed.isNativeRss = false;
      } catch (fallbackErr: any) {
        console.error(`Gemini Search fallback also failed:`, fallbackErr);
        throw new Error(`Failed to update feed both via direct crawl and custom web search fallback: ${fallbackErr.message || fallbackErr}`);
      }
    }
  }
  
  const parsedArticles: FeedArticle[] = (parsed.articles || []).map((art: any) => ({
    id: Math.random().toString(36).substring(2, 9),
    title: art.title || "Untitled Article",
    url: art.url,
    summary: art.summary || "No description provided.",
    pubDate: art.pubDate || new Date().toISOString()
  }));

  // Identify new articles that aren't already fetched
  const existingUrls = new Set(feed.articles.map(a => a.url));
  const newArticles = parsedArticles.filter(art => !existingUrls.has(art.url));
  
  if (newArticles.length > 0) {
    await populateArticleContents(newArticles, feed.url, customAiSettings);
  }

  // Merge lists keeping older posts intact
  const merged = mergeArticles(feed.articles, parsedArticles);

  feed.title = parsed.feedTitle || feed.title;
  feed.description = parsed.feedDescription || feed.description;
  feed.articles = merged;
  feed.last_updated_at = new Date().toISOString();

  return feed;
}

// Generate valid standard RSS 2.0 XML
function generateRSSXML(feed: RSSFeed): string {
  const escapeXml = (unsafe: string) => {
    if (!unsafe) return "";
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  };

  const xmlItems = feed.articles.map(art => `
    <item>
      <title>${escapeXml(art.title)}</title>
      <link>${escapeXml(art.url)}</link>
      <guid isPermaLink="true">${escapeXml(art.url)}</guid>
      <pubDate>${new Date(art.pubDate || Date.now()).toUTCString()}</pubDate>
      <description>${escapeXml(art.summary)}</description>
    </item>`).join('');

  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(feed.title)}</title>
    <link>${escapeXml(feed.url)}</link>
    <description>${escapeXml(feed.description)}</description>
    <language>zh-cn</language>
    <lastBuildDate>${new Date(feed.last_updated_at || Date.now()).toUTCString()}</lastBuildDate>
    <generator>Website RSS Generator with Gemini</generator>
    ${xmlItems}
  </channel>
</rss>`;
}

// Generate valid bundle merged RSS XML
function generateBundleXML(bundle: RSSBundle, feeds: RSSFeed[]): string {
  const escapeXml = (unsafe: string) => {
    if (!unsafe) return "";
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  };

  const matchingFeeds = feeds.filter(f => bundle.feedIds.includes(f.id));
  interface MergedArticle extends FeedArticle {
    feedTitle: string;
  }
  
  const allArticles: MergedArticle[] = [];
  matchingFeeds.forEach(f => {
    f.articles.forEach(art => {
      allArticles.push({
        ...art,
        feedTitle: f.title
      });
    });
  });

  // Sort merged articles by pubDate desc
  allArticles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

  const xmlItems = allArticles.map(art => `
    <item>
      <title>[${escapeXml(art.feedTitle)}] ${escapeXml(art.title)}</title>
      <link>${escapeXml(art.url)}</link>
      <guid isPermaLink="true">${escapeXml(art.url)}</guid>
      <pubDate>${new Date(art.pubDate || Date.now()).toUTCString()}</pubDate>
      <description>${escapeXml(art.summary)}</description>
    </item>`).join('');

  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(bundle.name)} (Merged RSS Pack)</title>
    <link>#</link>
    <description>${escapeXml(bundle.description)}</description>
    <language>zh-cn</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>Website RSS Bundle Generator with Gemini</generator>
    ${xmlItems}
  </channel>
</rss>`;
}

// ================= API ROUTES =================

// Heuristic extractor to pull clean article structured markup from raw HTML safely
function extractReaderContent(html: string, url: string): { title: string; contentHtml: string } {
  let title = "";
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].replace(/<\/?[^>]+(>|$)/g, "").trim();
  }

  // Pre-clean the HTML to strip unneeded heavy assets, UI dynamic trackers or clutter tags
  let cleanHtml = html
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, "")
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, "")
    .replace(/<svg[^>]*>([\s\S]*?)<\/svg>/gi, "")
    .replace(/<header[^>]*>([\s\S]*?)<\/header>/gi, "")
    .replace(/<footer[^>]*>([\s\S]*?)<\/footer>/gi, "")
    .replace(/<nav[^>]*>([\s\S]*?)<\/nav>/gi, "")
    .replace(/<aside[^>]*>([\s\S]*?)<\/aside>/gi, "")
    .replace(/<iframe[^>]*>([\s\S]*?)<\/iframe>/gi, "")
    .replace(/<form[^>]*>([\s\S]*?)<\/form>/gi, "")
    .replace(/<noscript[^>]*>([\s\S]*?)<\/noscript>/gi, "")
    .replace(/<button[^>]*>([\s\S]*?)<\/button>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Locate the dominant text containing section
  let bodyContent = "";
  
  // High-chance element matches (Article tags or common main body classes in academia sites)
  const articleMatch = cleanHtml.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch = cleanHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  
  const bodyClassRegexes = [
    /<div[^>]+(?:class|id)=["'][^"']*(?:article-body|post-content|entry-content|story-content|article-content|journal-content|post_content|article__body|node-content|news-content|detail-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+(?:class|id)=["'][^"']*(?:main-content|content-body|core-content|articleText|post_body|entry_body|primary-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  ];

  if (articleMatch && articleMatch[1].length > 400) {
    bodyContent = articleMatch[1];
  } else if (mainMatch && mainMatch[1].length > 400) {
    bodyContent = mainMatch[1];
  } else {
    for (const regex of bodyClassRegexes) {
      const match = cleanHtml.match(regex);
      if (match && match[1].length > 400) {
        bodyContent = match[1];
        break;
      }
    }
  }

  // Fallback: If no heavy div block has been matched, grab paragraph blocks directly
  if (!bodyContent || bodyContent.trim().length < 200) {
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let pMatch;
    const paragraphs: string[] = [];
    while ((pMatch = pRegex.exec(cleanHtml)) !== null) {
      const pInnerVal = pMatch[1].replace(/<\/?[^>]+(>|$)/g, "").trim();
      if (pInnerVal.length > 25) {
        paragraphs.push(`<p class="mb-5 text-slate-300 leading-relaxed text-sm md:text-base">${pMatch[1]}</p>`);
      }
    }
    if (paragraphs.length > 0) {
      bodyContent = paragraphs.join("\n");
    }
  }

  // Absolute fallback: use whole body if empty
  if (!bodyContent || bodyContent.trim().length < 100) {
    const bodyMatch = cleanHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      bodyContent = bodyMatch[1];
    } else {
      bodyContent = cleanHtml;
    }
  }

  // Fine sanitization and premium CSS formatting rules injection
  let sanitized = bodyContent
    // Clean and delete generic empty divs, spacers and ad-clutter holders
    .replace(/<div[^>]*>\s*<\/div>/gi, "")
    // Clean styling class attributes to guarantee clean, custom unified dark tailwind rules
    .replace(/<([a-z0-1]+)([^>]*?)(?:style|class|id|onclick|onload)[\s\S]*?>/gi, (match, tag) => {
      // Retain critical image sources or links
      const href = match.match(/href=["']([^"']*)["']/i);
      const src = match.match(/src=["']([^"']*)["']/i);
      let newAttr = "";
      if (href) newAttr += ` ${href[0]}`;
      if (src) newAttr += ` ${src[0]}`;
      return `<${tag}${newAttr}>`;
    });

  // Inject beautiful, unified styled markup tag pairings
  sanitized = sanitized
    .replace(/<h1([^>]*)>/gi, '<h1 class="text-xl md:text-2xl font-bold text-slate-100 mt-6 mb-3 border-b border-slate-800 pb-2">')
    .replace(/<h2([^>]*)>/gi, '<h2 class="text-lg md:text-xl font-bold text-slate-200 mt-5 mb-2 border-b border-slate-800/60 pb-1">')
    .replace(/<h3([^>]*)>/gi, '<h3 class="text-md md:text-lg font-semibold text-slate-300 mt-4 mb-2">')
    .replace(/<p([^>]*)>/gi, '<p class="mb-5 text-slate-300 leading-relaxed text-sm md:text-base">')
    .replace(/<img([^>]*)>/gi, '<img class="max-w-full h-auto my-6 rounded-xl border border-slate-800 mx-auto" referrerPolicy="no-referrer">')
    .replace(/<ul([^>]*)>/gi, '<ul class="list-disc pl-5 mb-4 text-slate-300 space-y-2 text-sm">')
    .replace(/<ol([^>]*)>/gi, '<ol class="list-decimal pl-5 mb-4 text-slate-300 space-y-2 text-sm">')
    .replace(/<blockquote([^>]*)>/gi, '<blockquote class="border-l-4 border-indigo-500 pl-4 py-1 italic my-4 text-slate-400 bg-slate-900/40 rounded-r-md">')
    .replace(/<a([^>]*)>/gi, '<a target="_blank" class="text-indigo-400 hover:text-indigo-300 transition-colors underline decoration-indigo-400/30 font-medium">')
    .replace(/<table([^>]*)>/gi, '<table class="min-w-full border-collapse border border-slate-800 my-4 text-xs font-mono">');

  return {
    title: title || "正文详情",
    contentHtml: sanitized
  };
}

// Core Gemini grounding fallback to read protected webpage bodies safely
async function fetchArticleWithGeminiSearch(url: string, customAiSettings?: any): Promise<{ title: string; contentHtml: string }> {
  console.log(`[Gemini Grounding Extraction] Attempting to fetch live content for URL: ${url}`);
  try {
    const isCustomAiEnabled = customAiSettings && customAiSettings.isEnabled && customAiSettings.apiKey && customAiSettings.baseUrl && customAiSettings.model;
    const isCustomGemini = isCustomAiEnabled && 
      (customAiSettings.apiKey.startsWith("AIzaSy") || customAiSettings.model.toLowerCase().includes("gemini"));

    const useApiKey = isCustomGemini ? customAiSettings.apiKey : undefined;
    const ai = getGeminiClient(useApiKey);

    // Prompt instructions to search and parse the target url precisely
    const prompt = `Please locate, read, and extract the complete, full article content from this exact URL: ${url} using the Google Search Grounding tool. 
Do not output a summary. Extract the entire detailed body structure or contents found in its original language (e.g. Chinese or English).
Reconstruct the full paragraphs, subtitles, and tables.
Format your output strictly as a JSON object with:
"title": the exact name/title of this article,
"contentHtml": a clean, beautifully-structured HTML representation of the complete text (use safe tags: <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, blockquote, pre, code, table, tr, td). Do not include head, body, script, style, header, footer, or nav elements.

Target URL: ${url}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: "You are an expert academic library crawler and research text miner. Your goal is to fetch, read, and reconstruct the full, detailed textual contents of the provided URL accurately.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            contentHtml: { type: Type.STRING }
          },
          required: ["title", "contentHtml"]
        }
      }
    });

    const rawText = response.text || "{}";
    const parsed = safeParseJsonContent(rawText);
    if (parsed && parsed.contentHtml && parsed.contentHtml.length > 100) {
      console.log(`[Gemini Grounding Extraction] Successfully retrieved article text of length: ${parsed.contentHtml.length}`);
      return parsed;
    }
    throw new Error("Empty extraction parsed from Gemini response.");
  } catch (err: any) {
    console.error(`[Gemini Grounding Extraction] Failed:`, err.message || err);
    throw err;
  }
}

// Jina Reader to fetch protected or shielded webpages as clean markdown to bypass Cloudflare
async function fetchArticleWithJinaReader(url: string): Promise<{ title: string; contentHtml: string }> {
  console.log(`[Jina Reader Extraction] Fetching from r.jina.ai for URL: ${url}`);
  const jinaUrl = `https://r.jina.ai/${url}`;
  
  // Fetch text/markdown via timeout wrapper
  const responseText = await fetchWithTimeout(jinaUrl, {
    headers: {
      "Accept": "text/plain",
      "X-No-Links": "false",
      "X-No-Images": "false"
    }
  }, 22000);

  if (!responseText || responseText.trim().length < 200) {
    throw new Error("Jina Reader returned empty or too short response.");
  }

  const lowerText = responseText.toLowerCase();
  if (
    lowerText.includes("403 forbidden") ||
    lowerText.includes("access denied") ||
    lowerText.includes("unauthorized") ||
    lowerText.includes("yahoo! - 403") ||
    lowerText.includes("yahoo! - 999") ||
    (lowerText.includes("yahoo") && (lowerText.includes("403 forbidden") || lowerText.includes("error 999") || lowerText.includes("forbidden access"))) ||
    lowerText.includes("security barrier") ||
    lowerText.includes("cloudflare challenge") ||
    lowerText.includes("please enable javascript") ||
    lowerText.includes("captcha") ||
    lowerText.includes("ip-blocked") ||
    lowerText.includes("attention required") ||
    lowerText.includes("checking your browser")
  ) {
    throw new Error("Jina Reader fetched a block/error/forbidden page from the target website.");
  }

  // Check if Jina returned an error message or rate limit
  if (responseText.includes("limit exceeded") && responseText.length < 500) {
    throw new Error("Jina Reader rate limit exceeded.");
  }

  // Parse Title
  let title = "正文详情";
  const titleMatch = responseText.match(/Title:\s*(.+)/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  } else {
    const firstHeader = responseText.match(/^#\s+(.+)/m);
    if (firstHeader) title = firstHeader[1].trim();
  }

  // Extract content and strip introductory headers from Jina Reader's raw markdown response
  let mdLines = responseText.split("\n");
  let contentStartIndex = 0;
  for (let i = 0; i < Math.min(mdLines.length, 12); i++) {
    const line = mdLines[i].trim();
    if (line.startsWith("Title:") || line.startsWith("URL Source:") || line.startsWith("Published Time:") || line.startsWith("Author:")) {
      contentStartIndex = i + 1;
    }
  }
  const cleanMd = mdLines.slice(contentStartIndex).join("\n").trim();

  // Convert markdown to super-beautiful, unified styled HTML markup safely:
  let html = cleanMd;

  // Escaping simple HTML entities to avoid unsecure structures
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Re-format Headers
  html = html
    .replace(/^###\s+(.+)$/gm, '<h3 class="text-md md:text-lg font-semibold text-slate-300 mt-4 mb-2">$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2 class="text-lg md:text-xl font-bold text-slate-200 mt-5 mb-2 border-b border-slate-800 pb-1">$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1 class="text-xl md:text-2xl font-bold text-slate-100 mt-6 mb-3 border-b border-slate-800 pb-2">$1</h1>');

  // Unified bolding and styling
  html = html
    .replace(/\*\*([\s\S]*?)\*\*/g, '<strong class="font-bold text-slate-100">$1</strong>')
    .replace(/\*([\s\S]*?)\*/g, '<em class="italic text-slate-300">$1</em>');

  // Convert Links [text](url)
  html = html.replace(/\[([\s\S]*?)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" class="text-indigo-400 hover:text-indigo-300 transition-colors underline">$1</a>');

  // Convert Images ![alt](url)
  html = html.replace(/!\[([\s\S]*?)\]\((https?:\/\/[^\s\)]+)\)/g, '<img src="$2" alt="$1" class="max-w-full h-auto my-6 rounded-xl border border-slate-800 mx-auto" referrerPolicy="no-referrer">');

  // Convert blockquotes
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote class="border-l-4 border-indigo-500 pl-4 py-1 italic my-4 text-slate-400 bg-slate-900/40 rounded-r-md">$1</blockquote>');

  // Convert paragraph separators and list groups
  const sections = html.split(/\n\s*\n/);
  const formattedSections = sections.map(section => {
    const trimmed = section.trim();
    if (!trimmed) return "";
    
    if (trimmed.startsWith("<h") || trimmed.startsWith("<blockquote") || trimmed.startsWith("<ul") || trimmed.startsWith("<ol") || trimmed.startsWith("<li") || trimmed.startsWith("<img") || trimmed.startsWith("<table")) {
      return trimmed;
    }
    
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const listItems = trimmed.split(/\n[\-\*]\s+/).map(item => {
        let cleanItem = item.replace(/^[\-\*]\s+/, "").trim();
        return `<li class="text-slate-300 text-sm">${cleanItem}</li>`;
      });
      return `<ul class="list-disc pl-5 mb-4 text-slate-300 space-y-2 text-sm">${listItems.join("")}</ul>`;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const listItems = trimmed.split(/\n\d+\.\s+/).map(item => {
        let cleanItem = item.replace(/^\d+\.\s+/, "").trim();
        return `<li class="text-slate-300 text-sm">${cleanItem}</li>`;
      });
      return `<ol class="list-decimal pl-5 mb-4 text-slate-300 space-y-2 text-sm">${listItems.join("")}</ol>`;
    }

    return `<p class="mb-5 text-slate-300 leading-relaxed text-sm md:text-base">${trimmed.replace(/\n/g, "<br />")}</p>`;
  });

  return {
    title,
    contentHtml: formattedSections.filter(Boolean).join("\n")
  };
}

// Helper to summarize extracted article text into a single high-quality Chinese paragraph of 200-400 words
async function summarizeArticleTextWithAi(title: string, fullText: string, customAiSettings?: any): Promise<string> {
  // Strip tags or limit the fullText size to avoid context window pressure
  const cleanContentText = fullText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 7500);
  
  const systemInstruction = "你是一个顶级的学术与科技前沿编译学者。你的任务是针对提供的新闻、专刊、专利或文献的全文，提炼出一段极高质量、精准深刻、一针见血且逻辑严密的中文核心总结（精确控制在有且仅有一段文字，不分段，字数约200-400字，行文通顺畅达，直接输出总结内容，不要带任何前导语、翻译标记或诸如“本文介绍了...”等套话，确保句句全为干货干货，逻辑高度内凝）。";
  const promptText = `文章标题：${title}\n\n全文提取内容：\n${cleanContentText}\n\n请严格返回针对上述提取全文的有且只有一段的中文核心总结：`;

  // Try custom AI (DeepSeek, etc.) first if configured and enabled
  if (customAiSettings && customAiSettings.isEnabled && customAiSettings.apiKey && customAiSettings.baseUrl && customAiSettings.model) {
    console.log(`[Summarize AI] Summarizing article content via active Custom AI: ${customAiSettings.model}`);
    try {
      const endpoint = `${customAiSettings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${customAiSettings.apiKey}`
        },
        body: JSON.stringify({
          model: customAiSettings.model,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: promptText }
          ],
          temperature: 0.3
        })
      });

      if (response.ok) {
        const resJson = await response.json();
        const summary = resJson.choices?.[0]?.message?.content?.trim();
        if (summary && summary.length > 20) {
          return summary;
        }
      } else {
        const errTxt = await response.text();
        console.warn(`[Summarize AI] Custom AI endpoint failed: ${response.status} - ${errTxt}`);
      }
    } catch (e: any) {
      console.error("[Summarize AI] Custom AI summarizer failed, trying Gemini fallback...", e);
    }
  }

  // Fallback: Use standard Gemini SDK
  try {
    const isGeminiKey = customAiSettings && customAiSettings.isEnabled && customAiSettings.apiKey && 
      (customAiSettings.apiKey.startsWith("AIzaSy") || (customAiSettings.model && customAiSettings.model.toLowerCase().includes("gemini")));
    const useApiKey = isGeminiKey ? customAiSettings.apiKey : undefined;
    const ai = getGeminiClient(useApiKey);
    
    console.log("[Summarize AI] Summarizing content via Gemini model...");
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: promptText,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.3
      }
    });

    const summaryText = response.text?.trim();
    if (summaryText && summaryText.length > 20) {
      return summaryText;
    }
  } catch (err: any) {
    console.error("[Summarize AI] Gemini summarizer also failed:", err.message || err);
  }

  // Final fallback
  console.warn("[Summarize AI] All AI summarization services failed. Performing heuristic extraction summary...");
  return `【文献核心摘要】${cleanContentText.substring(0, 350)}...`;
}

// API for Reader Content extraction (supports GET/POST to pass custom AI settings securely)
async function handleReaderContent(req: any, res: any) {
  let url = req.body?.url || req.query?.url;
  const customAiSettings = req.body?.customAiSettings;

  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    return res.status(400).json({ error: "Invalid webpage URL. Make sure it starts with http:// or https://" });
  }

  url = resolveRedirectUrl(url);

  console.log(`[Reader Content] Premium extraction requested for URL: ${url}`);
  
  let rawHtml = "";
  let fetchFailed = false;
  let extracted: { title: string; contentHtml: string } | null = null;

  // Tier 1: Try direct crawler scraping using the premium proxy rotation chain
  try {
    rawHtml = await fetchWithProxyFallback(url, {}, 20000);
  } catch (err: any) {
    console.log(`[Reader Content] Direct and proxy crawling bypassed for ${url}: ${err.message || err}. Transitioning to Fallback Tiers...`);
    fetchFailed = true;
  }

  // Detect if access is blocked by Cloudflare anti-scraping / Captcha shields
  const isBlocked = fetchFailed || !rawHtml || isCloudBlockOrErrorPage(rawHtml);
  
  if (!isBlocked) {
    try {
      const parsedRes = extractReaderContent(rawHtml, url);
      // Ensure we actually extracted high quality contents (body text length > 350 chars)
      if (parsedRes && parsedRes.contentHtml && parsedRes.contentHtml.replace(/<[^>]+>/g, "").trim().length > 350) {
        console.log(`[Reader Content] Successfully parsed article directly (extracted text length: ${parsedRes.contentHtml.length})`);
        extracted = parsedRes;
      }
    } catch (parseErr) {
      console.error(`[Reader Content] Static regex extraction parser failed:`, parseErr);
    }
  }

  // Tier 2: Fetch via Jina Reader API (Highly efficient, bypasses Cloudflare, completely free, zero Gemini quota impact)
  if (!extracted) {
    try {
      const jinaResult = await fetchArticleWithJinaReader(url);
      if (jinaResult && jinaResult.contentHtml && jinaResult.contentHtml.replace(/<[^>]+>/g, "").trim().length > 250) {
        console.log(`[Reader Content] Successfully extracted full text using Jina Reader (text length: ${jinaResult.contentHtml.length})`);
        extracted = jinaResult;
      }
    } catch (jinaErr: any) {
      console.log(`[Reader Content Info] Jina Reader fallback bypassed: ${jinaErr.message || jinaErr}. Proceeding to Gemini grounding...`);
    }
  }

  // Tier 3: High capability Google Search Grounding with Gemini Model (Rate-limited, quota intensive)
  if (!extracted) {
    try {
      const aiResult = await fetchArticleWithGeminiSearch(url, customAiSettings);
      if (aiResult) {
        extracted = aiResult;
      }
    } catch (geminiErr: any) {
      console.error(`[Reader Content] Gemini Grounding fallback failed (e.g. Quota/429 limit):`, geminiErr.message || geminiErr);
    }
  }

  // Tier 4: Safe-harbor static rescue parse. Serve whatever partially retrieved HTML remains inside the database
  if (!extracted && rawHtml && rawHtml.length > 300 && !isCloudBlockOrErrorPage(rawHtml)) {
    try {
      console.log(`[Reader Content] Final rescue fallback: attempting static regex parse on raw cached assets.`);
      const lastRes = extractReaderContent(rawHtml, url);
      if (lastRes && lastRes.contentHtml && lastRes.contentHtml.length > 100) {
        extracted = lastRes;
      }
    } catch (rescueErr) {}
  }

  if (extracted) {
    try {
      console.log(`[Reader Content] Generating AI single-paragraph Chinese summary for: ${extracted.title}`);
      const summaryText = await summarizeArticleTextWithAi(extracted.title, extracted.contentHtml, customAiSettings);
      
      // Wrap it in a single paragraph formatted using custom Tailwind-compatible elegant structure
      const formattedContentHtml = `<div class="article-summary-wrapper py-6 px-7 bg-slate-900/40 rounded-2xl border border-slate-800/60 shadow-xl relative overflow-hidden my-4">
  <div class="absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b from-indigo-500 to-indigo-600"></div>
  <div class="space-y-4">
    <div class="flex items-center gap-2 text-xs text-indigo-400 font-bold tracking-wider uppercase select-none">
      <span class="px-2 py-0.5 bg-indigo-500/10 rounded-md border border-indigo-500/20">AI 智能精炼总结</span>
    </div>
    <p class="text-slate-200 text-sm md:text-base leading-relaxed font-sans select-text whitespace-pre-line first-letter:text-3xl first-letter:font-black first-letter:text-indigo-400 first-letter:mr-1.5 first-letter:float-left first-letter:leading-none">
      ${summaryText}
    </p>
  </div>
</div>`;

      // Save summary and image back to DB if available
      try {
        const db = initDB();
        let dbUpdated = false;
        for (const feed of db.feeds) {
          const art = feed.articles.find(a => a.url === url || a.url === req.body?.url || a.url === req.query?.url);
          if (art) {
            art.aiSummary = summaryText;
            if (rawHtml) {
              const discoveredImg = extractCoverImageFromHtml(rawHtml, art.url);
              if (discoveredImg) {
                art.imageUrl = discoveredImg;
              }
            }
            dbUpdated = true;
          }
        }
        if (dbUpdated) {
          saveDB(db);
        }
      } catch (dbErr) {
        console.error("Failed to backport on-demand summary/image to DB:", dbErr);
      }

      // Extract cover image if not already done
      const responseImg = rawHtml ? extractCoverImageFromHtml(rawHtml, url) : undefined;

      return res.json({
        title: extracted.title,
        contentHtml: formattedContentHtml,
        aiSummary: summaryText,
        imageUrl: responseImg
      });
    } catch (summaryErr: any) {
      console.error(`[Reader Content] Summarization failed:`, summaryErr.message || summaryErr);
      // Fallback to presenting the extracted text as-is in case summarizing fails
      return res.json(extracted);
    }
  }

  res.status(500).json({ 
    error: "该学术/防护站设定了特级人机验证网，在线读取受限。请您切换上方切换按钮，使用「原生网页 (视窗)」即可完全免跳转直接在此处浏览原文网页。" 
  });
}

app.post("/api/reader-content", handleReaderContent);
app.get("/api/reader-content", handleReaderContent);

// Proxy rendering to bypass standard iframe iframe/X-Frame-Options/CSP restrictions
app.get("/api/proxy-webpage", async (req, res) => {
  let url = req.query.url;
  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    return res.status(400).send("Invalid webpage URL. Make sure it starts with http:// or https://");
  }

  url = resolveRedirectUrl(url);

  try {
    console.log(`[Proxy Webpage] Inline secure rendering requested for source: ${url}`);
    
    // Fetch the target markup using the same proxy fallback chain designed for feed crawlers
    const rawHtml = await fetchWithProxyFallback(url, {}, 25000);

    // Clean and fix relative asset dependencies by injecting HTML `<base href="...">`
    let processedHtml = rawHtml;
    
    // Lowercase tag lookup for versatility
    const headIndex = processedHtml.toLowerCase().indexOf("<head>");
    if (headIndex !== -1) {
      const insertAt = headIndex + 6;
      processedHtml = 
        processedHtml.substring(0, insertAt) + 
        `\n<base href="${url}">\n<script>
          // Prevent standard framebreaker scripts from popping the user out of the App layout frame
          if (window.top !== window.self) {
            window.self = window.top;
          }
        </script>\n` + 
        processedHtml.substring(insertAt);
    } else {
      processedHtml = `<base href="${url}">\n` + processedHtml;
    }

    // Serve with correct html types
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(processedHtml);
  } catch (err: any) {
    console.error(`[Proxy Webpage] Failed loading target webpage ${url}:`, err);
    res.status(500).send(`
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { background: #0F0F11; color: #E2E8F0; font-family: system-ui, -apple-system, sans-serif; padding: 2rem; text-align: center; }
            .card { max-width: 580px; margin: 3rem auto; background: #141418; padding: 2.5rem; border-radius: 1.5rem; border: 1px solid #1E293B; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }
            h2 { color: #F43F5E; font-size: 1.25rem; font-weight: 750; margin-bottom: 1rem; }
            p { color: #94A3B8; font-size: 0.875rem; line-height: 1.6; margin-bottom: 2rem; }
            .btn-group { display: flex; flex-direction: column; gap: 0.75rem; align-items: center; justify-content: center; }
            a { width: 100%; max-width: 320px; text-decoration: none; font-size: 0.875rem; font-weight: 600; padding: 0.75rem 1.25rem; border-radius: 0.625rem; display: inline-block; transition: all 0.2s; box-sizing: border-box; }
            .btn-primary { background: #4F46E5; color: white; }
            .btn-primary:hover { background: #4338CA; }
            .btn-secondary { background: #10B981; color: white; }
            .btn-secondary:hover { background: #059669; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>外部原文网页加载受限</h2>
            <p>由于该学术或专刊网站设置了高级网络安全防御盾（如 Cloudflare 等多重人机防火墙规则），当前直接及中转代理节点被拦截。</p>
            <div class="btn-group">
              <a href="https://translate.google.com/translate?sl=auto&tl=zh-CN&u=${encodeURIComponent(url)}" class="btn-secondary" target="_blank">
                🚀 使用 Google 翻译抗封锁中转直连 (极力推荐)
              </a>
              <a href="${url}" class="btn-primary" target="_blank">
                在新标签页中安全直达源站
              </a>
            </div>
          </div>
        </body>
      </html>
    `);
  }
});

// Feed list
app.get("/api/feeds", (req, res) => {
  const db = initDB();
  res.json({ feeds: db.feeds });
});

// Create website to RSS feed (Scrapes URL on-demand using Gemini)
app.post("/api/feeds", async (req, res) => {
  const { url, customAiSettings } = req.body;
  if (!url || !url.startsWith("http")) {
    return res.status(400).json({ error: "Invalid website URL. Make sure it starts with http:// or https://" });
  }

  try {
    const db = initDB();
    
    // Check if feed already exists
    const existing = db.feeds.find(f => f.url.toLowerCase() === url.toLowerCase());
    if (existing) {
      return res.status(400).json({ error: "A subscription feed for this website already exists." });
    }

    console.log(`Analyzing website to generate RSS feed: ${url}`);
    let result: any;
    
    // Attempt direct native RSS parsing first
    const nativeRss = await tryParsingAsNativeRss(url);
    if (nativeRss) {
      result = nativeRss;
    } else {
      try {
        const rawHtml = await fetchWithProxyFallback(url, {}, 18000);
        const cleaned = cleanHTML(rawHtml, url);
        result = await generateFeedWithAi(cleaned, url, customAiSettings, rawHtml);
      } catch (scrapeErr: any) {
        console.log(`[Crawler Info] Direct scrape fetch bypassed for ${url} (Anti-bot block). Invoking Gemini Dynamic Search fallback...`);
        try {
          result = await fetchFeedWithGeminiSearch(url, customAiSettings);
        } catch (fallbackErr: any) {
          console.error(`Gemini Search fallback also failed for ${url}:`, fallbackErr);
          throw new Error(`Failed to generate feed both via direct crawl and custom web search fallback: ${fallbackErr.message || fallbackErr}`);
        }
      }
    }

    const articles: FeedArticle[] = (result.articles || []).map((art: any) => ({
      id: Math.random().toString(36).substring(2, 9),
      title: art.title || "Untitled Article",
      url: art.url,
      summary: art.summary || "No summary available.",
      pubDate: art.pubDate || new Date().toISOString()
    }));

    // Fetch and cache the full readable content of the top discovered articles in parallel
    await populateArticleContents(articles, url, customAiSettings);

    const newFeed: RSSFeed = {
      id: Math.random().toString(36).substring(2, 9),
      url,
      title: result.feedTitle || "Discovered RSS Feed",
      description: result.feedDescription || "Generated RSS feed for " + url,
      created_at: new Date().toISOString(),
      last_updated_at: new Date().toISOString(),
      articles,
      isNativeRss: !!result.isNativeRss
    };

    db.feeds.push(newFeed);
    saveDB(db);

    res.json({ success: true, feed: newFeed });
  } catch (err: any) {
    console.error("Failed to generate RSS feed:", err);
    res.status(500).json({ error: err.message || "An unexpected error occurred during website extraction." });
  }
});

// Delete RSS Feed
app.delete("/api/feeds/:id", (req, res) => {
  const { id } = req.params;
  const db = initDB();
  db.feeds = db.feeds.filter(f => f.id !== id);
  // Also remove this feed from bundle listings
  db.bundles.forEach(b => {
    b.feedIds = b.feedIds.filter(fId => fId !== id);
  });
  saveDB(db);
  res.json({ success: true });
});

// Refresh a selected feed manually
app.post("/api/feeds/:id/refresh", async (req, res) => {
  const { id } = req.params;
  const { customAiSettings } = req.body;
  const db = initDB();
  const index = db.feeds.findIndex(f => f.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "Feed not found" });
  }

  try {
    const updated = await processUpdateFeed(db.feeds[index], customAiSettings);
    db.feeds[index] = updated;
    saveDB(db);
    res.json({ success: true, feed: updated });
  } catch (err: any) {
    console.error(`Failed to manual refresh feed ${id}:`, err);
    res.status(500).json({ error: err.message || "Could not refresh feed." });
  }
});

// Bundle lists
app.get("/api/bundles", (req, res) => {
  const db = initDB();
  res.json({ bundles: db.bundles });
});

// Create Bundle merging multiple RSS feeds
app.post("/api/bundles", (req, res) => {
  const { name, description, feedIds } = req.body;
  if (!name || !feedIds || !Array.isArray(feedIds) || feedIds.length === 0) {
    return res.status(400).json({ error: "Please provide a name and at least one chosen feed to create subscription bundles." });
  }

  const db = initDB();
  const newBundle: RSSBundle = {
    id: Math.random().toString(36).substring(2, 9),
    name,
    description: description || "Custom merged subscription package",
    feedIds,
    created_at: new Date().toISOString()
  };

  db.bundles.push(newBundle);
  saveDB(db);

  res.json({ success: true, bundle: newBundle });
});

// Delete RSS Bundle
app.delete("/api/bundles/:id", (req, res) => {
  const { id } = req.params;
  const db = initDB();
  db.bundles = db.bundles.filter(b => b.id !== id);
  saveDB(db);
  res.json({ success: true });
});

// XML RSS Endpoints
app.get("/rss/feed/:id", (req, res) => {
  const db = initDB();
  const feed = db.feeds.find(f => f.id === req.params.id);
  if (!feed) {
    return res.status(404).send("RSS Feed not found");
  }

  const xml = generateRSSXML(feed);
  res.set("Content-Type", "application/rss+xml; charset=utf-8");
  res.send(xml);
});

app.get("/rss/bundle/:id", (req, res) => {
  const db = initDB();
  const bundle = db.bundles.find(b => b.id === req.params.id);
  if (!bundle) {
    return res.status(404).send("RSS Bundle not found");
  }

  const xml = generateBundleXML(bundle, db.feeds);
  res.set("Content-Type", "application/rss+xml; charset=utf-8");
  res.send(xml);
});

// AI chat with selected subscription bundle reads full-text articles
app.post("/api/chat", async (req, res) => {
  const { bundleId, messages, customAiSettings } = req.body;
  
  if (!bundleId || !messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Please provide a valid bundleId and list of conversation messages." });
  }

  try {
    const db = initDB();
    const bundle = db.bundles.find(b => b.id === bundleId);
    if (!bundle) {
      return res.status(404).json({ error: "The selected subscription bundle does not exist." });
    }

    // Retrieve articles in this bundle
    const matchingFeeds = db.feeds.filter(f => bundle.feedIds.includes(f.id));
    interface FlattenedArticle extends FeedArticle {
      feedTitle: string;
    }
    const allArticles: FlattenedArticle[] = [];
    matchingFeeds.forEach(f => {
      f.articles.forEach(art => {
        allArticles.push({
          ...art,
          feedTitle: f.title
        });
      });
    });

    // Sort by publication date desc, and extract top 15 for Context
    allArticles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    const targetArticles = allArticles.slice(0, 15);

    // Dynamic on-demand full main content prefetch & boilerplate cleaning of missing contents
    let dbUpdated = false;
    const prefetchTargets = targetArticles.slice(0, 8); // Auto-scrape top 8 articles for rich context
    await Promise.all(prefetchTargets.map(async (art) => {
      if (!art.content || art.content.length < 150) {
        try {
          console.log(`Dynamic Chat prefetching clean content for: ${art.title} (${art.url})`);
          const html = await fetchWithProxyFallback(art.url, {}, 5000); // 5s timeout
          const cleanText = extractMainContent(html);
          if (cleanText && cleanText.length > 50) {
            art.content = cleanText.substring(0, 8000);
            
            // Sync to the memory DB
            const parentFeed = db.feeds.find(f => f.articles.some(a => a.url === art.url));
            if (parentFeed) {
              const matchedArt = parentFeed.articles.find(a => a.url === art.url);
              if (matchedArt) {
                matchedArt.content = art.content;
                dbUpdated = true;
              }
            }
          }
        } catch (e) {
          console.error(`Dynamic pre-fetch scraper failed for article ${art.url}`, e);
        }
      }
    }));

    if (dbUpdated) {
      saveDB(db);
    }

    // Format article metadata and full text to inject as the AI knowledge context
    let articlesContext = "";
    if (targetArticles.length === 0) {
      articlesContext = "No current article data is available in this bundle yet.";
    } else {
      targetArticles.forEach((art, i) => {
        articlesContext += `--- ARTICLE #${i + 1} ---
Source Website Feed: ${art.feedTitle}
Title: ${art.title}
Published Date: ${art.pubDate}
URL: ${art.url}
Summary: ${art.summary}
Full Document Content: 
${art.content || art.summary || "(No full content cached)"}

`;
      });
    }

    const systemInstruction = `You are a helpful expert AI Assistant for reading website news and articles. 
You are discussing current content inside the subscription block bundle named "${bundle.name}" with the user.

Below is the database of current parsed article publications from this bundle (showing a maximum of the top 15 most recent items with cached full content):

${articlesContext}

Your goals:
1. Ground all your replies directly in this provided articles dataset. 
2. When referencing facts, ALWAYS explicitly cite the articles. Quote their title and print their absolute URLs clearly as standard markdown links: [Title](URL).
3. If the user asks about topics or questions outside of these parsed documents, kindly explain that the topic was not covered in the latest subscription publications, and answer based on general knowledge ONLY if the user explicitly requested a broad answer, while always prioritizing the cached bundle articles.
4. Keep answers clean, structures clear, and citations extremely readable.`;

    const userMessages: ChatMessage[] = messages;
    const latestMessageText = userMessages[userMessages.length - 1].text;

    // Check if Custom OpenAI Engine Configuration is active
    if (customAiSettings && customAiSettings.isEnabled && customAiSettings.apiKey && customAiSettings.baseUrl && customAiSettings.model) {
      console.log(`Forwarding Chat to Custom OpenAI API: Base: ${customAiSettings.baseUrl}, Model: ${customAiSettings.model}`);
      
      const openAiMessages = [
        { role: "system", content: systemInstruction },
        ...userMessages.slice(0, -1).map(msg => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.text
        })),
        { role: "user", content: latestMessageText }
      ];

      const endpoint = `${customAiSettings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const openAiResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${customAiSettings.apiKey}`
        },
        body: JSON.stringify({
          model: customAiSettings.model,
          messages: openAiMessages,
          temperature: 0.5
        })
      });

      if (!openAiResponse.ok) {
        const errorText = await openAiResponse.text();
        throw new Error(`OpenAI compatible API error: ${openAiResponse.status} - ${errorText}`);
      }

      const responseJson = await openAiResponse.json();
      const replyText = responseJson.choices?.[0]?.message?.content || "Could not read reply format from custom API endpoint.";
      return res.json({ text: replyText });
    }

    // Fallback: Standard Gemini SDK
    const ai = getGeminiClient();
    
    // Prepare conversation history matching Gemini SDK guidelines
    const history = userMessages.slice(0, -1).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));

    const chatInstance = ai.chats.create({
      model: "gemini-3.5-flash",
      config: {
        systemInstruction,
      },
      history
    });

    const chatResponse = await chatInstance.sendMessage({ message: latestMessageText });
    const replyText = chatResponse.text || "I was unable to retrieve a response from the AI reader.";

    res.json({ text: replyText });
  } catch (err: any) {
    console.error("AI Chat generation failed:", err);
    res.status(500).json({ error: err.message || "An unexpected error occurred during AI reading session." });
  }
});

// ================= CRON & SETTINGS ENDPOINTS =================

// Get settings
app.get("/api/settings", (req, res) => {
  const db = initDB();
  const settings = db.settings || { autoUpdate: true, updateIntervalHours: 24 };
  res.json(settings);
});

// Update settings
app.post("/api/settings", (req, res) => {
  const { autoUpdate, updateIntervalHours } = req.body;
  if (typeof autoUpdate !== "boolean" || typeof updateIntervalHours !== "number" || updateIntervalHours <= 0) {
    return res.status(400).json({ error: "Invalid settings format" });
  }
  const db = initDB();
  db.settings = { autoUpdate, updateIntervalHours };
  saveDB(db);
  res.json({ success: true, settings: db.settings });
});

// ================= BULK EXPORT & COMPILE PORTABILITY ENDPOINTS =================

// Export single feed or combined bundle as beautiful standalone HTML reader file
app.get("/api/export/html", (req, res) => {
  try {
    const { feedId, bundleId } = req.query;
    const db = initDB();
    
    let title = "";
    let description = "";
    let articles: FeedArticle[] = [];
    let exportFilename = "rss-export";

    if (feedId) {
      const feed = db.feeds.find(f => f.id === feedId);
      if (!feed) {
        return res.status(404).json({ error: "新闻源不存在" });
      }
      title = feed.title;
      description = feed.description;
      articles = feed.articles || [];
      exportFilename = `rss-feed-${feed.id}`;
    } else if (bundleId) {
      const bundle = db.bundles.find(b => b.id === bundleId);
      if (!bundle) {
        return res.status(404).json({ error: "订阅合包不存在" });
      }
      title = bundle.name;
      description = bundle.description;
      exportFilename = `rss-bundle-${bundle.id}`;
      
      const includedFeeds = db.feeds.filter(f => bundle.feedIds.includes(f.id));
      const seenUrls = new Set<string>();
      for (const feed of includedFeeds) {
        for (const art of (feed.articles || [])) {
          if (art && art.url) {
            const lowUrl = art.url.toLowerCase().trim();
            if (!seenUrls.has(lowUrl)) {
              seenUrls.add(lowUrl);
              articles.push(art);
            }
          }
        }
      }
      articles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    } else {
      return res.status(400).json({ error: "必须指定 feedId 或 bundleId 导出参数" });
    }

    const htmlContent = generateHtmlReader(title, description, articles);
    
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(exportFilename)}.html"`);
    res.send(htmlContent);
  } catch (err: any) {
    console.error("Failed to generate HTML offline reader:", err);
    res.status(500).json({ error: err.message || "生成 HTML 离线包时发生了非预期错误" });
  }
});

// Export single feed or combined bundle as a production-grade React + Vite + Tailwind CSS package ZIP
app.get("/api/export/react-vite", async (req, res) => {
  try {
    const { feedId, bundleId } = req.query;
    const db = initDB();
    
    let title = "";
    let description = "";
    let articles: FeedArticle[] = [];
    let exportFilename = "react-vite-rss";

    if (feedId) {
      const feed = db.feeds.find(f => f.id === feedId);
      if (!feed) {
        return res.status(404).json({ error: "新闻源不存在" });
      }
      title = feed.title;
      description = feed.description;
      articles = feed.articles || [];
      exportFilename = `react-vite-feed-${feed.id}`;
    } else if (bundleId) {
      const bundle = db.bundles.find(b => b.id === bundleId);
      if (!bundle) {
        return res.status(404).json({ error: "订阅合包不存在" });
      }
      title = bundle.name;
      description = bundle.description;
      exportFilename = `react-vite-bundle-${bundle.id}`;
      
      const includedFeeds = db.feeds.filter(f => bundle.feedIds.includes(f.id));
      const seenUrls = new Set<string>();
      for (const feed of includedFeeds) {
        for (const art of (feed.articles || [])) {
          if (art && art.url) {
            const lowUrl = art.url.toLowerCase().trim();
            if (!seenUrls.has(lowUrl)) {
              seenUrls.add(lowUrl);
              articles.push(art);
            }
          }
        }
      }
      articles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    } else {
      return res.status(400).json({ error: "必须指定 feedId 或 bundleId 导出参数" });
    }

    const zipBuffer = await generateReactViteZip(title, description, articles);
    
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(exportFilename)}.zip"`);
    res.send(zipBuffer);
  } catch (err: any) {
    console.error("Failed to compile React+Vite ZIP bundle:", err);
    res.status(500).json({ error: err.message || "生成 React/Vite ZIP 项目时发生了非预期错误" });
  }
});

// ================= SCHEDULED TASKS (DYNAMIC INTERVAL AUTO UPDATE) =================

// Auto updater function checking files
async function checkAndAutoUpdateFeeds() {
  try {
    const db = initDB();
    const settings = db.settings || { autoUpdate: true, updateIntervalHours: 24 };

    if (!settings.autoUpdate) {
      console.log("[Auto Updater] Cycle bypassed: auto-update is disabled.");
      return;
    }

    console.log(`[Auto Updater] Cycle running: Checking feeds for updates >${settings.updateIntervalHours}h old...`);
    let updatedAny = false;
    const now = new Date().getTime();
    const intervalMs = settings.updateIntervalHours * 60 * 60 * 1000;

    for (let i = 0; i < db.feeds.length; i++) {
      const feed = db.feeds[i];
      const lastUpdate = new Date(feed.last_updated_at || 0).getTime();
      
      // If feed was updated over customized interval ago (or has never been updated), renew it
      if (now - lastUpdate >= intervalMs) {
        try {
          db.feeds[i] = await processUpdateFeed(feed);
          updatedAny = true;
        } catch (err) {
          console.error(`Error auto-updating feed '${feed.title}' (${feed.url}):`, err);
        }
      }
    }

    if (updatedAny) {
      saveDB(db);
      console.log("Database successfully committed changes after scheduler cycle.");
    }
  } catch (e) {
    console.error("Trouble checking scheduled RSS feeds updates:", e);
  }
}

// Background poller running every 15 minutes to check what feeds need auto-updating based on customized settings
setInterval(checkAndAutoUpdateFeeds, 15 * 60 * 1000);

// Run an initial quick auto update check 15 seconds after booting up
setTimeout(checkAndAutoUpdateFeeds, 15000);

// ================= MIDDLEWARE / SERVING VITE =================

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server launched on port ${PORT}`);
  });
}

startServer();
