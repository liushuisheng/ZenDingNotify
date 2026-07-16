import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const publicDir = path.join(rootDir, "public");
const configPath = path.join(dataDir, "config.json");
const storePath = path.join(dataDir, "store.json");
const port = Number(process.env.PORT || 8787);
const LOG_LEVELS = { silent: 0, error: 1, info: 2, debug: 3 };
const logLevelName = getCliLogLevel() || String(process.env.LOG_LEVEL || process.env.ZEND_LOG || "silent").toLowerCase();
const logLevel = LOG_LEVELS[logLevelName] ?? (["1", "true", "yes", "on"].includes(logLevelName) ? LOG_LEVELS.info : LOG_LEVELS.silent);

const PUSH_TYPES = {
  RULE: "RULE_DEFECT_NOTIFY",
  YESTERDAY: "YESTERDAY_DAILY_REPORT",
  P1P2: "TODAY_P1P2_RISK_REPORT",
  OVERDUE: "OVERDUE_DEFECT_REPORT"
};

const ZENTAO_BUGS_PAGE_SIZE = 2000;
const ZENTAO_RECENT_EDITED_LIMIT = 80;
const ZENTAO_DETAIL_CONCURRENCY = 16;
const MIN_DEFECT_CACHE_TTL_MS = 60 * 1000;
const ADMIN_COOKIE_NAME = "zend_admin";
const FRONTEND_OWNERS = ["刘水生", "谌祖恒", "王思鑫", "李彦龙", "李思成", "马陈绵"];
const TEST_OWNER_ALIASES = ["陈加鹏", "陈家鹏"];
const ZENTAO_ACCOUNT_ALIASES = {
  liuss: "刘水生",
  liushuisheng: "刘水生",
  lisicheng: "李思成",
  wangsixin: "王思鑫",
  liyanlong: "李彦龙",
  machm: "马陈绵",
  machenmian: "马陈绵",
  tanzuheng: "谌祖恒",
  chenzuheng: "谌祖恒",
  chenjiapeng: "陈加鹏",
  chenjp: "陈加鹏",
  panwenhao: "潘文豪",
  pwh: "潘文豪",
  chenyunhui: "陈运辉",
  chenyh: "陈运辉",
  lishichao: "李世超",
  lisc: "李世超",
  pengqiuchun: "彭求春",
  pengqc: "彭求春"
};

const defaultConfig = {
  zentao: {
    baseUrl: "",
    account: "",
    password: "",
    cookie: "",
    projectId: 2635,
    productIds: [],
    enabled: false
  },
  dingtalk: {
    webhook: "",
    secret: "",
    dryRun: true
  },
  rules: {
    statuses: ["active", "changing"],
    priorities: ["0", "1", "2", "3", "4"],
    urgentPriorities: ["1", "2"],
    assignees: []
  },
  userMappings: {
    zhangsan: { name: "张三", mobile: "13800000000" },
    lisi: { name: "李四", mobile: "13900000000" },
    wangwu: { name: "王五", mobile: "13700000000" }
  },
  scheduler: {
    enabled: true,
    fetchEveryMinutes: 5,
    yesterdayReportTime: "09:40",
    p1p2ReportTimes: ["18:00"],
    rules: {
      yesterday: true,
      p1p2: true
    }
  },
  auth: {
    adminToken: ""
  }
};

const sampleDefects = [
  {
    id: 1001,
    title: "登录页验证码偶现无法刷新",
    status: "active",
    priority: "1",
    severity: "1",
    assignedTo: "zhangsan",
    openedBy: "tester",
    openedDate: yesterdayAt("10:16"),
    resolvedDate: "",
    closedDate: "",
    url: ""
  },
  {
    id: 1002,
    title: "缺陷列表筛选条件刷新后丢失",
    status: "active",
    priority: "2",
    severity: "2",
    assignedTo: "lisi",
    openedBy: "tester",
    openedDate: todayAt("11:23"),
    resolvedDate: "",
    closedDate: "",
    url: ""
  },
  {
    id: 1003,
    title: "普通用户无法导出报表",
    status: "resolved",
    priority: "3",
    severity: "3",
    assignedTo: "wangwu",
    openedBy: "tester",
    openedDate: yesterdayAt("16:40"),
    resolvedDate: todayAt("15:10"),
    closedDate: "",
    url: ""
  },
  {
    id: 1004,
    title: "移动端详情页字段间距异常",
    status: "active",
    priority: "4",
    severity: "4",
    assignedTo: "wangwu",
    openedBy: "tester",
    openedDate: todayAt("09:05"),
    resolvedDate: "",
    closedDate: "",
    url: ""
  }
];

await ensureFiles();
const config = normalizeConfig(await readJson(configPath, defaultConfig));
let store = await readJson(storePath, defaultStore());
let fetchInFlight = null;
const scheduledReportRunsInFlight = new Set();
ensureAdminToken();
store.defects = store.defects?.length ? store.defects : (config.zentao.enabled ? [] : sampleDefects);
store.pinnedOverviewDefects = normalizePinnedDefectIds(store.pinnedOverviewDefects);
store.requirementOverviewDefects = normalizeOverviewDefectIds(store.requirementOverviewDefects);
await saveConfig();
await saveStore();

scheduleJobs();

const server = http.createServer(async (req, res) => {
  const requestId = randomId();
  const startedAt = Date.now();
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const shouldLogRequest = requestUrl.pathname.startsWith("/api/") || canLog("debug");
  if (shouldLogRequest) {
    logInfo("request:start", { requestId, method: req.method, path: requestUrl.pathname });
  }
  try {
    await route(req, res);
  } catch (error) {
    logError("request:error", { requestId, method: req.method, path: requestUrl.pathname, error: formatError(error) });
    sendJson(res, 500, { ok: false, error: error.message });
  } finally {
    if (shouldLogRequest) {
      logInfo("request:end", {
        requestId,
        method: req.method,
        path: requestUrl.pathname,
        status: res.statusCode,
        durationMs: Date.now() - startedAt
      });
    }
  }
});

server.listen(port, () => {
  console.log(`ZenDing Notify is running at http://localhost:${port}`);
  if (logLevel > LOG_LEVELS.silent) console.log(`[${new Date().toISOString()}] [info] logging enabled: ${getLogLevelName()}`);
});

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/session") {
    sendJson(res, 200, { authenticated: isAdminRequest(req) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBodyJson(req);
    const password = String(body.password || "");
    if (!tokensEqual(password, config.auth?.adminToken)) {
      sendJson(res, 401, { ok: false, error: "Unauthorized", message: "管理员密码不正确" });
      return;
    }
    setAdminCookie(res, password, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": `${ADMIN_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (!isPublicRequest(req, url) && !isAdminRequest(req)) {
    sendJson(res, 401, {
      ok: false,
      error: "Unauthorized",
      message: "管理后台需要先登录"
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/overview") {
    const ownerScope = getValidatedOwnerScopeFromUrl(url);
    if (ownerScope.invalid) {
      sendJson(res, 404, { ok: false, error: "人员不存在", message: `人员不存在：${ownerScope.raw}` });
      return;
    }
    sendJson(res, 200, buildOverview({ owner: ownerScope.owner }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/overview-pins") {
    sendJson(res, 200, { pinned: getPinnedOverviewDefectIds() });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/overview-pins") {
    const body = await readBodyJson(req);
    store.pinnedOverviewDefects = normalizeOverviewDefectIds(body.pinned || body.ids);
    await saveStore();
    sendJson(res, 200, { ok: true, pinned: store.pinnedOverviewDefects });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/overview-requirements") {
    sendJson(res, 200, { requirements: getRequirementOverviewDefectIds() });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/overview-requirements") {
    const body = await readBodyJson(req);
    store.requirementOverviewDefects = normalizeOverviewDefectIds(body.requirements || body.ids);
    await saveStore();
    sendJson(res, 200, { ok: true, requirements: store.requirementOverviewDefects });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/defects") {
    const ownerScope = getValidatedOwnerScopeFromUrl(url);
    if (ownerScope.invalid) {
      sendJson(res, 404, { ok: false, error: "人员不存在", message: `人员不存在：${ownerScope.raw}` });
      return;
    }
    sendJson(res, 200, { defects: getFilteredDefects({ includeStatuses: false, owner: ownerScope.owner }) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/assignees") {
    sendJson(res, 200, { assignees: await getAssigneeOptions() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/push-logs") {
    sendJson(res, 200, { logs: getRecentPushLogs() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config-status") {
    sendJson(res, 200, {
      zentaoEnabled: Boolean(config.zentao.enabled),
      dingtalkDryRun: Boolean(config.dingtalk.dryRun),
      hasDingWebhook: Boolean(getDingTalkWebhook()),
      schedulerEnabled: config.scheduler?.enabled !== false,
      schedulerRules: getSchedulerRuleConfig(),
      mappedUsers: Object.keys(config.userMappings || {}).length,
      lastFetchAt: getLastSuccessfulFetchAt(),
      fetching: Boolean(fetchInFlight)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/public-config") {
    sendJson(res, 200, { config: getPublicConfig() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, { config });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/config") {
    const body = await readBodyJson(req);
    const rawConfig = body.config || body;
    const nextConfig = normalizeConfig(rawConfig);
    if (!Object.prototype.hasOwnProperty.call(rawConfig, "auth")) {
      nextConfig.auth.adminToken = config.auth?.adminToken || nextConfig.auth.adminToken;
    }
    replaceConfig(nextConfig);
    ensureAdminToken();
    await saveConfig();
    setAdminCookie(res, config.auth.adminToken, 200, { ok: true, config });
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/scheduler/enabled") {
    const body = await readBodyJson(req);
    config.scheduler.enabled = Boolean(body.enabled);
    await saveConfig();
    sendJson(res, 200, { ok: true, scheduler: config.scheduler });
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/scheduler/rule") {
    const body = await readBodyJson(req);
    const rule = String(body.rule || "");
    if (!["yesterday", "p1p2"].includes(rule)) {
      sendJson(res, 400, { ok: false, error: "未知的推送规则" });
      return;
    }
    config.scheduler.rules = { ...getSchedulerRuleConfig(), [rule]: Boolean(body.enabled) };
    await saveConfig();
    sendJson(res, 200, { ok: true, scheduler: config.scheduler });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/actions/fetch") {
    const result = await fetchAndStoreDefects("manual");
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/actions/push/rule") {
    sendJson(res, 410, { ok: false, disabled: true, error: "规则缺陷推送已停用" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/actions/push/yesterday") {
    const result = await runYesterdayReport("manual");
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/actions/push/p1p2") {
    const result = await runP1P2Report("manual");
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/actions/push/overdue") {
    const result = await runOverdueReport("manual");
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET") {
    await serveStatic(url.pathname === "/" ? "/index.html" : url.pathname, req, res);
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
}

async function fetchAndStoreDefects(trigger) {
  if (fetchInFlight) return fetchInFlight;
  fetchInFlight = doFetchAndStoreDefects(trigger).finally(() => {
    fetchInFlight = null;
  });
  return fetchInFlight;
}

async function doFetchAndStoreDefects(trigger) {
  const startedAt = new Date().toISOString();
  const previousAssignees = getStoredSyncAssignees();
  const currentAssignees = getConfiguredAssigneeNames();
  const addedAssignees = currentAssignees.filter((assignee) => !previousAssignees.includes(assignee));
  const syncMode = getFetchSyncMode(currentAssignees, addedAssignees);
  let defects;
  let source = "sample";

  if (config.zentao.enabled) {
    defects = await fetchZentaoDefects();
    source = "zentao";
  } else {
    defects = sampleDefects;
  }

  const normalizedDefects = prefilterDefectsBeforeDetails(normalizeDefects(defects));
  const enrichment = await enrichZentaoDefectsWithDetails(normalizedDefects, syncMode);
  const recentTransferEnrichment = source === "zentao" ? await fetchRecentEditedRelatedDefects() : { defects: [], detailCount: 0 };
  const mergedDefects = mergeDefectSnapshots(store.defects, [...enrichment.defects, ...recentTransferEnrichment.defects]);
  store.defects = filterClosedDefectsAfterDetails(filterConfiguredDefectsAfterDetails(mergedDefects));
  const finishedAt = new Date().toISOString();
  updateFetchSyncState(currentAssignees, finishedAt);
  store.jobRuns.push({
    id: randomId(),
    type: "FETCH_DEFECTS",
    trigger,
    source,
    startedAt,
    finishedAt,
    count: store.defects.length,
    listCount: normalizedDefects.length,
    detailCount: enrichment.detailCount + recentTransferEnrichment.detailCount,
    recentEditedCount: recentTransferEnrichment.recentEditedCount || 0,
    recentMatchedCount: recentTransferEnrichment.recentMatchedCount || 0,
    recentDetailFailureCount: recentTransferEnrichment.recentDetailFailureCount || 0,
    recentDetailFailureIds: recentTransferEnrichment.recentDetailFailureIds || [],
    recentDetailFailureMessages: recentTransferEnrichment.recentDetailFailureMessages || [],
    syncMode: syncMode.mode,
    addedAssignees,
    durationMs: Date.now() - new Date(startedAt).getTime(),
    ok: true
  });
  await saveStore();

  return { ok: true, source, count: store.defects.length, detailCount: enrichment.detailCount + recentTransferEnrichment.detailCount, syncMode: syncMode.mode };
}

function getLastSuccessfulFetchAt() {
  return [...(store.jobRuns || [])].reverse().find((job) => job.type === "FETCH_DEFECTS" && job.ok)?.finishedAt || "";
}

function getFetchSyncMode(currentAssignees, addedAssignees) {
  const lastFetchAt = getLastSuccessfulFetchAt();
  const hasWatermarks = Boolean(store.fetchSync?.assigneeWatermarks);
  if (!currentAssignees.length || !lastFetchAt || !hasWatermarks) {
    return { mode: "full", lastFetchAt: "", addedAssignees: currentAssignees };
  }
  if (addedAssignees.length) {
    return { mode: "mixed", lastFetchAt, addedAssignees };
  }
  return { mode: "incremental", lastFetchAt, addedAssignees: [] };
}

function getStoredSyncAssignees() {
  const fromState = store.fetchSync?.assignees || [];
  if (fromState.length) return fromState.map(normalizeAssigneeName).filter(Boolean);
  return Object.keys(store.fetchSync?.assigneeWatermarks || {}).map(normalizeAssigneeName).filter(Boolean);
}

function updateFetchSyncState(assignees, finishedAt) {
  const normalizedAssignees = assignees.map(normalizeAssigneeName).filter(Boolean);
  const previous = store.fetchSync?.assigneeWatermarks || {};
  const assigneeWatermarks = {};
  normalizedAssignees.forEach((assignee) => {
    assigneeWatermarks[assignee] = finishedAt;
  });
  store.fetchSync = {
    ...(store.fetchSync || {}),
    assignees: normalizedAssignees,
    assigneeWatermarks,
    previousAssigneeWatermarks: previous,
    lastFetchAt: finishedAt
  };
}

async function runRuleNotify(trigger) {
  await fetchAndStoreDefects(trigger);
  const defects = getFilteredDefects().filter((defect) => isOpenDefect(defect) && isPushVisibleDefect(defect));
  const title = "禅道缺陷提醒";
  const text = buildRuleMessage(defects);
  const mobiles = getMobilesForDefects(defects);
  return pushAndLog(PUSH_TYPES.RULE, title, text, mobiles, trigger, defects);
}

async function runYesterdayReport(trigger) {
  await fetchAndStoreDefects(trigger);
  const range = getYesterdayRange();
  const defects = getFilteredDefects().filter(isPushVisibleDefect);
  const related = defects.filter((defect) => isInRange(defect.openedDate, range) || isInRange(defect.resolvedDate, range) || isInRange(defect.closedDate, range));
  const remaining = defects.filter(isOpenDefect);
  const title = "昨日缺陷处理日报";
  const text = buildYesterdayMessage(defects, related, remaining, range);
  const mobiles = getMobilesForDefects(remaining.filter(isUrgentDefect));
  return pushAndLog(PUSH_TYPES.YESTERDAY, title, text, mobiles, trigger, related);
}

async function runP1P2Report(trigger) {
  const fetchResult = await ensureFreshDefects(trigger);
  const defects = getFilteredDefects().filter((defect) => isOpenDefect(defect) && isUrgentDefect(defect) && isPushVisibleDefect(defect));
  const title = "今日 P1/P2 缺陷风险提醒";
  const text = buildP1P2Message(defects);
  const mobiles = getMobilesForDefects(defects);
  const result = await pushAndLog(PUSH_TYPES.P1P2, title, text, mobiles, trigger, defects);
  return { ...result, fetch: fetchResult };
}

async function runOverdueReport(trigger) {
  const fetchResult = await ensureFreshDefects(trigger);
  const defects = getOverdueReportDefects();
  const title = "超期缺陷单";
  const text = buildOverdueMessage(defects);
  const mobiles = getMobilesForDefects(defects);
  const result = await pushAndLog(PUSH_TYPES.OVERDUE, title, text, mobiles, trigger, defects);
  return { ...result, fetch: fetchResult };
}

async function ensureFreshDefects(trigger) {
  if (!config.zentao.enabled) {
    return { ok: true, source: "sample", cached: true, count: store.defects.length };
  }

  const lastSuccessfulFetchAt = getLastSuccessfulFetchAt();
  const lastFetchTime = lastSuccessfulFetchAt ? new Date(lastSuccessfulFetchAt).getTime() : 0;
  const fetchIntervalMs = getFetchIntervalMs();
  const cacheTtlMs = Math.max(MIN_DEFECT_CACHE_TTL_MS, fetchIntervalMs);
  const cacheFresh = store.defects.length > 0 && Number.isFinite(lastFetchTime) && Date.now() - lastFetchTime < cacheTtlMs;

  if (cacheFresh) {
    return {
      ok: true,
      source: "store",
      cached: true,
      count: store.defects.length,
      lastFetchAt: lastSuccessfulFetchAt,
      cacheTtlMs
    };
  }

  const result = await fetchAndStoreDefects(trigger);
  return { ...result, cached: false, lastFetchAt: getLastSuccessfulFetchAt(), cacheTtlMs };
}

async function pushAndLog(type, title, text, mobiles, trigger, defects) {
  const eventHash = sha256(`${type}:${text}`);
  const duplicate = store.pushLogs.some((log) => log.type === type && log.eventHash === eventHash && log.ok);

  if (duplicate && trigger !== "manual") {
    return { ok: true, skipped: true, reason: "duplicate" };
  }

  const result = await sendDingTalkMarkdown({ title, text, mobiles });
  const log = {
    id: randomId(),
    type,
    title,
    text,
    mobiles,
    defectIds: defects.map((defect) => defect.id),
    trigger,
    eventHash,
    ok: result.ok,
    dryRun: result.dryRun,
    response: result.response,
    error: result.error || "",
    createdAt: new Date().toISOString()
  };

  store.pushLogs.push(log);
  await saveStore();

  return { ok: result.ok, dryRun: result.dryRun, defectCount: defects.length, mobiles, logId: log.id, error: result.error };
}

async function fetchZentaoDefects() {
  if (config.zentao.cookie) {
    return fetchZentaoLegacyDefects();
  }

  const tokenResponse = await fetchWithLog("zentao:token", `${trimSlash(config.zentao.baseUrl)}/api.php/v1/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: config.zentao.account, password: config.zentao.password })
  });

  if (!tokenResponse.ok) {
    throw new Error(`Zentao token failed: ${tokenResponse.status}`);
  }

  const tokenData = await tokenResponse.json();
  const token = tokenData.token || tokenData.data?.token;
  if (!token) throw new Error("Zentao token response missing token");

  const productIds = config.zentao.productIds?.length ? config.zentao.productIds : [0];
  const all = [];

  for (const productId of productIds) {
    const endpoint = productId ? `/api.php/v1/products/${productId}/bugs` : "/api.php/v1/bugs";
    const response = await fetchWithLog("zentao:bugs", `${trimSlash(config.zentao.baseUrl)}${endpoint}`, {
      headers: { Token: token, "Content-Type": "application/json" }
    });
    if (!response.ok) throw new Error(`Get Zentao bugs failed: ${response.status}`);
    const data = await response.json();
    all.push(...extractBugList(data));
  }

  return all;
}

async function fetchZentaoLegacyDefects() {
  const productIds = config.zentao.productIds?.length ? config.zentao.productIds : [0];
  const all = [];

  for (const productId of productIds) {
    const text = await fetchZentaoLegacyBugPage(productId);
    if (isZentaoLoginRedirect(text)) {
      throw new Error("Zentao cookie is invalid or expired; request was redirected to login page");
    }
    all.push(...extractLegacyBugList(text));
  }

  return all;
}

async function fetchZentaoLegacyBugPage(productId) {
  const base = trimSlash(config.zentao.baseUrl);
  const headers = {
    Cookie: config.zentao.cookie,
    Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
    Referer: `${base}/my/`,
    "User-Agent": "Mozilla/5.0 ZenDingNotify/0.1"
  };
  const urls = [
    `${base}/bug-browse-${productId}-0-all-0-id_desc-${ZENTAO_BUGS_PAGE_SIZE}-${ZENTAO_BUGS_PAGE_SIZE}-1.html`,
    `${base}/bug-browse-${productId}-0-all.html`,
    `${base}/index.php?m=bug&f=browse&productID=${encodeURIComponent(productId)}&branch=all&browseType=all&param=0&orderBy=id_desc&recTotal=0&recPerPage=${ZENTAO_BUGS_PAGE_SIZE}&pageID=1`
  ];

  for (const url of urls) {
    const response = await fetchWithLog("zentao:legacy-bugs", url, { headers });
    if (!response.ok) throw new Error(`Get Zentao legacy bugs failed: ${response.status}`);
    const text = await response.text();
    if (/bug-view-\d+/.test(text) && /<tr[\s\S]*data-id=/.test(text)) {
      const total = getZentaoPagerTotal(text, "all");
      const recTotal = Math.max(total, ZENTAO_BUGS_PAGE_SIZE);
      if (total > 0 && total > 20 && !url.includes(`-${recTotal}-${ZENTAO_BUGS_PAGE_SIZE}-1.html`)) {
        const fullUrl = `${base}/bug-browse-${productId}-0-all-0-id_desc-${recTotal}-${ZENTAO_BUGS_PAGE_SIZE}-1.html`;
        const fullResponse = await fetchWithLog("zentao:legacy-bugs-full", fullUrl, { headers: { ...headers, Referer: url } });
        if (!fullResponse.ok) throw new Error(`Get Zentao legacy bugs failed: ${fullResponse.status}`);
        return fullResponse.text();
      }
      return text;
    }
    if (!/我的地盘 - 禅道/.test(text)) return text;
  }

  return "";
}

async function fetchZentaoLegacyRecentEditedBugPage(productId) {
  const base = trimSlash(config.zentao.baseUrl);
  const headers = {
    Cookie: config.zentao.cookie,
    Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
    Referer: `${base}/my/`,
    "User-Agent": "Mozilla/5.0 ZenDingNotify/0.1"
  };
  const response = await fetchWithLog("zentao:recent-edited", `${base}/bug-browse-${productId}-0-all-0-lastEditedDate_desc-200-200-1.html`, { headers });
  if (!response.ok) throw new Error(`Get Zentao recent edited bugs failed: ${response.status}`);
  return response.text();
}

async function fetchRecentEditedRelatedDefects() {
  if (!config.zentao.enabled || !config.zentao.cookie) return { defects: [], detailCount: 0 };
  const productIds = config.zentao.productIds?.length ? config.zentao.productIds : [0];
  const recentRowsById = new Map();
  for (const productId of productIds) {
    const text = await fetchZentaoLegacyRecentEditedBugPage(productId);
    if (isZentaoLoginRedirect(text)) throw new Error("Zentao cookie is invalid or expired; request was redirected to login page");
    extractLegacyBugList(text).slice(0, ZENTAO_RECENT_EDITED_LIMIT).forEach((bug) => {
      if (bug?.id && !recentRowsById.has(String(bug.id))) recentRowsById.set(String(bug.id), bug);
    });
  }
  const recentDefects = normalizeDefects([...recentRowsById.values()].map((bug) => ({ ...bug, recentlyEdited: true })));
  const detailMap = new Map();
  let detailFailures = [];
  for (let index = 0; index < recentDefects.length; index += ZENTAO_DETAIL_CONCURRENCY) {
    const chunk = recentDefects.slice(index, index + ZENTAO_DETAIL_CONCURRENCY);
    const details = await Promise.all(chunk.map(async (defect) => {
      try {
        return { detail: await fetchZentaoBugDetailWithRetry(defect) };
      } catch (error) {
        return { error };
      }
    }));
    details.forEach((result, detailIndex) => {
      if (result.detail) {
        detailMap.set(String(chunk[detailIndex].id), result.detail);
      } else {
        detailFailures.push({ defect: chunk[detailIndex], error: result.error });
      }
    });
  }
  if (detailFailures.length) {
    const finalFailures = [];
    for (const failure of detailFailures) {
      await delay(300);
      const defect = failure.defect;
      const detail = await fetchZentaoBugDetailWithRetry(defect, 3).catch(() => null);
      if (detail) {
        detailMap.set(String(defect.id), detail);
      } else {
        finalFailures.push(failure);
      }
    }
    detailFailures = finalFailures;
  }
  const enrichedDefects = recentDefects.map((defect) => ({ ...defect, ...(detailMap.get(String(defect.id)) || {}) }));
  const defects = filterConfiguredDefectsAfterDetails(enrichedDefects);
  return {
    defects,
    detailCount: recentDefects.length,
    recentEditedCount: recentDefects.length,
    recentMatchedCount: defects.length,
    recentDetailFailureCount: detailFailures.length,
    recentDetailFailureIds: detailFailures.map((failure) => failure.defect.id).slice(0, 10),
    recentDetailFailureMessages: detailFailures.map((failure) => ({
      id: failure.defect.id,
      message: failure.error?.message || String(failure.error || "")
    })).slice(0, 3)
  };
}

async function getAssigneeOptions() {
  const fromStore = getAssigneesFromDefects(store.defects);
  if (!config.zentao.enabled || !config.zentao.cookie) return fromStore;

  try {
    const team = await fetchZentaoProjectTeamAssignees();
    return dedupeAssignees([...fromStore, ...team]).filter(isLikelyAssignee).sort((a, b) => a.localeCompare(b, "zh-CN"));
  } catch {
    return fromStore;
  }
}

async function fetchZentaoProjectTeamAssignees() {
  const base = trimSlash(config.zentao.baseUrl);
  const projectId = config.zentao.projectId || getCookieValue(config.zentao.cookie, "preProjectID") || 2635;
  const headers = {
    Cookie: config.zentao.cookie,
    Accept: "text/html,*/*;q=0.8",
    Referer: `${base}/project-view-${projectId}.html`,
    "User-Agent": "Mozilla/5.0 ZenDingNotify/0.1"
  };
  const response = await fetchWithLog("zentao:project-team", `${base}/project-team-${projectId}.html`, { headers });
  if (!response.ok) throw new Error(`Get Zentao team page failed: ${response.status}`);
  const text = await response.text();
  if (isZentaoLoginRedirect(text)) throw new Error("Zentao cookie is invalid or expired; request was redirected to login page");
  return extractTeamMembers(text);
}

async function sendDingTalkMarkdown({ title, text, mobiles }) {
  if (config.dingtalk.dryRun || !getDingTalkWebhook()) {
    return { ok: true, dryRun: true, response: { message: "dry-run" } };
  }

  const url = buildDingTalkUrl();
  const response = await fetchWithLog("dingtalk:markdown", url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: { title, text },
      at: { atMobiles: mobiles, isAtAll: false }
    })
  });
  const data = await response.json();
  const ok = data.errcode === 0;
  return { ok, dryRun: false, response: data, error: ok ? "" : data.errmsg || "DingTalk send failed" };
}

function buildDingTalkUrl() {
  const base = getDingTalkWebhook();
  if (!config.dingtalk.secret) return base;
  const timestamp = Date.now();
  const sign = encodeURIComponent(
    crypto.createHmac("sha256", config.dingtalk.secret).update(`${timestamp}\n${config.dingtalk.secret}`).digest("base64")
  );
  return `${base}${base.includes("?") ? "&" : "?"}timestamp=${timestamp}&sign=${sign}`;
}

function getDingTalkWebhook() {
  if (config.dingtalk.webhook) return config.dingtalk.webhook;
  if (config.dingtalk.accessToken) {
    return `https://oapi.dingtalk.com/robot/send?access_token=${encodeURIComponent(config.dingtalk.accessToken)}`;
  }
  return "";
}

function buildOverview(options = {}) {
  const defects = getFilteredDefects({ includeStatuses: false, owner: options.owner });
  const today = getTodayRange();
  const open = defects.filter(isOpenDefect);
  const abnormalOpen = open.filter(isAbnormalTransferredDefect);
  const visibleOpen = open.filter(isVisibleOpenOverviewDefect);
  const urgentOpen = visibleOpen.filter(isUrgentDefect);
  const normalOpen = visibleOpen.filter((defect) => !isUrgentDefect(defect));
  const ownerScope = normalizeAssigneeName(options.owner);
  const todayAdded = defects.filter((defect) => isInRange(defect.openedDate, today));
  const todayAddedForStats = ownerScope
    ? todayAdded
    : uniqueDefects([...todayAdded, ...defects.filter((defect) => isTodayIncomingTransferToConfiguredDefect(defect, today))]);
  const todayResolved = defects.filter((defect) => isFrontendResolvedDefect(defect) && isInRange(getDeveloperResolvedAt(defect), today));
  const todayClosed = defects.filter((defect) => isFrontendClosedDefect(defect) && isInRange(defect.closedDate, today));
  const resolvedPendingVerify = defects.filter(isResolvedPendingVerifyDefect);
  const owners = groupByOwner(defects, open, todayAdded, todayResolved)
    .filter((owner) => !ownerScope || namesEqual(owner.account, ownerScope) || namesEqual(owner.name, ownerScope));

  return {
    stats: {
      todayAdded: todayAddedForStats.length,
      todayResolved: todayResolved.length,
      todayClosed: todayClosed.length,
      openTotal: visibleOpen.length,
      urgentOpen: urgentOpen.length,
      normalOpen: normalOpen.length,
      abnormalOpen: abnormalOpen.length,
      resolvedPendingVerify: resolvedPendingVerify.length
    },
    urgentOpen,
    normalOpen,
    abnormalOpen,
    todayPendingTest: todayResolved,
    todayClosed,
    resolvedPendingVerify,
    owners,
    recentLogs: store.pushLogs.slice(-5).reverse(),
    lastJobRuns: store.jobRuns.slice(-5).reverse()
  };
}

function buildRuleMessage(defects) {
  const sortedDefects = sortDefectsForMessage(defects);
  const urgentCount = sortedDefects.filter((defect) => ["0", "1"].includes(String(defect.priority))).length;
  if (!sortedDefects.length) return "### 禅道缺陷提醒\n\n当前没有 P0/P1 未完成缺陷。";
  return [
    `### 禅道缺陷提醒`,
    ``,
    `P0/P1 未完成缺陷共 **${urgentCount}** 个，请相关处理人优先关注。`,
    ``,
    ...formatDefects(sortedDefects)
  ].join("\n");
}

function buildYesterdayMessage(defects, related, remaining, range) {
  const added = defects.filter((defect) => isInRange(defect.openedDate, range));
  const resolved = defects.filter((defect) => isInRange(defect.resolvedDate, range) || isInRange(defect.closedDate, range));
  const urgentRemaining = remaining.filter(isUrgentDefect);
  const normalRemaining = remaining.filter((defect) => !isUrgentDefect(defect));
  return [
    `### 昨日缺陷处理日报`,
    ``,
    `统计日期：${formatDate(range.start)}`,
    ``,
    `- 昨日新增：${added.length}`,
    `- 昨日解决/关闭：${resolved.length}`,
    `- 当前未完成：${remaining.length}`,
    `- P1/P2 未完成：${urgentRemaining.length}`,
    `- 非 P1/P2 未完成：${normalRemaining.length}`,
    ``,
    `#### 剩余 P1/P2`,
    urgentRemaining.length ? formatDefects(sortDefectsForMessage(urgentRemaining)).join("\n") : "暂无。",
    ``,
    `#### 普通待处理`,
    normalRemaining.length ? formatDefects(sortDefectsForMessage(normalRemaining).slice(0, 12)).join("\n") : "暂无。",
    normalRemaining.length > 12 ? `\n还有 ${normalRemaining.length - 12} 个普通缺陷未展示，请在本地看板查看。` : ""
  ].join("\n");
}

function buildP1P2Message(defects) {
  const sortedDefects = sortDefectsForMessage(defects);
  if (!sortedDefects.length) return "### 今日 P1/P2 缺陷风险提醒\n\n当前没有剩余 P1/P2 未完成缺陷。";
  return [
    `### 今日 P1/P2 缺陷风险提醒`,
    ``,
    `当前剩余 **${sortedDefects.length}** 个 P1/P2 未完成缺陷，请相关处理人关注。`,
    ``,
    ...formatDefects(sortedDefects)
  ].join("\n");
}

function buildOverdueMessage(defects) {
  const sortedDefects = sortDefectsByPriority(defects);
  if (!sortedDefects.length) return "### 超期缺陷单\n\n当前没有符合条件的超期激活缺陷。";
  return [
    `### 超期缺陷单`,
    ``,
    `当前有 **${sortedDefects.length}** 个超期激活缺陷，请相关处理人关注。`,
    ``,
    ...formatDefects(sortedDefects)
  ].join("\n");
}

function formatDefects(defects) {
  return defects.map((defect) => {
    const user = getUserMappingForAssignee(defect.assignedTo);
    const displayName = normalizeAssigneeName(user?.name || defect.assignedTo);
    const ownerName = displayName || "未指派";
    const owner = user?.mobile ? `**${ownerName}** @${user.mobile}` : `**${ownerName}**`;
    const link = defect.url ? ` [查看](${defect.url})` : "";
    return `- #${defect.id} [P${defect.priority}] ${defect.title}；负责人：${owner}${link}`;
  });
}

function sortDefectsForMessage(defects) {
  return [...defects].sort((a, b) => {
    const priorityDiff = Number(a.priority || 99) - Number(b.priority || 99);
    if (priorityDiff) return priorityDiff;
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

function sortDefectsByPriority(defects) {
  return [...defects].sort((a, b) => {
    const statusDiff = statusSortValue(a.status) - statusSortValue(b.status);
    if (statusDiff) return statusDiff;
    const priorityDiff = priorityValue(a.priority) - priorityValue(b.priority);
    if (priorityDiff) return priorityDiff;
    const fatalDiff = Number(isFatalDefect(b)) - Number(isFatalDefect(a));
    if (fatalDiff) return fatalDiff;
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

function statusSortValue(status) {
  const normalized = normalizeZentaoStatus(status);
  if (normalized === "active") return 0;
  if (normalized === "closed") return 2;
  return 1;
}

function priorityValue(priority) {
  const order = { 1: 1, 2: 2, 3: 3, 4: 4, 0: 5 };
  return order[String(priority)] || 99;
}

function isFatalDefect(defect) {
  return String(defect.severity || "").includes("致命") || String(defect.severity || "") === "1";
}

function getOverdueReportDefects() {
  return sortDefectsByPriority(
    getFilteredDefects({ includeStatuses: false })
      .filter(isConfiguredPersonDefect)
      .filter(isPushVisibleDefect)
      .filter((defect) => FRONTEND_OWNERS.some((owner) => namesEqual(getDefectOwnerName(defect), owner)))
      .filter((defect) => normalizeZentaoStatus(defect.status) === "active")
      .filter((defect) => getOpenedAgeBucket(defect.openedDate) === "overdue")
      .filter(isCurrentTerminalDefect)
  );
}

function getFilteredDefects(options = {}) {
  const statuses = new Set((config.rules.statuses || []).map(normalizeZentaoStatus));
  const priorities = new Set((config.rules.priorities || []).map(String));
  const assignees = (config.rules.assignees || []).map(normalizeAssigneeName).filter(Boolean);
  const owner = normalizeAssigneeName(options.owner);
  return store.defects.filter((defect) => {
    const status = normalizeZentaoStatus(defect.status);
    if (status === "active" && isTestOwner(defect.assignedTo) && !isAbnormalTransferredDefect(defect)) return false;
    const statusMatched = options.includeStatuses === false || !statuses.size || statuses.has(status);
    const priorityMatched = !priorities.size || priorities.has(String(defect.priority));
    const assigneeMatched = !assignees.length || isDefectOwnedByConfiguredAssignee(defect, assignees);
    const ownerMatched = !owner || isDefectOwnedByOwner(defect, owner);
    return statusMatched && priorityMatched && assigneeMatched && ownerMatched;
  });
}

function getOwnerScopeFromUrl(url) {
  return resolveConfiguredOwnerScope(url.searchParams.get("owner") || "");
}

function getValidatedOwnerScopeFromUrl(url) {
  const raw = url.searchParams.get("owner") || "";
  if (!raw) return { owner: "", invalid: false, raw: "" };
  const owner = resolveConfiguredOwnerScope(raw);
  return { owner, invalid: !owner, raw };
}

function resolveConfiguredOwnerScope(value) {
  const normalized = normalizeAssigneeName(value);
  if (!normalized) return "";
  const configured = getConfiguredAssigneeNames();
  return configured.find((assignee) => namesEqual(assignee, normalized)) || "";
}

function isDefectOwnedByOwner(defect, owner) {
  return getOwnerScopeFields(defect).some((value) => namesEqual(value, owner));
}

function getOwnerScopeFields(defect) {
  const status = normalizeZentaoStatus(defect.status);
  if (["resolved", "closed"].includes(status)) {
    return [defect.resolvedBy, defect.assignedFrom, getInitialAssignedTo(defect), defect.assignedTo, defect.closedBy];
  }
  if (isTestOwner(defect.assignedTo)) {
    return [defect.assignedFrom, getInitialAssignedTo(defect)];
  }
  if (isTodayTransferredDefect(defect)) {
    return [getTransferFrom(defect), getTransferTo(defect)];
  }
  if (isTodayInitiallyAssignedDefect(defect)) {
    return [getInitialAssignedTo(defect), defect.assignedTo];
  }
  return [defect.assignedTo];
}

function isDefectOwnedByConfiguredAssignee(defect, assignees) {
  const status = normalizeZentaoStatus(defect.status);
  if (["resolved", "closed"].includes(status)) {
    return [defect.resolvedBy, defect.assignedFrom, getInitialAssignedTo(defect)].some((value) => assignees.includes(normalizeAssigneeName(value)));
  }
  if (isTestOwner(defect.assignedTo)) {
    return assignees.includes(normalizeAssigneeName(defect.assignedFrom));
  }
  if (isTodayTransferredDefect(defect)) {
    return [getTransferFrom(defect), getTransferTo(defect)].some((value) => assignees.includes(normalizeAssigneeName(value)));
  }
  if (isTodayInitiallyAssignedDefect(defect)) {
    return assignees.includes(normalizeAssigneeName(getInitialAssignedTo(defect)));
  }
  return assignees.includes(normalizeAssigneeName(defect.assignedTo));
}

function normalizeDefects(defects) {
  return defects.map((bug) => ({
    id: bug.id,
    title: bug.title || bug.name || "",
    status: normalizeZentaoStatus(bug.status || ""),
    priority: String(bug.pri || bug.priority || "3"),
    severity: String(bug.severity || ""),
    assignedTo: typeof bug.assignedTo === "object" ? bug.assignedTo.account : bug.assignedTo || "",
    openedBy: typeof bug.openedBy === "object" ? bug.openedBy.account : bug.openedBy || "",
    openedDate: bug.openedDate || bug.openedAt || bug.createdDate || "",
    resolvedDate: bug.resolvedDate || "",
    resolvedBy: bug.resolvedBy || "",
    closedDate: bug.closedDate || "",
    closedBy: bug.closedBy || "",
    activatedDate: bug.activatedDate || "",
    activatedBy: bug.activatedBy || "",
    initialAssignedTo: bug.initialAssignedTo || "",
    assignedFrom: bug.assignedFrom || "",
    assignedAt: bug.assignedAt || "",
    assignedStatusAfter: bug.assignedStatusAfter || "",
    transferFrom: bug.transferFrom || "",
    transferTo: bug.transferTo || "",
    transferAt: bug.transferAt || "",
    transferStatusAfter: bug.transferStatusAfter || "",
    lastEditedDate: bug.lastEditedDate || bug.lastEditedAt || bug.editedDate || bug.updatedDate || "",
    recentlyEdited: Boolean(bug.recentlyEdited),
    url: bug.url || (bug.id && config.zentao.baseUrl ? `${trimSlash(config.zentao.baseUrl)}/bug-view-${bug.id}.html` : "")
  }));
}

function prefilterDefectsBeforeDetails(defects) {
  const assignees = getConfiguredAssigneeNames();
  const today = getTodayRange();
  return defects.filter((defect) => {
    const status = normalizeZentaoStatus(defect.status);
    if (status === "closed" && defect.closedDate && !isInRange(defect.closedDate, today)) return false;
    if (!assignees.length) return true;
    if (isTestOwner(defect.assignedTo)) return true;
    if (status === "closed" && !defect.resolvedBy && !defect.assignedFrom) return true;
    if (["resolved", "closed"].includes(status)) {
      return [defect.resolvedBy, defect.assignedFrom, defect.assignedTo].some((value) => assignees.includes(normalizeAssigneeName(value)));
    }
    if (status === "active" && (defect.recentlyEdited || isToday(getDefectModifiedAt(defect)))) return true;
    if (status === "active" && isTestOwner(defect.openedBy) && isInRange(defect.openedDate, today)) return true;
    return assignees.includes(normalizeAssigneeName(defect.assignedTo));
  });
}

function filterConfiguredDefectsAfterDetails(defects) {
  const assignees = getConfiguredAssigneeNames();
  if (!assignees.length) return defects;
  return defects.filter((defect) => isDefectOwnedByConfiguredAssignee(defect, assignees));
}

function filterClosedDefectsAfterDetails(defects) {
  const today = getTodayRange();
  return defects.filter((defect) => {
    if (normalizeZentaoStatus(defect.status) !== "closed") return true;
    return isInRange(defect.closedDate, today);
  });
}

function getConfiguredAssigneeNames() {
  return (config.rules.assignees || []).map(normalizeAssigneeName).filter(Boolean);
}

async function enrichZentaoDefectsWithDetails(defects, syncMode = { mode: "full" }) {
  if (!config.zentao.enabled || !config.zentao.cookie) return { defects, detailCount: 0 };
  const previousById = new Map((store.defects || []).map((defect) => [String(defect.id), defect]));
  const candidates = defects.filter((defect) => shouldFetchZentaoDetailForSync(defect, syncMode, previousById));
  const detailMap = new Map();

  for (let index = 0; index < candidates.length; index += ZENTAO_DETAIL_CONCURRENCY) {
    const chunk = candidates.slice(index, index + ZENTAO_DETAIL_CONCURRENCY);
    const details = await Promise.all(chunk.map((defect) => fetchZentaoBugDetailWithRetry(defect).catch(() => null)));
    details.forEach((detail, detailIndex) => {
      if (detail) detailMap.set(chunk[detailIndex].id, detail);
    });
  }

  return {
    defects: defects.map((defect) => ({ ...defect, ...(detailMap.get(defect.id) || {}) })),
    detailCount: candidates.length
  };
}

function shouldFetchZentaoDetail(defect) {
  const status = normalizeZentaoStatus(defect.status);
  return isTestOwner(defect.assignedTo)
    || status === "closed"
    || (status === "active" && defect.recentlyEdited)
    || (status === "active" && isToday(getDefectModifiedAt(defect)))
    || (status === "active" && (isFrontendOwner(defect.assignedTo) || isTestOwner(defect.openedBy)))
    || (isTestOwner(defect.openedBy) && isToday(defect.openedDate));
}

function shouldFetchZentaoDetailForSync(defect, syncMode, previousById) {
  if (!shouldFetchZentaoDetail(defect)) return false;
  if (syncMode.mode === "full") return true;
  if (syncMode.addedAssignees?.length && shouldFetchDetailForAddedAssignees(defect, syncMode.addedAssignees)) return true;
  if (isDefectChangedSinceLastFetch(defect, previousById.get(String(defect.id)), syncMode.lastFetchAt)) return true;
  return false;
}

function shouldFetchDetailForAddedAssignees(defect, addedAssignees) {
  const related = [defect.assignedTo, defect.openedBy, defect.resolvedBy, defect.assignedFrom, getInitialAssignedTo(defect)];
  if (related.some((value) => addedAssignees.includes(normalizeAssigneeName(value)))) return true;
  const status = normalizeZentaoStatus(defect.status);
  return status === "closed" || status === "resolved" || isTestOwner(defect.assignedTo);
}

function isDefectChangedSinceLastFetch(nextDefect, previousDefect, lastFetchAt) {
  if (!lastFetchAt) return true;
  const modifiedAt = getDefectModifiedAt(nextDefect);
  if (modifiedAt) {
    return new Date(modifiedAt).getTime() >= new Date(lastFetchAt).getTime() - 60 * 1000;
  }
  if (!previousDefect) return isNewRelevantDefectSinceLastFetch(nextDefect, lastFetchAt);
  return [
    "title",
    "status",
    "priority",
    "severity",
    "assignedTo",
    "openedBy",
    "openedDate"
  ].some((key) => String(nextDefect[key] || "") !== String(previousDefect[key] || ""));
}

function getDefectModifiedAt(defect) {
  return defect.lastEditedDate || defect.updatedDate || defect.assignedAt || defect.resolvedDate || defect.closedDate || "";
}

function isNewRelevantDefectSinceLastFetch(defect, lastFetchAt) {
  if (defect.recentlyEdited) return true;
  if (isToday(getDefectModifiedAt(defect))) return true;
  if (isDateAtOrAfter(defect.openedDate, lastFetchAt)) return true;
  const assignees = getConfiguredAssigneeNames();
  if (!assignees.length) return false;
  return assignees.includes(normalizeAssigneeName(defect.assignedTo))
    || (isTestOwner(defect.assignedTo) && assignees.includes(normalizeAssigneeName(defect.assignedFrom)));
}

function isDateAtOrAfter(value, compareTo) {
  if (!value || !compareTo) return false;
  const time = new Date(value).getTime();
  const compareTime = new Date(compareTo).getTime();
  return Number.isFinite(time) && Number.isFinite(compareTime) && time >= compareTime - 60 * 1000;
}

function mergeDefectSnapshots(previousDefects, nextDefects) {
  const merged = new Map();
  const nextIds = new Set((nextDefects || []).map((defect) => String(defect.id)));
  (previousDefects || []).forEach((defect) => {
    if (defect?.id && nextIds.has(String(defect.id))) merged.set(String(defect.id), defect);
  });
  (nextDefects || []).forEach((defect) => {
    if (!defect?.id) return;
    const previous = merged.get(String(defect.id)) || {};
    merged.set(String(defect.id), mergeDefect(previous, defect));
  });
  return [...merged.values()];
}

function mergeDefect(previous, next) {
  const merged = { ...previous, ...next };
  [
    "openedDate",
    "resolvedDate",
    "resolvedBy",
    "closedDate",
    "closedBy",
    "activatedDate",
    "activatedBy",
    "initialAssignedTo",
    "assignedFrom",
    "assignedAt",
    "assignedStatusAfter",
    "transferFrom",
    "transferTo",
    "transferAt",
    "transferStatusAfter",
    "lastEditedDate",
    "recentlyEdited"
  ].forEach((key) => {
    if (!next[key] && previous[key]) merged[key] = previous[key];
  });
  return merged;
}

async function fetchZentaoBugDetail(defect) {
  const base = trimSlash(config.zentao.baseUrl);
  const response = await fetchWithLog("zentao:bug-detail", `${base}/bug-view-${defect.id}.html`, {
    headers: {
      Cookie: config.zentao.cookie,
      Accept: "text/html,*/*;q=0.8",
      Referer: `${base}/bug-browse-${config.zentao.productIds?.[0] || 0}-0-all.html`,
      "User-Agent": "Mozilla/5.0 ZenDingNotify/0.1"
    }
  });
  if (!response.ok) throw new Error(`Get Zentao bug detail failed: ${response.status}`);
  const html = await response.text();
  if (isZentaoLoginRedirect(html)) throw new Error("Zentao cookie is invalid or expired; request was redirected to login page");
  return parseBugDetail(html, defect);
}

async function fetchZentaoBugDetailWithRetry(defect, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchZentaoBugDetail(defect);
    } catch (error) {
      lastError = error;
      if (attempt < retries) await delay(200 * (attempt + 1));
    }
  }
  throw lastError;
}

function parseBugDetail(html, defect) {
  const text = decodeHtml(stripTags(String(html || "").replace(/&nbsp;/g, " "))).replace(/\s+/g, " ").trim();
  const detail = {};
  const statusMatch = text.match(/Bug状态\s+(激活|已解决|已关闭|变更中|active|resolved|closed|changing)/i);
  if (statusMatch) detail.status = normalizeZentaoStatus(statusMatch[1]);

  const openedMatch = text.match(/由谁创建\s+([^\s]+?)\s+于\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/)
    || text.match(/创建者\s+([^\s]+?)\s+于\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/)
    || text.match(/创建时间\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/)
    || text.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}),\s+由\s+([^。]+?)\s+创建。/);
  if (openedMatch) {
    const firstGroupIsDate = /^\d{4}-\d{2}-\d{2}/.test(openedMatch[1]);
    const openedBy = firstGroupIsDate ? openedMatch[2] : openedMatch[1];
    if (openedBy) detail.openedBy = openedBy.trim();
    detail.openedDate = normalizeZentaoDateTime(firstGroupIsDate ? openedMatch[1] : openedMatch[2]);
  }

  const currentAssignedMatch = text.match(/当前指派\s+(.+?)\s+于\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
  if (currentAssignedMatch) {
    const assignedTo = currentAssignedMatch[1].trim();
    if (!/^Closed$/i.test(assignedTo)) detail.assignedTo = assignedTo;
    detail.assignedAt = normalizeZentaoDateTime(currentAssignedMatch[2]);
  }

  const activatedMatches = [...text.matchAll(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}),\s+由\s+([^。]+?)\s+(?:重新)?激活。/g)];
  const activatedMatch = activatedMatches.reverse()[0];
  if (activatedMatch) {
    detail.activatedDate = normalizeZentaoDateTime(activatedMatch[1]);
    detail.activatedBy = activatedMatch[2].trim();
  }

  const historyResolvedMatches = [...text.matchAll(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}),\s+由\s+([^。]+?)\s+解决，/g)];
  const historyResolvedMatch = historyResolvedMatches.reverse().find((match) => !isTestOwner(match[2]));
  const resolvedMatch = historyResolvedMatch || text.match(/由谁解决\s+([^\s]+?)\s+于\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
  if (resolvedMatch) {
    const firstGroupIsDate = /^\d{4}-\d{2}-\d{2}/.test(resolvedMatch[1]);
    detail.resolvedBy = (firstGroupIsDate ? resolvedMatch[2] : resolvedMatch[1]).trim();
    detail.resolvedDate = normalizeZentaoDateTime(firstGroupIsDate ? resolvedMatch[1] : resolvedMatch[2]);
  }

  const assignActions = [...text.matchAll(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}),\s+由\s+([^。]+?)\s+指派给\s+([^。]+?)\s+。/g)];
  const initialAssign = assignActions[0];
  if (initialAssign) {
    detail.initialAssignedTo = initialAssign[3].trim();
  }

  const assignedChangeMatches = [...text.matchAll(/修改了\s+指派给\s+，旧值为\s+"([^"]*)"\s*，新值为\s+"([^"]*)"/g)];
  const firstAssignedChange = assignedChangeMatches[0];
  if (!detail.initialAssignedTo && firstAssignedChange) {
    detail.initialAssignedTo = (firstAssignedChange[1] || firstAssignedChange[2] || "").trim();
  }

  const latestAssign = assignActions.at(-1);
  if (latestAssign) {
    const assignedTo = latestAssign[3].trim();
    if (!/^Closed$/i.test(assignedTo)) detail.assignedTo = assignedTo;
    detail.assignedFrom = latestAssign[2].trim();
    detail.assignedAt = normalizeZentaoDateTime(latestAssign[1]);
    detail.assignedStatusAfter = getStatusAfterAction(text, detail.assignedAt) || detail.assignedStatusAfter || "";
  }

  const latestTransferAssign = [...assignActions].reverse().find((match) => {
    const transferTo = match[3].trim();
    const transferAt = normalizeZentaoDateTime(match[1]);
    const statusAfter = getStatusAfterAction(text, transferAt);
    return !/^Closed$/i.test(transferTo) && normalizeZentaoStatus(statusAfter) !== "resolved";
  });
  if (latestTransferAssign) {
    detail.transferFrom = latestTransferAssign[2].trim();
    detail.transferTo = latestTransferAssign[3].trim();
    detail.transferAt = normalizeZentaoDateTime(latestTransferAssign[1]);
    detail.transferStatusAfter = getStatusAfterAction(text, detail.transferAt) || "";
  }

  const testAssign = [...assignActions].reverse().find((match) => isTestOwner(match[3]));
  if (!detail.assignedFrom && testAssign) {
    detail.assignedAt = normalizeZentaoDateTime(testAssign[1]);
    detail.assignedFrom = testAssign[2].trim();
    detail.assignedTo = testAssign[3].trim();
  }

  if (detail.resolvedBy && isTestOwner(detail.resolvedBy) && detail.assignedFrom && !isTestOwner(detail.assignedFrom)) {
    detail.resolvedBy = detail.assignedFrom;
  }

  const historyClosedMatches = [...text.matchAll(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}),\s+由\s+([^。]+?)\s+关闭。/g)];
  const closedMatch = historyClosedMatches.reverse()[0]
    || text.match(/由谁关闭\s+([^\s]+?)\s+于\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
  if (closedMatch) {
    const firstGroupIsDate = /^\d{4}-\d{2}-\d{2}/.test(closedMatch[1]);
    detail.closedBy = (firstGroupIsDate ? closedMatch[2] : closedMatch[1]).trim();
    detail.closedDate = normalizeZentaoDateTime(firstGroupIsDate ? closedMatch[1] : closedMatch[2]);
  }

  if (!detail.closedDate) {
    const closedDateMatch = text.match(/修改了\s+关闭日期\s+，旧值为\s+"[^"]*"\s*，新值为\s+"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})"/);
    if (closedDateMatch) detail.closedDate = normalizeZentaoDateTime(closedDateMatch[1]);
  }

  if (
    detail.assignedFrom
    && isFrontendOwner(detail.assignedFrom)
    && isTestOwner(detail.assignedTo || defect.assignedTo)
    && ["resolved", "closed"].includes(normalizeZentaoStatus(detail.status || defect.status))
  ) {
    detail.resolvedBy = detail.assignedFrom;
    detail.resolvedDate = detail.assignedAt || detail.resolvedDate;
    detail.assignedStatusAfter = detail.assignedStatusAfter || "resolved";
  }

  if (!detail.assignedFrom && detail.resolvedBy && isFrontendOwner(detail.resolvedBy) && isTestOwner(detail.assignedTo || defect.assignedTo)) {
    detail.assignedFrom = detail.resolvedBy;
    detail.assignedAt = detail.resolvedDate || detail.assignedAt || "";
    detail.assignedStatusAfter = "resolved";
  }

  return detail;
}

function getStatusAfterAction(text, actionAt) {
  if (!actionAt) return "";
  const secondAt = actionAt.length === 16 ? `${actionAt}:\\d{2}` : actionAt;
  const nextActionPattern = "\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2},\\s+由\\s+";
  const actionPattern = new RegExp(`(${secondAt},\\s+由\\s+[\\s\\S]*?)(?=${nextActionPattern}|$)`);
  const actionMatch = text.match(actionPattern);
  if (!actionMatch) return "";
  const statusMatch = actionMatch[1].match(/修改了\s+Bug状态\s+，旧值为\s+"[^"]*"\s*，新值为\s+"([^"]*)"/);
  return statusMatch ? normalizeZentaoStatus(statusMatch[1]) : "";
}

function extractBugList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.bugs)) return data.bugs;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.data?.bugs)) return data.data.bugs;
  return [];
}

function extractLegacyBugList(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];

  try {
    const data = JSON.parse(trimmed);
    const direct = extractBugList(data);
    if (direct.length) return direct;
    const html = data.main || data.data?.main || data.content || "";
    if (html) return extractBugsFromHtml(html);
  } catch {
    return extractBugsFromHtml(trimmed);
  }

  return [];
}

function isZentaoLoginRedirect(text) {
  return /user-login|m=user&f=login|用户登录|id=["']login|name=["']account/i.test(String(text || ""));
}

function getZentaoPagerTotal(text, browseType = "unresolved") {
  const type = escapeRegExp(browseType);
  const match = String(text || "").match(new RegExp(`bug-browse-\\d+-0-${type}-0-[^-'\"<>]+-(\\d+)-\\{?recPerPage\\}?-\\{?page\\}?\\.html`, "i"))
    || String(text || "").match(new RegExp(`bug-browse-\\d+-0-${type}-0-[^-'\"<>]+-(\\d+)-20\\.html`, "i"));
  return match ? Number(match[1]) : 0;
}

function extractBugsFromHtml(html) {
  const rows = String(html).match(/<tr[\s\S]*?<\/tr>/gi) || [];
  return rows.map(parseBugRow).filter(Boolean);
}

function parseBugRow(row) {
  const idMatch = row.match(/bug-(?:view|edit)-(\d+)/i) || row.match(/data-id=["']?(\d+)/i) || row.match(/data-id=["']?bug-(\d+)/i);
  if (!idMatch) return null;
  const id = Number(idMatch[1]);
  const text = stripTags(row).replace(/\s+/g, " ").trim();
  const titleCell = getTableCell(row, "c-title");
  const severityCell = getTableCell(row, "c-severity");
  const priorityCell = getTableCell(row, "c-pri");
  const assignedCell = getTableCell(row, "c-assignedTo");
  const statusCell = getTableCell(row, "c-status");
  const openedByCell = getTableCell(row, "c-openedBy");
  const openedDateCell = getTableCell(row, "c-openedDate");
  const lastEditedDateCell = getTableCell(row, "c-lastEditedDate") || getTableCell(row, "c-lastEdited");
  const titleMatch = titleCell?.match(/bug-view-\d+[^>]*>([\s\S]*?)<\/a>/i) || row.match(/bug-view-\d+[^>]*title=['"]([^'"]+)['"]/i);
  const title = titleMatch ? decodeHtml(stripTags(titleMatch[1]).trim()) : text;
  const severityMatch = severityCell?.match(/title=['"]([^'"]+)['"]/i)
    || row.match(/class=['"][^'"]*c-severity[^'"]*['"][\s\S]*?title=['"]([^'"]+)['"]/i)
    || severityCell?.match(/data-severity=['"]?(\d)/i)
    || row.match(/class=['"][^'"]*c-severity[^'"]*['"][\s\S]*?data-severity=['"]?(\d)/i)
    || severityCell?.match(/>([^<>]+)</i);
  const priorityMatch = priorityCell?.match(/data-pri=['"]?(\d)/i) || priorityCell?.match(/label-pri[^>]*label-pri-(\d)/i) || priorityCell?.match(/(?:P)?\s*(\d)/i);
  const statusMatch = statusCell?.match(/title=['"]([^'"]+)['"]/i) || statusCell?.match(/status-bug[^>]*>([\s\S]*?)<\/span>/i);
  const statusText = statusMatch ? decodeHtml(stripTags(statusMatch[1]).trim()) : text;

  return {
    id,
    title: decodeHtml(title || `Bug #${id}`),
    status: normalizeZentaoStatus(statusText),
    priority: priorityMatch ? priorityMatch[1] : "0",
    severity: severityMatch ? decodeHtml(stripTags(severityMatch[1]).trim()) : "",
    assignedTo: assignedCell ? decodeHtml(stripTags(assignedCell).trim()) : "",
    openedBy: openedByCell ? decodeHtml(stripTags(openedByCell).trim()) : "",
    openedDate: openedDateCell ? normalizeZentaoDateTime(decodeHtml(stripTags(openedDateCell).trim())) : "",
    resolvedDate: "",
    closedDate: "",
    lastEditedDate: lastEditedDateCell ? normalizeZentaoDateTime(decodeHtml(stripTags(lastEditedDateCell).trim())) : "",
    url: `${trimSlash(config.zentao.baseUrl)}/bug-view-${id}.html`
  };
}

function getTableCell(row, className) {
  const escaped = escapeRegExp(className);
  const match = String(row || "").match(new RegExp(`<td[^>]*class=['\"][^'\"]*${escaped}[^'\"]*['\"][^>]*>([\\s\\S]*?)<\\/td>`, "i"));
  return match ? match[1] : "";
}

function normalizeZentaoStatus(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("已解决") || text.includes("解决") || /\bresolved\b/i.test(text)) return "resolved";
  if (text.includes("已关闭") || text.includes("关闭") || /\bclosed\b/i.test(text)) return "closed";
  if (text.includes("激活") || /\bactive\b/i.test(text)) return "active";
  if (text.includes("变更") || /\bchanging\b/i.test(text)) return "changing";
  return text;
}

function normalizeZentaoDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{2}-\d{2}/.test(text)) return `${new Date().getFullYear()}-${text}`;
  return text;
}

function normalizeZentaoDateTime(value) {
  const text = normalizeZentaoDate(String(value || "").trim());
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(text)) return `${text}:00`;
  return text;
}

function getRecentPushLogs() {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return store.pushLogs
    .filter((log) => {
      const time = new Date(log.createdAt).getTime();
      return Number.isFinite(time) && time >= since;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20);
}

function getMobilesForDefects(defects) {
  return [...new Set(defects.map((defect) => getUserMappingForAssignee(defect.assignedTo)?.mobile).filter(Boolean))];
}

function getUserMappingForAssignee(assignee) {
  const userMap = config.userMappings || {};
  const raw = String(assignee || "").trim();
  if (userMap[raw]) return userMap[raw];

  const normalizedRaw = normalizeAssigneeName(raw);
  return Object.entries(userMap).find(([account, user]) => {
    return normalizeAssigneeName(account) === normalizedRaw || normalizeAssigneeName(user?.name) === normalizedRaw;
  })?.[1];
}

function getAssigneesFromDefects(defects) {
  return dedupeAssignees((defects || []).map((defect) => defect.assignedTo).filter(isLikelyAssignee)).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function extractTeamMembers(html) {
  const rows = String(html || "").match(/<tr[\s\S]*?<\/tr>/gi) || [];
  return [...new Set(rows.map((row) => {
    const firstCell = String(row).match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    return firstCell ? decodeHtml(stripTags(firstCell[1]).trim()) : "";
  }).filter(isLikelyAssignee))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function isLikelyAssignee(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return !["closed", "resolved", "active", "关闭", "已关闭", "解决", "已解决", "激活"].includes(text.toLowerCase());
}

function groupByOwner(defects, open, todayAdded, todayPendingTest) {
  const pendingTest = defects.filter(isResolvedPendingVerifyDefect);
  const todayTransferred = defects.filter(isTodayTransferredDefect);
  const todayReturned = defects.filter(isTodayReturnedDefect);
  const configuredOwners = (config.rules.assignees || []).filter((owner) => owner && !isTestOwner(owner));
  const names = new Set(configuredOwners.length ? configuredOwners : [
    ...open.map((defect) => defect.assignedTo || "unassigned"),
    ...todayAdded.map((defect) => defect.assignedTo || "unassigned"),
    ...todayPendingTest.flatMap(getDeveloperOwnerFields),
    ...pendingTest.map((defect) => defect.assignedFrom || "unassigned")
  ]);
  return [...names].map((account) => {
    const mapped = config.userMappings?.[account];
    const ownedOpen = open.filter((defect) => namesEqual(defect.assignedTo || "unassigned", account));
    const ownedPendingTest = pendingTest.filter((defect) => namesEqual(defect.assignedFrom, account));
    return {
      account,
      name: mapped?.name || account || "未指派",
      openTotal: ownedOpen.length,
      urgentOpen: ownedOpen.filter(isUrgentDefect).length,
      normalOpen: ownedOpen.filter((defect) => !isUrgentDefect(defect)).length,
      pendingTest: ownedPendingTest.length,
      todayAdded: todayAdded.filter((defect) => namesEqual(getInitialAssignedTo(defect) || "unassigned", account)).length,
      todayTransferred: todayTransferred.filter((defect) => namesEqual(getTransferFrom(defect), account)).length,
      todayReturned: todayReturned.filter((defect) => namesEqual(defect.assignedTo, account)).length,
      todayResolved: todayPendingTest.filter((defect) => getDeveloperOwnerFields(defect).some((owner) => namesEqual(owner, account))).length
    };
  }).sort((a, b) => (b.openTotal - a.openTotal) || (b.urgentOpen - a.urgentOpen) || (b.pendingTest - a.pendingTest) || (b.normalOpen - a.normalOpen));
}

function getDeveloperOwnerFields(defect) {
  return [getResolverName(defect), defect.assignedFrom].filter(Boolean);
}

function isConfiguredPersonDefect(defect) {
  if (normalizeZentaoStatus(defect.status) === "active" && isTestOwner(defect.assignedTo) && !isAbnormalTransferredDefect(defect)) return false;
  const configured = config.rules.assignees || [];
  if (!configured.length) return true;
  if (["resolved", "closed"].includes(normalizeZentaoStatus(defect.status))) {
    return configured.some((assignee) => [defect.resolvedBy, defect.assignedFrom].some((value) => namesEqual(value, assignee)));
  }
  if (isTestOwner(defect.assignedTo)) {
    return configured.some((assignee) => namesEqual(defect.assignedFrom, assignee));
  }
  if (isTodayTransferredDefect(defect)) {
    return configured.some((assignee) => [getTransferFrom(defect), getTransferTo(defect)].some((value) => namesEqual(value, assignee)));
  }
  return configured.some((assignee) => namesEqual(defect.assignedTo, assignee));
}

function getDefectOwnerName(defect) {
  const status = normalizeZentaoStatus(defect.status);
  if (status === "closed") return getFrontendDeveloperName(defect) || defect.closedBy || getResolverName(defect) || "未指派";
  if (status === "resolved") return getFrontendDeveloperName(defect) || getResolverName(defect) || "未指派";
  return defect.assignedTo || "未指派";
}

function getFrontendDeveloperName(defect) {
  const resolver = getResolverName(defect);
  if (isFrontendOwner(resolver)) return resolver;
  if (isFrontendOwner(defect.assignedFrom)) return defect.assignedFrom;
  return "";
}

function getResolverName(defect) {
  if (isLastTransferFromConfiguredOwnerToTest(defect)) return defect.assignedFrom;
  return defect.resolvedBy || defect.assignedFrom || "";
}

function isCurrentTerminalDefect(defect) {
  const status = normalizeZentaoStatus(defect.status);
  if (!["resolved", "closed"].includes(status)) return true;
  return isToday(getTerminalDate(defect));
}

function getTerminalDate(defect) {
  const status = normalizeZentaoStatus(defect.status);
  if (status === "closed") return defect.closedDate || defect.resolvedDate || defect.assignedAt;
  if (status === "resolved") return defect.resolvedDate || defect.assignedAt || defect.closedDate;
  return "";
}

function getOpenedAgeBucket(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = startOfLocalDay(new Date());
  const openedDay = startOfLocalDay(date);
  const diffDays = Math.floor((today.getTime() - openedDay.getTime()) / 86400000);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays === 2) return "beforeYesterday";
  return "overdue";
}

function isToday(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isOpenDefect(defect) {
  return !["resolved", "closed"].includes(normalizeZentaoStatus(defect.status));
}

function isPushVisibleDefect(defect) {
  if (isTestOwner(defect.assignedTo)) return false;
  const assignees = getConfiguredAssigneeNames();
  if (!assignees.length) return true;
  return assignees.includes(normalizeAssigneeName(defect.assignedTo));
}

function isVisibleOpenOverviewDefect(defect) {
  if (isTestOwner(defect.assignedTo)) return false;
  const assignees = getConfiguredAssigneeNames();
  if (!assignees.length) return true;
  return assignees.includes(normalizeAssigneeName(defect.assignedTo));
}

function isUrgentDefect(defect) {
  return new Set((config.rules.urgentPriorities || ["1", "2"]).map(String)).has(String(defect.priority));
}

function isPendingTestDefect(defect) {
  return normalizeZentaoStatus(defect.status) === "active" && isTestOwner(defect.assignedTo) && Boolean(defect.assignedFrom);
}

function isTodayTransferredDefect(defect) {
  return Boolean(getTransferFrom(defect))
    && Boolean(getTransferTo(defect))
    && !namesEqual(getTransferFrom(defect), getTransferTo(defect))
    && isToday(getTransferAt(defect))
    && !isResolvedByTransferAction(defect);
}

function isTodayIncomingTransferToConfiguredDefect(defect, range = getTodayRange()) {
  return Boolean(getTransferFrom(defect))
    && Boolean(getTransferTo(defect))
    && !namesEqual(getTransferFrom(defect), getTransferTo(defect))
    && isInRange(getTransferAt(defect), range)
    && isFrontendOwner(getTransferTo(defect))
    && !isResolvedByTransferAction(defect);
}

function uniqueDefects(defects) {
  const seen = new Set();
  return defects.filter((defect) => {
    const key = String(defect.id || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isResolvedByTransferAction(defect) {
  if (normalizeZentaoStatus(getTransferStatusAfter(defect)) === "resolved") return true;
  return Boolean(defect.resolvedDate)
    && isSameMinute(defect.resolvedDate, getTransferAt(defect))
    && namesEqual(defect.resolvedBy, getTransferFrom(defect));
}

function getTransferFrom(defect) {
  return defect.transferFrom || defect.assignedFrom || "";
}

function getTransferTo(defect) {
  return defect.transferTo || defect.assignedTo || "";
}

function getTransferAt(defect) {
  return defect.transferAt || defect.assignedAt || "";
}

function getTransferStatusAfter(defect) {
  return defect.transferStatusAfter || defect.assignedStatusAfter || "";
}

function isTodayReturnedDefect(defect) {
  return Boolean(defect.assignedFrom)
    && Boolean(defect.assignedTo)
    && !namesEqual(defect.assignedFrom, defect.assignedTo)
    && isToday(defect.assignedAt);
}

function isTodayInitiallyAssignedDefect(defect) {
  return Boolean(getInitialAssignedTo(defect)) && isToday(defect.openedDate);
}

function getInitialAssignedTo(defect) {
  return defect.initialAssignedTo || defect.assignedTo || "";
}

function isAbnormalTransferredDefect(defect) {
  return (isPendingTestDefect(defect) && isFrontendOwner(defect.assignedFrom))
    || isReactivatedByTestToFrontendDefect(defect);
}

function isReactivatedByTestToFrontendDefect(defect) {
  return normalizeZentaoStatus(defect.status) === "active"
    && isFrontendOwner(defect.assignedTo)
    && isTestOwner(defect.activatedBy);
}

function isFrontendResolvedDefect(defect) {
  return ["resolved", "closed"].includes(normalizeZentaoStatus(defect.status))
    && isFrontendOwner(getResolverName(defect));
}

function isResolvedByConfiguredOwnerToTest(defect) {
  return isTransferredToTest(defect) && [defect.assignedFrom, defect.resolvedBy].some(isFrontendOwner);
}

function isTransferredToTest(defect) {
  return isTestOwner(defect.assignedTo) || isTestOwner(defect.closedBy);
}

function isLastTransferFromConfiguredOwnerToTest(defect) {
  return isTransferredToTest(defect) && isFrontendOwner(defect.assignedFrom);
}

function isResolvedPendingVerifyDefect(defect) {
  return normalizeZentaoStatus(defect.status) === "resolved"
    && isTestOwner(defect.assignedTo)
    && isConfiguredDeveloperRelatedDefect(defect);
}

function isFrontendClosedDefect(defect) {
  return normalizeZentaoStatus(defect.status) === "closed"
    && isConfiguredDeveloperRelatedDefect(defect);
}

function isConfiguredDeveloperRelatedDefect(defect) {
  return [defect.assignedFrom, defect.resolvedBy, getInitialAssignedTo(defect)].some(isFrontendOwner);
}

function getDeveloperResolvedAt(defect) {
  return defect.resolvedDate || defect.assignedAt || "";
}

function isFrontendOwner(value) {
  const configured = getConfiguredAssigneeNames().filter((owner) => !isTestOwner(owner));
  return configured.includes(normalizeAssigneeName(value));
}

function isTestOwner(value) {
  return TEST_OWNER_ALIASES.some((owner) => namesEqual(value, owner));
}

function namesEqual(left, right) {
  return normalizeAssigneeName(left) === normalizeAssigneeName(right);
}

function isSameMinute(left, right) {
  return normalizeZentaoDateTime(left).slice(0, 16) === normalizeZentaoDateTime(right).slice(0, 16);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scheduleJobs() {
  setInterval(() => {
    if (config.scheduler?.enabled === false) return;

    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const dateKey = formatDate(now);
    const fetchIntervalMs = getFetchIntervalMs();
    const lastFetchAt = store.lastScheduledRun.fetchAt ? new Date(store.lastScheduledRun.fetchAt).getTime() : 0;

    if (Date.now() - lastFetchAt >= fetchIntervalMs) {
      store.lastScheduledRun.fetchAt = now.toISOString();
      fetchAndStoreDefects("schedule").catch((error) => recordJobError("FETCH_DEFECTS", error));
    }

    const ruleConfig = getSchedulerRuleConfig();

    if (ruleConfig.yesterday && hhmm === config.scheduler.yesterdayReportTime && store.lastScheduledRun.yesterday !== dateKey) {
      const runKey = `yesterday:${dateKey}:${hhmm}`;
      if (!scheduledReportRunsInFlight.has(runKey)) {
        scheduledReportRunsInFlight.add(runKey);
        runYesterdayReport("schedule")
          .then(() => {
            store.lastScheduledRun.yesterday = dateKey;
            return saveStore();
          })
          .catch((error) => recordJobError("YESTERDAY_DAILY_REPORT", error))
          .finally(() => scheduledReportRunsInFlight.delete(runKey));
      }
    }
    if (ruleConfig.p1p2 && getP1P2ReportTimes().includes(hhmm) && !hasScheduledTimeRun("p1p2", dateKey, hhmm)) {
      const runKey = `p1p2:${dateKey}:${hhmm}`;
      if (scheduledReportRunsInFlight.has(runKey)) return;
      scheduledReportRunsInFlight.add(runKey);
      runP1P2Report("schedule")
        .then(() => {
          markScheduledTimeRun("p1p2", dateKey, hhmm);
          return saveStore();
        })
        .catch((error) => recordJobError("TODAY_P1P2_RISK_REPORT", error))
        .finally(() => scheduledReportRunsInFlight.delete(runKey));
    }
  }, 30 * 1000);
}

function getFetchIntervalMs() {
  return Math.max(1, Number(config.scheduler.fetchEveryMinutes) || 5) * 60 * 1000;
}

function getSchedulerRuleConfig() {
  return {
    yesterday: config.scheduler?.rules?.yesterday !== false,
    p1p2: config.scheduler?.rules?.p1p2 !== false
  };
}

function getP1P2ReportTimes() {
  return normalizeTimes(config.scheduler?.p1p2ReportTimes || config.scheduler?.p1p2ReportTime, ["18:00"]);
}

function hasScheduledTimeRun(key, dateKey, hhmm) {
  const value = store.lastScheduledRun[key];
  if (value && typeof value === "object") return value[dateKey]?.includes(hhmm);
  return value === dateKey;
}

function markScheduledTimeRun(key, dateKey, hhmm) {
  const value = store.lastScheduledRun[key];
  if (!value || typeof value !== "object") store.lastScheduledRun[key] = {};
  const times = new Set(store.lastScheduledRun[key][dateKey] || []);
  times.add(hhmm);
  store.lastScheduledRun[key][dateKey] = [...times].sort();
}

async function recordJobError(type, error) {
  store.jobRuns.push({
    id: randomId(),
    type,
    trigger: "schedule",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    ok: false,
    error: error.message
  });
  await saveStore();
}

async function serveStatic(requestPath, req, res) {
  if (isGuestRoutePath(requestPath)) {
    await serveGuestIndex(res);
    return;
  }
  if (requestPath === "/index.html" && !isAdminRequest(req)) {
    await serveLoginIndex(res);
    return;
  }
  const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { ok: false, error: "Forbidden" });
    return;
  }
  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(content);
  } catch {
    sendJson(res, 404, { ok: false, error: "Not found" });
  }
}

async function serveLoginIndex(res) {
  try {
    const indexPath = path.join(publicDir, "index.html");
    const content = await fs.readFile(indexPath, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(content.replace("<body>", '<body class="login-mode">'));
  } catch {
    sendJson(res, 404, { ok: false, error: "Not found" });
  }
}

async function serveGuestIndex(res) {
  try {
    const indexPath = path.join(publicDir, "index.html");
    const content = await fs.readFile(indexPath, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(content.replace("<body>", '<body class="guest-mode">'));
  } catch {
    sendJson(res, 404, { ok: false, error: "Not found" });
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function getPublicConfig() {
  return {
    rules: {
      assignees: [...(config.rules?.assignees || [])]
    }
  };
}

function ensureAdminToken() {
  config.auth = {
    ...config.auth,
    adminToken: String(config.auth?.adminToken || "").trim()
  };
  if (!config.auth.adminToken) {
    config.auth.adminToken = crypto.randomBytes(18).toString("hex");
  }
}

function setAdminCookie(res, token, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`,
    ...extraHeaders
  });
  res.end(data ? JSON.stringify(data) : "");
}

function isAdminRequest(req) {
  const token = getRequestCookie(req, ADMIN_COOKIE_NAME) || req.headers["x-admin-token"];
  return tokensEqual(token, config.auth?.adminToken);
}

function isPublicRequest(req, url) {
  if (url.pathname === "/api/overview-pins" && ["GET", "PUT"].includes(req.method)) return true;
  if (url.pathname === "/api/overview-requirements" && ["GET", "PUT"].includes(req.method)) return true;
  if (req.method !== "GET") return false;
  if (url.pathname === "/" || url.pathname === "/index.html") return true;
  if (isGuestRoutePath(url.pathname)) return true;
  if (["/api/overview", "/api/defects", "/api/public-config", "/api/config-status", "/api/session"].includes(url.pathname)) return true;
  return ["/app.js", "/styles.css", "/favicon.svg"].includes(url.pathname);
}

function isGuestRoutePath(pathname) {
  return pathname === "/guest" || pathname === "/guest/" || /^\/guest\/[^/]+\/?$/.test(pathname);
}

function getRequestCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.split("=");
    if (key?.trim() === name) return decodeURIComponent(rest.join("=").trim());
  }
  return "";
}

function tokensEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

async function readBodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function saveConfig() {
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function replaceConfig(nextConfig) {
  for (const key of Object.keys(config)) delete config[key];
  Object.assign(config, nextConfig);
}

function normalizeConfig(value) {
  return {
    zentao: {
      baseUrl: String(value.zentao?.baseUrl || "").trim(),
      account: String(value.zentao?.account || "").trim(),
      password: String(value.zentao?.password || ""),
      cookie: String(value.zentao?.cookie || "").trim(),
      projectId: Number(value.zentao?.projectId) || getCookieValue(value.zentao?.cookie, "preProjectID") || 2635,
      productIds: toNumberArray(value.zentao?.productIds),
      enabled: Boolean(value.zentao?.enabled)
    },
    dingtalk: {
      webhook: normalizeDingTalkWebhook(value.dingtalk?.webhook || value.dingtalk?.accessToken),
      secret: String(value.dingtalk?.secret || "").trim(),
      dryRun: value.dingtalk?.dryRun !== false
    },
    rules: {
      statuses: toStringArray(value.rules?.statuses),
      priorities: toStringArray(value.rules?.priorities),
      urgentPriorities: toStringArray(value.rules?.urgentPriorities),
      assignees: dedupeAssignees(toStringArray(value.rules?.assignees))
    },
    userMappings: normalizeUserMappings(value.userMappings),
    scheduler: {
      enabled: value.scheduler?.enabled !== false,
      fetchEveryMinutes: Math.max(1, Number(value.scheduler?.fetchEveryMinutes ?? value.scheduler?.ruleFetchEveryMinutes) || 5),
      yesterdayReportTime: normalizeTime(value.scheduler?.yesterdayReportTime, "09:40"),
      p1p2ReportTimes: normalizeTimes(value.scheduler?.p1p2ReportTimes || value.scheduler?.p1p2ReportTime, ["18:00"]),
      rules: {
        yesterday: value.scheduler?.rules?.yesterday !== false,
        p1p2: value.scheduler?.rules?.p1p2 !== false
      }
    },
    auth: {
      adminToken: String(value.auth?.adminToken || "").trim()
    }
  };
}

function toStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function toNumberArray(value) {
  return toStringArray(value).map(Number).filter((item) => Number.isFinite(item));
}

function normalizeUserMappings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([account, user]) => [
    String(account).trim(),
    {
      name: String(user?.name || "").trim(),
      mobile: String(user?.mobile || "").trim()
    }
  ]).filter(([account]) => account));
}

function normalizeTime(value, fallback) {
  const text = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

function normalizeTimes(value, fallback) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[,，\s]+/);
  const times = [...new Set(values.map((item) => String(item || "").trim()).filter((item) => /^\d{2}:\d{2}$/.test(item)))];
  return times.length ? times.sort() : fallback;
}

function normalizeDingTalkWebhook(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  return `https://oapi.dingtalk.com/robot/send?access_token=${encodeURIComponent(text)}`;
}

function getCookieValue(cookie, name) {
  const parts = String(cookie || "").split(";");
  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    if (key?.trim() === name) return rest.join("=").trim();
  }
  return "";
}

function normalizeFilterText(value) {
  return String(value || "").trim().toLowerCase();
}

function dedupeAssignees(values) {
  const seen = new Set();
  return (values || []).map((value) => String(value || "").trim()).filter((value) => {
    if (!value) return false;
    const key = normalizeAssigneeName(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeAssigneeName(value) {
  const normalized = String(value || "")
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/_[a-z0-9-]+$/i, "")
    .trim();
  return ZENTAO_ACCOUNT_ALIASES[normalized.toLowerCase()] || normalized;
}

async function ensureFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(publicDir, { recursive: true });
  await ensureJson(configPath, defaultConfig);
  await ensureJson(storePath, defaultStore());
}

async function ensureJson(filePath, value) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function saveStore() {
  await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function defaultStore() {
  return { defects: [], pushLogs: [], jobRuns: [], lastScheduledRun: {}, pinnedOverviewDefects: [], requirementOverviewDefects: [], fetchSync: { assignees: [], assigneeWatermarks: {}, lastFetchAt: "" } };
}

function normalizePinnedDefectIds(value) {
  return normalizeOverviewDefectIds(value);
}

function normalizeOverviewDefectIds(value) {
  const ids = Array.isArray(value) ? value : [];
  return [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
}

function getPinnedOverviewDefectIds() {
  store.pinnedOverviewDefects = normalizePinnedDefectIds(store.pinnedOverviewDefects);
  return store.pinnedOverviewDefects;
}

function getRequirementOverviewDefectIds() {
  store.requirementOverviewDefects = normalizeOverviewDefectIds(store.requirementOverviewDefects);
  return store.requirementOverviewDefects;
}

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function getYesterdayRange() {
  const today = getTodayRange();
  const start = new Date(today.start);
  start.setDate(start.getDate() - 1);
  return { start, end: today.start };
}

function isInRange(value, range) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date >= range.start && date < range.end;
}

function todayAt(time) {
  return atRelativeDay(0, time);
}

function yesterdayAt(time) {
  return atRelativeDay(-1, time);
}

function atRelativeDay(offset, time) {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date();
  date.setDate(date.getDate() + offset);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function formatDate(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  return "application/octet-stream";
}

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function getCliLogLevel() {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "").toLowerCase();
    if (arg === "--debug") return "debug";
    if (arg === "--verbose" || arg === "-v") return "info";
    if (arg === "--quiet" || arg === "--silent") return "silent";
    if (arg === "--log" || arg === "--log-level") return normalizeLogLevelArg(args[index + 1]);
    if (arg.startsWith("--log=")) return normalizeLogLevelArg(arg.slice("--log=".length));
    if (arg.startsWith("--log-level=")) return normalizeLogLevelArg(arg.slice("--log-level=".length));
  }
  return "";
}

function normalizeLogLevelArg(value) {
  const level = String(value || "").trim().toLowerCase();
  if (!level) return "";
  if (level === "true" || level === "yes" || level === "on" || level === "1") return "info";
  return level;
}

async function fetchWithLog(label, url, options) {
  const startedAt = Date.now();
  logDebug("external:start", { label, method: options?.method || "GET", url: sanitizeUrl(url) });
  try {
    const response = await fetch(url, options);
    logDebug("external:end", {
      label,
      method: options?.method || "GET",
      url: sanitizeUrl(url),
      status: response.status,
      durationMs: Date.now() - startedAt
    });
    return response;
  } catch (error) {
    logError("external:error", {
      label,
      method: options?.method || "GET",
      url: sanitizeUrl(url),
      durationMs: Date.now() - startedAt,
      error: formatError(error)
    });
    throw error;
  }
}

function canLog(level) {
  return logLevel >= LOG_LEVELS[level];
}

function logDebug(message, details) {
  if (canLog("debug")) writeLog("debug", message, details);
}

function logInfo(message, details) {
  if (canLog("info")) writeLog("info", message, details);
}

function logError(message, details) {
  if (canLog("error")) writeLog("error", message, details);
}

function writeLog(level, message, details = {}) {
  const line = `[${new Date().toISOString()}] [${level}] ${message} ${JSON.stringify(details)}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

function formatError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    cause: error?.cause?.message || error?.cause?.code || "",
    stack: canLog("debug") ? error?.stack || "" : ""
  };
}

function sanitizeUrl(value) {
  try {
    const url = new URL(String(value));
    ["access_token", "timestamp", "sign"].forEach((key) => {
      if (url.searchParams.has(key)) url.searchParams.set(key, "***");
    });
    return url.toString();
  } catch {
    return String(value || "").replace(/(access_token|timestamp|sign)=([^&]+)/gi, "$1=***");
  }
}

function getLogLevelName() {
  return Object.entries(LOG_LEVELS).find(([, value]) => value === logLevel)?.[0] || "silent";
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomId() {
  return crypto.randomBytes(8).toString("hex");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTags(value) {
  return String(value || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'");
}
