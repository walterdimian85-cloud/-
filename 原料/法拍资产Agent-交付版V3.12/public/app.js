import { REGIONS } from './regions.js';
import { parseBulkHighWater } from './high-water-parser.js';

const $ = (id) => document.getElementById(id);
const mainElement = document.querySelector('main');
const appShell = document.createElement('div');
appShell.className = 'app-shell';
const historySidebar = document.createElement('aside');
historySidebar.className = 'history-sidebar';
historySidebar.id = 'historySidebar';
historySidebar.setAttribute('aria-hidden', 'true');
historySidebar.innerHTML = '<div class="history-heading"><h2>\u5386\u53f2\u4efb\u52a1</h2><button id="refreshHistory" class="secondary compact">\u5237\u65b0</button></div><p class="hint">\u70b9\u51fb\u4efb\u52a1\u53ef\u67e5\u770b\u5f53\u65f6\u6279\u6b21\uff0c\u4e0d\u4f1a\u5207\u6362\u5f53\u524d\u8fd0\u884c\u4efb\u52a1\u3002</p><div id="taskHistoryList" class="task-history-list"></div><div id="taskHistoryDetail" class="task-history-detail"><p class="hint">\u6682\u65e0\u53ef\u67e5\u770b\u7684\u5386\u53f2\u4efb\u52a1\u3002</p></div>';
mainElement.before(appShell);
appShell.append(historySidebar, mainElement);
const historyToggle = document.createElement('button');
historyToggle.id = 'historyToggle';
historyToggle.className = 'history-toggle';
historyToggle.type = 'button';
historyToggle.textContent = '\u203a';
historyToggle.setAttribute('aria-label', '\u5c55\u5f00\u5386\u53f2\u4efb\u52a1');
historyToggle.setAttribute('aria-controls', 'historySidebar');
historyToggle.setAttribute('aria-expanded', 'false');
document.body.append(historyToggle);
function setHistoryDrawer(open) {
  document.body.classList.toggle('history-open', open);
  historySidebar.setAttribute('aria-hidden', String(!open));
  historyToggle.setAttribute('aria-expanded', String(open));
  historyToggle.setAttribute('aria-label', open ? '\u6536\u8d77\u5386\u53f2\u4efb\u52a1' : '\u5c55\u5f00\u5386\u53f2\u4efb\u52a1');
  historyToggle.textContent = open ? '\u2039' : '\u203a';
}
historyToggle.onclick = () => setHistoryDrawer(!document.body.classList.contains('history-open'));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.classList.contains('history-open')) setHistoryDrawer(false);
});
setHistoryDrawer(false);
const openFolderButton = document.createElement('button');
openFolderButton.id = 'openBatchFolder';
openFolderButton.className = 'secondary';
openFolderButton.textContent = '\u6253\u5f00\u4fdd\u5b58\u6587\u4ef6\u5939';
$('start').parentElement.append(openFolderButton);
const countDashboard = document.createElement('section');
countDashboard.className = 'card dashboard-card';
countDashboard.id = 'countDashboard';
countDashboard.innerHTML = '<h2>\u5f53\u524d\u6279\u6b21\u8ba1\u6570</h2><div class="metrics count-metrics"><div><b id="metricDiscovered">0</b><span>\u672c\u6279\u6b21\u53d1\u73b0</span></div><div><b id="metricProcessed">0</b><span>\u672c\u6279\u6b21\u5df2\u5904\u7406</span></div><div><b id="metricSucceeded">0</b><span>\u672c\u6279\u6b21\u6210\u529f</span></div><div><b id="metricFailed">0</b><span>\u672c\u6279\u6b21\u5931\u8d25</span></div><div><b id="metricRemaining">0</b><span>\u672c\u6279\u6b21\u5269\u4f59</span></div><div><b id="metricHistory">0</b><span>\u5386\u53f2\u6570\u636e\u5e93\u603b\u6570</span></div></div><p class="hint">\u5f53\u524d\u6279\u6b21\u4e0e\u5386\u53f2\u603b\u91cf\u5206\u5f00\u7edf\u8ba1\uff0c\u65b0\u4efb\u52a1\u4ece 0 \u5f00\u59cb\u3002</p>';
document.querySelector('section.status').after(countDashboard);
document.head.insertAdjacentHTML('beforeend', '<style>.scope-anchor-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:end;margin:10px 0}.scope-anchor-row label{margin:0}.scope-anchor-status{display:inline-block;margin-left:8px;color:#71847d;font-size:12px;min-width:42px}@media(max-width:720px){.scope-anchor-row{grid-template-columns:1fr}}</style>');
const applyCustomButton = document.createElement('button');
applyCustomButton.id = 'applyCustomHighWater';
applyCustomButton.textContent = '调用相同范围上次高水位';
$('copyCustomHighWater').after(applyCustomButton);
const customScopeHint = document.querySelector('#customScope > .hint');
if (customScopeHint) customScopeHint.textContent = '可多选平台、类别和地级市。每个“平台 × 类别 × 城市”均需提供即将开始和已结束两条高水位。输入会按完全相同的范围独立保存并可再次调用，绝不会覆盖全省高水位。';
const reviewButton = document.createElement('button');
reviewButton.id = 'startReview';
reviewButton.textContent = '按所选方式开始复核';
$('copyReviewWorkbench').parentElement.prepend(reviewButton);
const reviewCredentialHint = document.createElement('div');
reviewCredentialHint.id = 'reviewCredentialHint';
reviewCredentialHint.className = 'review-credential-hint';
reviewCredentialHint.hidden = true;
$('copyReviewWorkbench').parentElement.before(reviewCredentialHint);
const reviewActionFeedback = document.createElement('p');
reviewActionFeedback.id = 'reviewActionFeedback';
reviewActionFeedback.className = 'review-action-feedback';
reviewActionFeedback.hidden = true;
$('copyReviewWorkbench').parentElement.before(reviewActionFeedback);
const reviewDashboard = document.createElement('section');
reviewDashboard.className = 'card review-dashboard';
reviewDashboard.id = 'reviewDashboard';
reviewDashboard.innerHTML = '<h2>AI复核进度</h2><div class="metrics review-metrics"><div><b id="reviewProcessed">0 / 0</b><span>已复核 / 总候选</span></div><div><b id="reviewPercent">0%</b><span>完成比例</span></div><div><b id="reviewRemaining">—</b><span>预计剩余时间</span></div></div><div class="review-progress-track"><div id="reviewProgressBar"></div></div><p id="reviewCurrent" class="review-note">尚未开始AI复核。</p><div class="grid review-details"><p>自动修改：<b id="reviewChanges">0</b></p><p>需人工关注：<b id="reviewAnomalies">0</b></p><p>技术失败：<b id="reviewFailures">0</b></p><p>剩余候选：<b id="reviewRemainingCount">0</b></p></div>';
$('copyReviewWorkbench').closest('section').after(reviewDashboard);
const reviewSummary = document.createElement('p');
reviewSummary.id = 'reviewSummary';
reviewSummary.className = 'review-summary';
reviewSummary.hidden = true;
$('reviewCurrent').after(reviewSummary);
const cachePanel = document.createElement('section');
cachePanel.className = 'card';
cachePanel.id = 'cachePanel';
cachePanel.innerHTML = `<h2>缓存处理</h2>
  <p class="hint">只清理白名单内的可再生过程文件。最终 Excel、批次元数据、高水位、登录状态、任务历史和当前批次始终保留。</p>
  <div class="cache-grid">
    <div class="cache-box"><h3>历史结果过程文件</h3><p class="hint">同一天的编号批次会一起按日期筛选；只有已完成且存在最终工作簿的旧批次可清理。</p>
      <div class="grid"><label>开始日期<input id="cacheFrom" type="date"></label><label>结束日期<input id="cacheTo" type="date"></label></div>
      <div class="actions"><button id="previewOutputCache" class="secondary">预览可清理文件</button><button id="cleanOutputCache" class="warning" disabled>清理所选日期缓存</button></div>
      <pre id="outputCachePreview" class="output-box" hidden></pre></div>
    <div class="cache-box"><h3>Agent 程序缓存</h3><p class="hint">仅清理 Edge 可再生成的网页、脚本、图形和组件缓存；不会删除整个 path、浏览器登录资料或 scoped-tasks 状态。</p>
      <div class="actions"><button id="previewAgentCache" class="secondary">预览程序缓存</button><button id="cleanAgentCache" class="warning" disabled>清理程序缓存</button></div>
      <pre id="agentCachePreview" class="output-box" hidden></pre></div>
  </div>`;
document.querySelector('main > section:last-of-type')?.after(cachePanel);
const resumeVerificationButton = document.createElement('button');
resumeVerificationButton.id = 'resumeReviewVerification';
resumeVerificationButton.className = 'warning';
resumeVerificationButton.textContent = '重新打开验证页并继续AI复核';
$('restartReview').after(resumeVerificationButton);
const resumeCollectorVerificationButton = document.createElement('button');
resumeCollectorVerificationButton.id = 'resumeCollectorVerification';
resumeCollectorVerificationButton.className = 'warning';
resumeCollectorVerificationButton.textContent = '\u6253\u5f00\u9a8c\u8bc1\u9875\u9762\uff0c\u9a8c\u8bc1\u540e\u7ee7\u7eed\u91c7\u96c6';
resumeCollectorVerificationButton.hidden = true;
resumeVerificationButton.after(resumeCollectorVerificationButton);
const collectionAbandonButton = document.createElement('button');
collectionAbandonButton.id = 'collectionAbandon';
collectionAbandonButton.className = 'secondary collection-abandon';
collectionAbandonButton.textContent = '放弃本次任务，重新选择';
collectionAbandonButton.hidden = true;
$('resume').after(collectionAbandonButton);
const collectionAbandonHint = document.createElement('span');
collectionAbandonHint.id = 'collectionAbandonHint';
collectionAbandonHint.className = 'hint collection-abandon-hint';
collectionAbandonHint.hidden = true;
collectionAbandonHint.textContent = '已保存结果会保留为历史，本次未完成任务不会更新高水位。';
collectionAbandonButton.after(collectionAbandonHint);
const resumeReviewButton = document.createElement('button');
resumeReviewButton.id = 'resumeReview';
resumeReviewButton.className = 'secondary';
resumeReviewButton.textContent = '\u6062\u590dAI\u590d\u6838';
resumeReviewButton.hidden = true;
resumeVerificationButton.after(resumeReviewButton);
const providerPresets = {
  deepseek: { baseUrl: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY', models: [['deepseek-v4-flash','DeepSeek V4 Flash'],['deepseek-v4-pro','DeepSeek V4 Pro'],['deepseek-chat','deepseek-chat']] },
  openai: { baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', models: [['gpt-5.6','OpenAI GPT-5.6']] },
  anthropic: { baseUrl: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY', models: [['claude-opus-4-8','Claude Opus 4.8']] },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKeyEnv: 'GEMINI_API_KEY', models: [['gemini-3-flash-preview','Gemini 3 Flash Preview']] },
  alibaba: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'DASHSCOPE_API_KEY', models: [['qwen3.7-plus','Qwen 3.7 Plus'],['kimi/kimi-k3','Kimi K3']] },
  openai_compatible: { baseUrl: '', apiKeyEnv: 'AI_API_KEY', models: [] },
};

function showError(error) { $('pageErrorText').textContent = error?.message || String(error); $('pageError').hidden = false; $('pageError').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
function clearError() { $('pageError').hidden = true; $('pageErrorText').textContent = ''; }
async function api(url, options = {}) { const response = await fetch(url, { headers: { 'content-type': 'application/json' }, ...options }).catch(() => { throw new Error('无法连接Agent后台，请使用启动程序打开页面。'); }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || `请求失败（HTTP ${response.status}）`); return data; }
async function action(work) { clearError(); try { return await work(); } catch (error) { showError(error); return null; } }
async function quietRefresh(work) { try { return await work(); } catch (error) { console.warn('Agent后台轮询暂时失败：', error); return null; } }
async function copyText(value) { try { await navigator.clipboard.writeText(value); } catch { const box = document.createElement('textarea'); box.value = value; document.body.appendChild(box); box.select(); document.execCommand('copy'); box.remove(); } }
const checkedValues = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((x) => x.value);
const selectedValues = (select) => [...select.selectedOptions].map((x) => x.value);
const ANCHOR_DRAFT_KEY = 'auction-agent-custom-anchor-drafts-v1';
let anchorDraft = JSON.parse(localStorage.getItem(ANCHOR_DRAFT_KEY) || '{}');
let anchorSaved = {};
let previousScopeSelection = null;
let lastRenderedAnchorKeys = new Set();
let anchorEditorExpanded = false;
function persistAnchorDraft() { localStorage.setItem(ANCHOR_DRAFT_KEY, JSON.stringify(anchorDraft)); }
function harvestAnchorInputs() { document.querySelectorAll('.scope-anchor').forEach((x) => { anchorDraft[x.dataset.key] = x.value.trim(); }); persistAnchorDraft(); }
function scopeDescriptor() { return { province: $('scopeProvince').value, cities: selectedValues($('scopeCities')), platforms: checkedValues('scopePlatform'), categories: checkedValues('scopeCategory'), selectedStatuses: selectedStatuses() }; }
function captureScopeSelection() { previousScopeSelection = { ...scopeDescriptor(), mode: $('scopeMode').value }; lastRenderedAnchorKeys = new Set(anchorRows().map((row) => row.key)); }
function restoreScopeSelection(value) { if (!value) return; $('scopeMode').value = value.mode; $('scopeProvince').value = value.province; populateCities(value.cities); document.querySelectorAll('input[name="scopePlatform"]').forEach((x) => x.checked = value.platforms.includes(x.value)); document.querySelectorAll('input[name="scopeCategory"]').forEach((x) => x.checked = value.categories.includes(x.value)); $('customScope').hidden = value.mode !== 'custom'; }
async function confirmRemovedUnsaved(nextKeys) { harvestAnchorInputs(); const removed = Object.entries(anchorDraft).filter(([key,value]) => value && lastRenderedAnchorKeys.has(key) && !nextKeys.has(key) && anchorSaved[key] !== value); if (!removed.length) return true; const text = removed.map(([key,value]) => `${key} = ${value}`).join('\n'); const copy = confirm(`切换范围会暂时隐藏以下尚未逐条保存的高水位（内容仍保留在本机草稿中）：\n\n${text}\n\n点击“确定”先复制并继续；点击“取消”保留当前选择。`); if (!copy) return false; await copyText(text); return true; }

function renderModels(selected = '') { const preset = providerPresets[$('provider').value] || providerPresets.openai_compatible; $('modelPreset').innerHTML = '<option value="">自定义模型ID</option>' + preset.models.map(([id,label]) => `<option value="${id}">${label}（${id}）</option>`).join(''); $('modelPreset').value = preset.models.some(([id]) => id === selected) ? selected : ''; $('model').value = selected || preset.models[0]?.[0] || ''; }
function applyProviderDefaults() { const preset = providerPresets[$('provider').value] || providerPresets.openai_compatible; $('baseUrl').value = preset.baseUrl; $('apiKeyEnv').value = preset.apiKeyEnv; renderModels(); }
let apiCredentialConfigured = false;
function toggleApiConfig() { if ($('apiConfig')) $('apiConfig').hidden = false; renderReviewCredentialHint(); }
async function refreshKeyStatus() { const value = await api('/api/credential-status'); apiCredentialConfigured = value.stored === true || value.configured === true; $('keyStatus').textContent = value.stored ? 'API Key已由Windows加密保存' : value.configured ? '环境API Key已就绪' : '尚未配置密钥'; renderReviewCredentialHint(); updateSetupSummary?.(); }
function renderReviewCredentialHint() {
  const hint = $('reviewCredentialHint');
  if (!hint) return;
  if ($('reviewMode')?.value !== 'api') { hint.hidden = true; hint.replaceChildren(); return; }
  hint.hidden = false;
  hint.innerHTML = apiCredentialConfigured
    ? '<span class="credential-ready">✓ API复核能力已配置，可以开始本批次API复核。</span>'
    : '<span>尚未配置API Key。请展开页面顶部的“首次运行与基础配置”，在“API复核能力配置”中完成设置；也可以改用工作台复核或暂不复核。</span><button id="goToApiConfiguration" type="button" class="secondary">前往配置API</button>';
  $('goToApiConfiguration')?.addEventListener('click', openApiConfiguration);
}

function populateProvinces(selected = '福建省') { $('scopeProvince').innerHTML = Object.keys(REGIONS).map((name) => `<option value="${name}">${name}</option>`).join(''); $('scopeProvince').value = selected in REGIONS ? selected : '福建省'; }
function populateCities(selected = []) { const province = $('scopeProvince').value; $('scopeCities').innerHTML = (REGIONS[province] || []).map((name) => `<option value="${name}" ${selected.includes(name) ? 'selected' : ''}>${name}</option>`).join(''); renderCityChecks(); }
function renderCityChecks() {
  const select = $('scopeCities');
  let container = $('scopeCityChecks');
  if (!container) {
    container = document.createElement('div');
    container.id = 'scopeCityChecks';
    container.className = 'city-checks';
    container.setAttribute('aria-label', '\u5730\u7ea7\u5e02');
    select.after(container);
  }
  select.classList.add('city-check-source');
  select.setAttribute('aria-hidden', 'true');
  select.tabIndex = -1;
  container.innerHTML = [...select.options].map((option) => `<label class="check-label city-check"><input type="checkbox" value="${option.value}" ${option.selected ? 'checked' : ''}>${option.textContent}</label>`).join('');
  container.querySelectorAll('input').forEach((checkbox) => checkbox.onchange = () => {
    const option = [...select.options].find((item) => item.value === checkbox.value);
    if (option) option.selected = checkbox.checked;
    select.dispatchEvent(new Event('change'));
  });
}
function anchorRows() { const platforms = checkedValues('scopePlatform'); const categories = checkedValues('scopeCategory'); const cities = selectedValues($('scopeCities')); const rows = []; for (const platform of platforms) for (const category of categories) for (const city of cities) for (const status of ['即将开始','已结束']) rows.push({ key: `${platform}:${category}:${status}:${city}`, platform, category, city, status }); return rows; }
function renderAnchorEditor(existing = {}) { harvestAnchorInputs(); Object.entries(existing).forEach(([key,value]) => { if (value) { anchorDraft[key] = value; anchorSaved[key] = value; } }); persistAnchorDraft(); const rows = anchorRows(); $('anchorEditor').innerHTML = rows.length ? `<div class="anchor-editor-heading"><h3>小范围独立高水位（${rows.length}条）</h3><button type="button" id="toggleAnchorEditor" class="secondary">${anchorEditorExpanded ? '收起输入项' : '展开输入项'}</button></div><p class="hint">输入内容会保存在本机草稿；每条可单独保存到当前范围档案。收起不会清空已输入内容。</p><div id="anchorEditorRows" ${anchorEditorExpanded ? '' : 'hidden'}><div class="bulk-anchor-panel"><label>批量粘贴高水位<textarea id="bulkAnchorText" rows="8" placeholder="京东拍卖:福州市:住宅用房:即将开始 = https://paimai.jd.com/..."></textarea></label><div class="actions"><button type="button" id="importBulkAnchors">一键识别并保存</button><span id="bulkAnchorResult" class="hint">支持直接粘贴程序输出的多行高水位。</span></div></div>` + rows.map((row) => `<div class="scope-anchor-row"><label>${row.platform === 'alibaba' ? '阿里资产' : '京东拍卖'} / ${row.city} / ${row.category} / ${row.status}<input class="scope-anchor" data-key="${row.key}" value="${anchorDraft[row.key] || ''}" placeholder="https://..."></label><div><button type="button" class="save-scope-anchor secondary" data-key="${row.key}">保存本条</button><span class="scope-anchor-status" data-status="${row.key}">${anchorSaved[row.key] === anchorDraft[row.key] && anchorDraft[row.key] ? '已保存' : ''}</span></div></div>`).join('') + '</div>' : '<p class="hint">请选择平台、类别和城市后，即可单条填写或批量导入高水位。</p>'; const toggle = $('toggleAnchorEditor'); if (toggle) toggle.onclick = () => { harvestAnchorInputs(); anchorEditorExpanded = !anchorEditorExpanded; $('anchorEditorRows').hidden = !anchorEditorExpanded; toggle.textContent = anchorEditorExpanded ? '收起输入项' : '展开输入项'; }; const importer = $('importBulkAnchors'); if (importer) importer.onclick = () => action(async () => { const parsed = parseBulkHighWater($('bulkAnchorText').value); if (!parsed.rows.length) throw new Error(parsed.errors[0]?.reason || '没有识别到可保存的高水位'); const provinceCities = new Set(REGIONS[$('scopeProvince').value] || []); const outside = [...new Set(parsed.rows.map((row) => row.city).filter((city) => !provinceCities.has(city)))]; if (outside.length) throw new Error(`以下城市不属于当前省份“${$('scopeProvince').value}”：${outside.join('、')}。请先切换省份。`); $('scopeMode').value = 'custom'; $('customScope').hidden = false; const importedPlatforms = new Set(parsed.rows.map((row) => row.platform)); const importedCategories = new Set(parsed.rows.map((row) => row.category)); const importedCities = new Set(parsed.rows.map((row) => row.city)); document.querySelectorAll('input[name="scopePlatform"]').forEach((x) => x.checked = importedPlatforms.has(x.value)); document.querySelectorAll('input[name="scopeCategory"]').forEach((x) => x.checked = importedCategories.has(x.value)); [...$('scopeCities').options].forEach((x) => x.selected = importedCities.has(x.value)); Object.assign(anchorDraft, parsed.anchors); persistAnchorDraft(); const profile = await api('/api/high-water/custom-save', { method:'POST', body:JSON.stringify({ ...scopeDescriptor(), anchors: parsed.anchors }) }); Object.assign(anchorSaved, parsed.anchors); anchorEditorExpanded = true; renderAnchorEditor(profile.anchors || {}); captureScopeSelection(); const required = anchorRows(); const missing = required.filter((row) => !profile.anchors?.[row.key]); const notes = [`已识别并保存${Object.keys(parsed.anchors).length}条`]; if (missing.length) notes.push(`当前组合仍缺${missing.length}条`); if (parsed.errors.length) notes.push(`${parsed.errors.length}行未识别`); if (parsed.duplicates.length) notes.push(`${parsed.duplicates.length}条重复键已采用最后一条`); alert(notes.join('；')); }); document.querySelectorAll('.scope-anchor').forEach((x) => x.oninput = () => { anchorDraft[x.dataset.key] = x.value.trim(); persistAnchorDraft(); const status = document.querySelector(`[data-status="${CSS.escape(x.dataset.key)}"]`); if (status) status.textContent = anchorSaved[x.dataset.key] === anchorDraft[x.dataset.key] ? '已保存' : '未保存'; }); document.querySelectorAll('.save-scope-anchor').forEach((button) => button.onclick = () => action(async () => { harvestAnchorInputs(); const value = anchorDraft[button.dataset.key]; if (!/^https?:\/\//u.test(value || '')) throw new Error('请先填写有效的高水位链接'); await api('/api/high-water/custom-save', { method:'POST', body:JSON.stringify({ ...scopeDescriptor(), anchors: { [button.dataset.key]: value } }) }); anchorSaved[button.dataset.key] = value; renderAnchorEditor(); })); }
function scopePayload() { const mode = $('scopeMode').value; const anchors = {}; document.querySelectorAll('.scope-anchor').forEach((x) => anchors[x.dataset.key] = x.value.trim()); return { mode, province: $('scopeProvince').value, cities: mode === 'custom' ? selectedValues($('scopeCities')) : [], platforms: mode === 'custom' ? checkedValues('scopePlatform') : ['alibaba','jd'], anchors: mode === 'custom' ? anchors : {}, anchorsConsumed: false }; }

async function loadConfig() { const config = await api('/api/config'); for (const key of ['skillV2Dir','stateDir','outputDir','agentDataDir']) $(key).value = config[key] || ''; $('reviewMode').value = config.ai?.mode || 'api'; $('provider').value = config.ai?.provider || 'deepseek'; renderModels(config.ai?.model || ''); $('baseUrl').value = config.ai?.baseUrl || ''; $('apiKeyEnv').value = config.ai?.apiKeyEnv || 'AI_API_KEY'; toggleApiConfig(); populateProvinces(config.collection?.scope?.province || '福建省'); const scope = config.collection?.scope || {}; $('scopeMode').value = scope.mode || 'province'; document.querySelectorAll('input[name="scopePlatform"]').forEach((x) => x.checked = (scope.platforms || ['alibaba','jd']).includes(x.value)); const categories = String(config.collection?.category || '住宅用房,商业用房,工业用房').split(','); document.querySelectorAll('input[name="scopeCategory"]').forEach((x) => x.checked = categories.includes(x.value)); populateCities(scope.cities || []); $('customScope').hidden = $('scopeMode').value !== 'custom'; renderAnchorEditor(scope.anchors || {}); captureScopeSelection(); await refreshKeyStatus(); }

function renderProgress(summary) { const rows = summary?.groups || []; $('progressRows').innerHTML = rows.length ? rows.map((row) => `<tr><td>${row.platformLabel}</td><td>${row.city || '全省'}</td><td>${row.category} · ${row.status}</td><td>${row.state}</td><td>${row.planned}</td><td>${row.processed}</td><td>${row.remaining}</td></tr>`).join('') : '<tr><td colspan="7">等待列表扫描</td></tr>'; const minimum = Math.ceil((summary?.estimateSeconds?.minimum || 0) / 60); const maximum = Math.ceil((summary?.estimateSeconds?.maximum || 0) / 60); const scanText = summary?.scanComplete ? `本轮共 ${summary?.planned || 0} 条` : `已核对 ${summary?.scannedGroups || 0}/${summary?.groupTotal || 12} 个高水位组，当前发现 ${summary?.planned || 0} 条（总量核对中）`; $('estimate').textContent = `${scanText}，已处理 ${summary?.processed || 0} 条，剩余 ${summary?.remaining || 0} 条；预计 ${minimum}–${maximum} 分钟（不含验证等待）。`; }
function renderReviewProgress(state) { const review = state.review || {}; const total = Number(review.total || state.summary?.reviewed || 0); const processed = Math.min(total || Infinity, Number(review.processed ?? (review.type === 'review_progress' ? Math.max(0, Number(review.index || 1) - 1) : 0))); const remaining = Math.max(0, Number(review.remaining ?? (total - processed))); const percent = total ? Math.round(processed / total * 100) : 0; let eta = '—'; if (processed > 0 && remaining > 0 && review.startedAt) { const elapsedSeconds = Math.max(1, (Date.now() - new Date(review.startedAt).getTime()) / 1000); eta = `约${Math.max(1, Math.ceil(elapsedSeconds / processed * remaining / 60))}分钟`; } else if (state.status === 'reviewing' && remaining > 0) eta = '计算中'; else if (total && remaining === 0) eta = '已完成'; $('reviewProcessed').textContent = `${processed} / ${total}`; $('reviewPercent').textContent = `${percent}%`; $('reviewRemaining').textContent = eta; $('reviewRemainingCount').textContent = remaining; $('reviewChanges').textContent = Number(review.changes || state.summary?.corrected || 0); $('reviewAnomalies').textContent = Number(review.anomalies || state.summary?.anomalies || 0); $('reviewFailures').textContent = Number(review.failures || state.summary?.operationalFailures || 0); $('reviewProgressBar').style.width = `${percent}%`; const reasons = Array.isArray(review.reasons) ? review.reasons.join('、') : ''; $('reviewCurrent').textContent = state.status === 'reviewing' || review.type === 'review_progress' ? `当前${review.index ? `第${review.index}条` : ''}：${review.url || '正在加载网页证据'}${reasons ? `；原因：${reasons}` : ''}` : state.status === 'waiting_user_action' && review.type === 'verification' ? `复核暂停等待人工验证：${review.url || ''}` : state.status === 'completed' && total ? 'AI复核已完成。' : '尚未开始AI复核。'; }
async function refreshStatus() { const value = await api('/api/status'); const state = value.state || {}; const collecting = ['starting','collecting','pause_requested'].includes(state.status); const reviewBlocked = state.status === 'waiting_user_action' && state.review?.type === 'verification'; const resumable = !reviewBlocked && ['paused','collection_failed','waiting_user_action','waiting_output_unlock'].includes(state.status); const labels = { idle:'空闲', starting:'正在启动', collecting:'正在采集', pause_requested:'正在保存后暂停', paused:'已暂停', waiting_output_unlock:'等待关闭Excel', awaiting_review_choice:'等待选择复核方式', reviewing:'AI复核中', review_pending_workbench:'等待工作台复核', review_pending:'复核待处理', completed:'已完成', collection_failed:'采集未完成', waiting_user_action:'等待人工验证' }; $('badge').textContent = labels[state.status] || state.status || '空闲'; $('count').textContent = state.progressSummary?.processed ?? state.count ?? state.summary?.totalRecords ?? 0; $('elapsed').textContent = state.elapsedMinutes || 0; $('phase').textContent = labels[state.status] || state.status || '空闲'; $('message').textContent = state.message || '尚未开始任务'; $('current').textContent = state.current?.url ? `当前：${state.current.url}` : state.status === 'review_pending_workbench' ? '采集已完成，请复制工作台复核口令。' : state.status === 'awaiting_review_choice' ? '请在下方选择API自动复核、工作台复核或暂不复核，然后点击“按所选方式开始复核”。' : ''; $('approve').style.display = state.status === 'awaiting_high_water_confirmation' ? 'inline-block' : 'none'; $('pause').hidden = !collecting; $('pause').disabled = state.status === 'pause_requested'; $('start').hidden = collecting || state.status === 'reviewing' || state.status === 'awaiting_review_choice' || reviewBlocked; $('start').disabled = false; $('resume').hidden = !resumable; $('resume').disabled = !resumable; $('resume').textContent = state.status === 'waiting_output_unlock' ? '完成收尾并选择复核方式' : '继续上次采集'; $('restartReview').hidden = !reviewBlocked; $('restartReview').disabled = !reviewBlocked; $('startReview').disabled = state.status !== 'awaiting_review_choice'; renderProgress(state.progressSummary); renderReviewProgress(state); }

function renderHighWaterEditor(snapshot) { $('highWaterRows').innerHTML = snapshot.rows.map((row) => `<div class="editor-row"><label>${row.platform} / ${row.city ? `${row.city} / ` : ''}${row.category} / ${row.status}</label><input class="high-water-input" data-key="${row.key}" value="${row.url || ''}" placeholder="https://..."></div>`).join(''); $('highWaterEditor').hidden = false; }

// Status controls are generated here to keep the existing page markup compatible with older installs.
const statusScopeControls = document.createElement('fieldset');
statusScopeControls.innerHTML = '<legend>拍卖状态（可多选）</legend><label class="check-label"><input type="checkbox" name="scopeStatus" value="即将开始">即将开始</label><label class="check-label"><input type="checkbox" name="scopeStatus" value="已结束">已结束</label>';
$('scopeCard').querySelector('.grid').before(statusScopeControls);
const platformFieldset = document.querySelector('input[name="scopePlatform"][value="jd"]').closest('fieldset');
const alibabaLabel = document.querySelector('input[name="scopePlatform"][value="alibaba"]').closest('label');
const alibabaPcLabel = document.querySelector('input[name="scopePlatform"][value="alibaba_pc"]').closest('label');
const jdLabel = document.querySelector('input[name="scopePlatform"][value="jd"]').closest('label');
const jdPcLabel = document.createElement('label');
jdPcLabel.className = 'check-label';
jdPcLabel.innerHTML = '<input type="checkbox" name="scopePlatform" value="jd_pc">\u4eac\u4e1c\u62cd\u5356\uff08PC\u7aef\uff09';
const jdRowBreak = document.createElement('span');
jdRowBreak.className = 'platform-row-break';
jdRowBreak.setAttribute('aria-hidden', 'true');
const platformSelectionHint = document.createElement('p');
platformSelectionHint.id = 'platformSelectionHint';
platformSelectionHint.className = 'hint platform-selection-hint';
platformSelectionHint.textContent = '\u963f\u91cc\u8d44\u4ea7\u4e24\u4e2a\u5165\u53e3\u53ea\u80fd\u9009\u5176\u4e00\uff1b\u4eac\u4e1c\u62cd\u5356\u4e24\u4e2a\u5165\u53e3\u53ea\u80fd\u9009\u5176\u4e00\uff1b\u963f\u91cc\u4e0e\u4eac\u4e1c\u53ef\u540c\u65f6\u9009\u62e9\u3002';
platformFieldset.append(alibabaLabel, alibabaPcLabel, jdRowBreak, jdLabel, jdPcLabel, platformSelectionHint);
function selectedStatuses() { return checkedValues('scopeStatus'); }
scopeDescriptor = () => ({ province: $('scopeProvince').value, cities: selectedValues($('scopeCities')), platforms: checkedValues('scopePlatform'), categories: checkedValues('scopeCategory'), selectedStatuses: selectedStatuses() });
anchorRows = () => { const platforms = checkedValues('scopePlatform'); const categories = checkedValues('scopeCategory'); const cities = selectedValues($('scopeCities')); const rows = []; for (const platform of platforms) for (const category of categories) for (const city of cities) for (const status of selectedStatuses()) rows.push({ key: `${platform}:${category}:${status}:${city}`, platform, category, city, status }); return rows; };
scopePayload = () => { const mode = $('scopeMode').value; const anchors = {}; document.querySelectorAll('.scope-anchor').forEach((x) => anchors[x.dataset.key] = x.value.trim()); return { mode, province: $('scopeProvince').value, cities: mode === 'custom' ? selectedValues($('scopeCities')) : [], platforms: mode === 'custom' ? checkedValues('scopePlatform') : ['alibaba','jd'], selectedStatuses: selectedStatuses(), anchors: mode === 'custom' ? anchors : {}, anchorsConsumed: false }; };
document.querySelectorAll('input[name="scopeStatus"]').forEach((input) => input.onchange = () => action(() => scopeSelectionChanged()));
const loadConfigBase = loadConfig;
loadConfig = async () => { await loadConfigBase(); const configured = (await api('/api/config')).collection?.selectedStatuses || ['即将开始', '已结束']; document.querySelectorAll('input[name="scopeStatus"]').forEach((input) => { input.checked = configured.includes(input.value); }); renderAnchorEditor(); };
$('provider').onchange = applyProviderDefaults;
$('modelPreset').onchange = () => { if ($('modelPreset').value) $('model').value = $('modelPreset').value; };
$('reviewMode').onchange = toggleApiConfig;
async function scopeSelectionChanged({ provinceChanged = false } = {}) { const old = previousScopeSelection; if (provinceChanged) populateCities([]); const nextKeys = new Set(anchorRows().map((row) => row.key)); if (!(await confirmRemovedUnsaved(nextKeys))) { restoreScopeSelection(old); renderAnchorEditor(); return; } $('customScope').hidden = $('scopeMode').value !== 'custom'; renderAnchorEditor(); captureScopeSelection(); }
$('scopeMode').onchange = () => action(() => scopeSelectionChanged());
$('scopeProvince').onchange = () => action(() => scopeSelectionChanged({ provinceChanged:true }));
$('scopeCities').onchange = () => action(() => scopeSelectionChanged());
document.querySelectorAll('input[name="scopePlatform"],input[name="scopeCategory"]').forEach((x) => x.onchange = () => action(() => scopeSelectionChanged()));

$('save').onclick = () => action(async () => { const current = await api('/api/config'); await api('/api/config', { method: 'POST', body: JSON.stringify({ ...current, skillV2Dir: $('skillV2Dir').value, stateDir: $('stateDir').value, outputDir: $('outputDir').value, agentDataDir: $('agentDataDir').value, ai: { ...current.ai, provider: $('provider').value, baseUrl: $('baseUrl').value.trim(), model: $('model').value.trim(), apiKeyEnv: $('apiKeyEnv').value.trim() } }) }); alert('配置已保存'); });
$('saveScope').onclick = () => action(async () => { const current = await api('/api/config'); const scope = scopePayload(); const categories = scope.mode === 'custom' ? checkedValues('scopeCategory') : ['住宅用房','商业用房','工业用房']; if (scope.mode === 'custom' && (!scope.platforms.length || !categories.length || !scope.cities.length)) throw new Error('小范围任务必须选择至少一个平台、类别和城市。'); await api('/api/config', { method: 'POST', body: JSON.stringify({ ...current, collection: { ...current.collection, platform: scope.platforms.length === 2 ? 'all' : scope.platforms[0], category: categories.join(','), scope } }) }); alert(scope.mode === 'custom' ? '小范围采集已独立保存，不会覆盖全省高水位' : '全省标准采集范围已保存'); });
$('saveKey').onclick = () => action(async () => { const key = $('apiKey').value.trim(); if (!key) throw new Error('请先粘贴API Key'); await api('/api/credential', { method: 'POST', body: JSON.stringify({ envName: $('apiKeyEnv').value.trim(), apiKey: key, remember: $('rememberKey').checked }) }); $('apiKey').value = ''; await refreshKeyStatus(); alert('API Key已保存'); });
$('forgetKey').onclick = () => action(async () => { if (!confirm('确定忘记已保存的API Key吗？')) return; await api('/api/credential-forget', { method: 'POST' }); await refreshKeyStatus(); });
$('start').onclick = () => action(async () => {
  const { state = {} } = await api('/api/status');
  if (['paused', 'failed'].includes(state.status)
    && !confirm('当前任务尚未完成。新建任务会将当前断点保留到历史记录，但不再作为当前恢复任务。是否继续？')) return;
  await api('/api/new-task', { method: 'POST' });
  await refreshStatus();
});
$('pause').onclick = () => action(async () => { await api('/api/pause', { method: 'POST' }); await refreshStatus(); });
$('resume').onclick = () => action(async () => { await api('/api/resume', { method: 'POST' }); await refreshStatus(); });
$('restartReview').onclick = () => action(async () => { if (!confirm('确定中止当前卡住的AI复核吗？已采集Excel、高水位和复核队列都会保留，之后可重新选择复核方式。')) return; await api('/api/review-restart', { method: 'POST' }); await refreshStatus(); });
$('resumeReviewVerification').onclick = () => action(async () => { await api('/api/review-verification-resume', { method: 'POST' }); await refreshStatus(); });
async function refreshVerificationResumeButton(snapshot = null) {
  const { state = {} } = snapshot || await api('/api/status');
  const canResumeVerification = ['paused', 'waiting_user_action', 'review_pending'].includes(state.status)
    && state.review?.type === 'verification';
  $('resumeReviewVerification').hidden = !canResumeVerification;
  $('resumeReviewVerification').disabled = !canResumeVerification;
}
$('startReview').onclick = () => action(async () => { await api('/api/review-choice', { method: 'POST', body: JSON.stringify({ mode: $('reviewMode').value }) }); await refreshStatus(); });
$('approve').onclick = () => action(async () => { if (confirm('确认当前高水位正确并继续采集吗？')) { await api('/api/approve-volume', { method: 'POST' }); await refreshStatus(); } });
$('showProvinceHighWater').onclick = () => action(async () => { if (!$('provinceHighWaterText').hidden) { $('provinceHighWaterText').hidden = true; $('showProvinceHighWater').textContent = '显示全省高水位'; return; } const value = await api('/api/high-water/province'); $('provinceHighWaterText').textContent = value.text || '暂无全省高水位。'; $('provinceHighWaterText').hidden = false; $('showProvinceHighWater').textContent = '隐藏全省高水位'; });
$('copyProvinceHighWater').onclick = () => action(async () => { const value = await api('/api/high-water/province'); await copyText(value.text); alert('全省高水位已复制'); });
$('showCustomHighWater').onclick = () => action(async () => { if (!$('customHighWaterText').hidden) { $('customHighWaterText').hidden = true; $('customHighWaterMeta').textContent = ''; $('showCustomHighWater').textContent = '显示上次小范围高水位'; return; } const value = await api('/api/high-water/custom-last'); $('customHighWaterText').textContent = value.text || '尚无已完成的小范围采集高水位。'; $('customHighWaterMeta').textContent = value.complete ? `批次：${value.runName || '未知'}；范围：${(value.cities || []).join('、') || '未知'}；完成时间：${value.completedAt || '未知'}` : ''; $('customHighWaterText').hidden = false; $('showCustomHighWater').textContent = '隐藏上次小范围高水位'; });
$('copyCustomHighWater').onclick = () => action(async () => { const value = await api('/api/high-water/custom-last'); if (!value.text) throw new Error('尚无已完成的小范围采集高水位'); await copyText(value.text); alert('上次小范围高水位已复制'); });
$('applyCustomHighWater').onclick = () => action(async () => { if ($('scopeMode').value !== 'custom') throw new Error('请先选择“小范围定制采集”及所需城市、平台和类别'); const profile = await api('/api/high-water/custom-apply', { method:'POST', body:JSON.stringify(scopeDescriptor()) }); renderAnchorEditor(profile.anchors || {}); alert('已调用完全相同范围的上次小范围高水位，不会影响全省高水位'); });
$('editHighWater').onclick = () => action(async () => renderHighWaterEditor(await api('/api/high-water/province')));
$('cancelHighWater').onclick = () => { $('highWaterEditor').hidden = true; };
$('saveHighWater').onclick = () => action(async () => { if (!confirm('确定重置全省生产高水位吗？上次小范围高水位不会受到影响。')) return; const anchors = {}; document.querySelectorAll('.high-water-input').forEach((x) => anchors[x.dataset.key] = x.value.trim()); const value = await api('/api/high-water/reset-province', { method: 'POST', body: JSON.stringify({ anchors }) }); $('provinceHighWaterText').textContent = value.text; $('provinceHighWaterText').hidden = false; $('showProvinceHighWater').textContent = '隐藏全省高水位'; $('highWaterEditor').hidden = true; alert('全省生产高水位已保存'); });
async function copyWorkbench(purpose) { const target = $('workbench').value; const value = await api(`/api/workbench-prompt?target=${encodeURIComponent(target)}&purpose=${purpose}`); await copyText(value.prompt); alert(`${target}${purpose === 'review' ? '复核' : '采集'}口令已复制`); }
$('copyReviewWorkbench').onclick = () => action(() => copyWorkbench('review'));
$('copyWorkbench').onclick = () => action(() => copyWorkbench('run'));

let activeTaskIdentity = null;
let selectedHistoryTask = null;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
async function currentIdentity() {
  const { state = {} } = await api('/api/status');
  if (!state.taskId || !state.batchId) throw new Error('\u5f53\u524d\u4efb\u52a1\u662f\u65e7\u7248\u672a\u7ed1\u5b9a\u6279\u6b21\uff0c\u8bf7\u65b0\u5efa\u4efb\u52a1\u540e\u518d\u6267\u884c\u64cd\u4f5c\u3002');
  activeTaskIdentity = { taskId: state.taskId, batchId: state.batchId };
  return activeTaskIdentity;
}
async function renderTaskDetail(task) {
  selectedHistoryTask = task;
  $('taskHistoryDetail').innerHTML = `<h3>${escapeHtml(task.runName || task.dateKey || '\u672a\u547d\u540d\u6279\u6b21')}</h3><p><b>\u72b6\u6001\uff1a</b>${escapeHtml(task.status || '-')}</p><p><b>taskId\uff1a</b><code>${escapeHtml(task.taskId)}</code></p><p><b>batchId\uff1a</b><code>${escapeHtml(task.batchId)}</code></p><p><b>\u6570\u91cf\uff1a</b>${Number(task.progressSummary?.processed ?? task.count ?? 0)}</p><p class="hint">${escapeHtml(task.statusMessage || '')}</p><button id="openHistoryFolder" class="secondary">\u6253\u5f00\u8be5\u6279\u6b21\u6587\u4ef6\u5939</button>`;
  $('openHistoryFolder').onclick = () => action(() => api('/api/task/open-folder', { method:'POST', body:JSON.stringify({ taskId:task.taskId, batchId:task.batchId }) }));
}
async function refreshTaskHistory() {
  let tasks = [];
  try {
    ({ tasks = [] } = await api('/api/tasks'));
  } catch (error) {
    const legacyBackend = /ENOENT|public[\\/]api[\\/]tasks|HTTP\s+(404|500)/iu.test(String(error?.message || error));
    if (!legacyBackend) throw error;
    $('taskHistoryList').innerHTML = '<p class="hint">\u5f53\u524d\u8fd0\u884c\u7684\u662f\u65e7\u7248Agent\u540e\u7aef\u3002\u8bf7\u5173\u95ed\u65e7\u670d\u52a1\u540e\u91cd\u65b0\u53cc\u51fb\u542f\u52a8\u811a\u672c\uff0c\u5373\u53ef\u542f\u7528\u5386\u53f2\u4efb\u52a1\u3002</p>';
    return;
  }
  $('taskHistoryList').innerHTML = tasks.length ? tasks.map((task) => `<button class="task-history-item" data-task-id="${escapeHtml(task.taskId)}"><b>${escapeHtml(task.runName || task.dateKey)}</b><span>${escapeHtml(task.status || '-')}</span><small>${escapeHtml(task.updatedAt || '')}</small></button>`).join('') : '<p class="hint">\u65b0\u7248\u4efb\u52a1\u5c1a\u672a\u4ea7\u751f\u5386\u53f2\u8bb0\u5f55\u3002</p>';
  document.querySelectorAll('.task-history-item').forEach((button) => button.onclick = () => action(async () => {
    const { task } = await api(`/api/task?taskId=${encodeURIComponent(button.dataset.taskId)}`);
    await renderTaskDetail(task);
  }));
  if (selectedHistoryTask) {
    const updated = tasks.find((task) => task.taskId === selectedHistoryTask.taskId);
    if (updated) await renderTaskDetail(updated);
  }
}
$('refreshHistory').onclick = () => action(refreshTaskHistory);
$('openBatchFolder').onclick = () => action(async () => {
  const identity = await currentIdentity();
  await api('/api/task/open-folder', { method:'POST', body:JSON.stringify(identity) });
});
$('pause').onclick = () => action(async () => { await api('/api/pause', { method:'POST', body:JSON.stringify(await currentIdentity()) }); await refreshStatus(); });
$('resume').onclick = () => action(async () => { await api('/api/resume', { method:'POST', body:JSON.stringify(await currentIdentity()) }); await refreshStatus(); });
$('collectionAbandon').onclick = () => action(async () => {
  if (!confirm('确定放弃当前采集任务吗？\n已保存的记录、Excel和任务目录会继续保留，但本任务不能再继续采集，本次候选高水位不会生效。之后您可以重新选择平台、城市、类别和状态并开始新的采集。')) return;
  const button = $('collectionAbandon');
  button.disabled = true;
  button.textContent = '正在结束当前任务…';
  try {
    const identity = await currentIdentity();
    await api('/api/collection-abandon', { method:'POST', body:JSON.stringify(identity) });
    await refreshStatus();
    collectionAbandonHint.hidden = false;
    collectionAbandonHint.textContent = '当前任务已结束，原批次已保留为历史。现在可以重新选择采集范围。';
  } finally {
    button.disabled = false;
    button.textContent = '放弃本次任务，重新选择';
  }
});
$('restartReview').onclick = () => action(async () => { if (!confirm('\u786e\u8ba4\u7ec8\u6b62\u5f53\u524dAI\u590d\u6838\u5e76\u4fdd\u7559\u91c7\u96c6\u7ed3\u679c\uff1f')) return; await api('/api/review-restart', { method:'POST', body:JSON.stringify(await currentIdentity()) }); await refreshStatus(); });
$('resumeReviewVerification').onclick = () => action(async () => { await api('/api/review-verification-resume', { method:'POST', body:JSON.stringify(await currentIdentity()) }); await refreshStatus(); });
$('resumeCollectorVerification').onclick = () => action(async () => { await api('/api/collector-verification-resume', { method:'POST', body:JSON.stringify(await currentIdentity()) }); await refreshStatus(); await refreshOperationControls(); });
$('resumeReview').onclick = () => action(async () => { await api('/api/review-resume', { method:'POST', body:JSON.stringify(await currentIdentity()) }); await refreshStatus(); await refreshOperationControls(); });
$('startReview').onclick = () => action(async () => {
  const button = $('startReview');
  const mode = $('reviewMode').value;
  const labels = { api: '模型API自动复核', workbench: '工作台复核', off: '暂不复核' };
  const completeMessages = {
    api: '已提交模型API复核，程序已进入复核流程；复核完成后即可开始新的采集。',
    workbench: '已选择工作台复核，待复核包已准备；完成工作台复核后即可开始新的采集。',
    off: '已选择暂不复核，本批次将直接完成；现在可以开始新的采集。',
  };
  button.disabled = true;
  button.textContent = '正在提交复核方式…';
  reviewActionFeedback.hidden = false;
  reviewActionFeedback.className = 'review-action-feedback is-running';
  reviewActionFeedback.textContent = `已选择${labels[mode] || '复核方式'}，正在提交…`;
  try {
    const identity = await currentIdentity();
    const result = await api('/api/review-choice', { method:'POST', body:JSON.stringify({ ...identity, mode }) });
    await refreshStatus();
    await refreshOperationControls();
    if (result?.skippedReview) $('reviewCurrent').textContent = '本次已跳过AI复核，可以直接使用工作簿或开始新的采集任务。';
    reviewActionFeedback.className = 'review-action-feedback is-success';
    reviewActionFeedback.textContent = completeMessages[mode] || '复核方式已提交。';
  } catch (error) {
    reviewActionFeedback.className = 'review-action-feedback is-error';
    reviewActionFeedback.textContent = `复核方式未提交：${error.message || '请稍后重试。'}`;
    throw error;
  } finally {
    button.disabled = false;
    button.textContent = '按所选方式开始复核';
  }
});
$('approve').onclick = () => action(async () => { if (confirm('\u786e\u8ba4\u5f53\u524d\u9ad8\u6c34\u4f4d\u6b63\u786e\u5e76\u7ee7\u7eed\u91c7\u96c6\uff1f')) { await api('/api/approve-volume', { method:'POST', body:JSON.stringify(await currentIdentity()) }); await refreshStatus(); } });

function classificationMessage(state = {}) {
  if (state.phase !== 'category_classification') return '';
  const current = state.current || {};
  if (state.message || current.title || state.statusMessage) return state.message || current.title || state.statusMessage;
  const index = Number(current.classificationIndex || 0);
  const total = Number(current.classificationTotal || 0);
  return current.classificationCategory && index && total
    ? `\u6b63\u5728\u6838\u9a8c\u6807\u7684\u7c7b\u578b\uff1a${current.classificationCategory}\uff08${index}/${total}\uff09`
    : '\u6b63\u5728\u6838\u9a8c\u6807\u7684\u7c7b\u578b\u3002';
}
async function refreshOperationControls(snapshot = null) {
  const reviewCurrentText = $('reviewCurrent').textContent;
  const { state = {} } = snapshot || await api('/api/status');
  const actions = state.allowedActions || {};
  latestScopeState = state;
  latestAllowedActions = actions;
  const collectorMetrics = state.metrics?.collector || {};
  const reviewMetrics = state.metrics?.review || {};
  $('metricDiscovered').textContent = Number(collectorMetrics.discovered || 0);
  $('metricProcessed').textContent = Number(collectorMetrics.processed || 0);
  $('metricSucceeded').textContent = Number(collectorMetrics.succeeded || 0);
  $('metricFailed').textContent = Number(collectorMetrics.failed || 0);
  $('metricRemaining').textContent = Number(collectorMetrics.remaining || 0);
  $('metricHistory').textContent = Number(state.metrics?.history?.totalRecords || 0);
  $('count').textContent = Number(collectorMetrics.processed || 0);
  const reviewTotal = Number(reviewMetrics.total || 0);
  const reviewProcessed = Number(reviewMetrics.processed || 0);
  const reviewRemaining = Number(reviewMetrics.remaining || 0);
  const reviewPercent = reviewTotal ? Math.round(reviewProcessed / reviewTotal * 100) : 0;
  $('reviewProcessed').textContent = `${reviewProcessed} / ${reviewTotal}`;
  $('reviewRemainingCount').textContent = reviewRemaining;
  $('reviewFailures').textContent = Number(reviewMetrics.failed || 0);
  $('reviewPercent').textContent = `${reviewPercent}%`;
  $('reviewProgressBar').style.width = `${reviewPercent}%`;
  if (state.review?.summary?.headline) {
    const findings = Array.isArray(state.review.summary.keyFindings) ? state.review.summary.keyFindings.slice(0, 5) : [];
    $('reviewCurrent').textContent = [state.review.summary.headline, ...findings].filter(Boolean).join('；');
  }
  const statusLabels = {
    unconfigured:'\u672a\u914d\u7f6e', idle:'\u7a7a\u95f2', running:'\u8fd0\u884c\u4e2d',
    waiting_user_action:'\u7b49\u5f85\u7528\u6237\u64cd\u4f5c', pause_requested:'\u6b63\u5728\u8bf7\u6c42\u6682\u505c',
    paused:'\u5df2\u6682\u505c', completed:'\u5df2\u5b8c\u6210', partial_completed:'\u90e8\u5206\u5b8c\u6210',
    failed:'\u5931\u8d25\u5e76\u4fdd\u7559\u65ad\u70b9', terminated:'\u5df2\u4eba\u5de5\u7ec8\u6b62',
  };
  const phaseLabels = {
    configuration:'\u4efb\u52a1\u914d\u7f6e', idle:'\u7a7a\u95f2', task_preparation:'\u51c6\u5907\u4efb\u52a1',
    list_scan:'\u626b\u63cf\u5217\u8868', detail_collection:'\u91c7\u96c6\u8be6\u60c5', category_classification:'\u6838\u9a8c\u6807\u7684\u7c7b\u578b', collector_verification:'\u91c7\u96c6\u7b49\u5f85\u9a8c\u8bc1',
    workbook_generation:'\u751f\u6210\u5de5\u4f5c\u7c3f', review_choice:'\u9009\u62e9\u590d\u6838\u65b9\u5f0f', ai_review:'AI\u590d\u6838',
    review_verification:'AI\u590d\u6838\u7b49\u5f85\u9a8c\u8bc1', workbench_review:'\u5de5\u4f5c\u53f0\u590d\u6838',
    finalization:'\u6536\u5c3e\u4e0e\u5f52\u6863', complete:'\u5b8c\u6210',
  };
  const collectorVerification = isActiveCollectorVerification(state);
  const staleCollectorVerification = state.status === 'waiting_user_action' && !collectorVerification;
  const runningCollection = state.status === 'running' && ['task_preparation','list_scan','detail_collection'].includes(state.phase);
  $('badge').textContent = staleCollectorVerification ? '\u72b6\u6001\u5df2\u66f4\u65b0' : statusLabels[state.status] || state.status || '-';
  $('phase').textContent = staleCollectorVerification ? '-' : phaseLabels[state.phase] || state.phase || '-';
  $('message').textContent = staleCollectorVerification ? '' : classificationMessage(state) || (runningCollection && /\u6682\u505c|\u9a8c\u8bc1|\u7b49\u5f85\u7528\u6237/u.test(state.statusMessage || state.message || '') ? '\u91c7\u96c6\u6b63\u5728\u8fdb\u884c\u4e2d\u3002' : state.statusMessage || state.message || '');
  $('pause').hidden = !actions.pauseCollection;
  $('pause').disabled = state.status === 'pause_requested';
  const collectionOrPauseRequest = state.status === 'running' || state.status === 'pause_requested';
  const reviewPhase = ['review_choice', 'ai_review', 'review_verification', 'workbench_review'].includes(state.phase)
    || ['awaiting_review_choice', 'reviewing', 'review_pending_workbench', 'review_pending'].includes(state.status);
  const canAbandonCollection = actions.abandonCollection === true && !collectionOrPauseRequest && !reviewPhase;
  $('collectionAbandon').hidden = !canAbandonCollection;
  $('collectionAbandon').disabled = !canAbandonCollection;
  if (!canAbandonCollection) collectionAbandonHint.hidden = true;
  // Keep the primary action discoverable after completion; backend authority still controls availability.
  $('start').hidden = false;
  $('start').disabled = !actions.createTask;
  $('resume').hidden = !actions.resumeCollection;
  $('resume').disabled = !actions.resumeCollection;
  $('startReview').disabled = !actions.chooseReview;
  $('resumeReview').hidden = !actions.resumeReview;
  $('resumeReview').disabled = !actions.resumeReview;
  $('resumeReviewVerification').hidden = !actions.reopenReviewVerification;
  $('resumeReviewVerification').disabled = !actions.reopenReviewVerification;
  $('resumeCollectorVerification').hidden = !collectorVerification;
  $('resumeCollectorVerification').disabled = !collectorVerification;
  $('restartReview').hidden = state.phase !== 'review_verification';
  $('openBatchFolder').disabled = !actions.openBatchFolder;
  $('reviewCurrent').textContent = reviewCurrentText;
  const findings = Array.isArray(state.review?.summary?.keyFindings) ? state.review.summary.keyFindings.slice(0, 5) : [];
  const summary = [state.review?.summary?.headline, ...findings].filter(Boolean).join('；');
  $('reviewSummary').hidden = !summary;
  $('reviewSummary').textContent = summary;
  taskScopeInfo.textContent = `\u91c7\u96c6\u8303\u56f4\uff1a${scopeLabel(state)}\uff1b\u9884\u671f\u5206\u7ec4\uff1a${state.expectedGroupCount ?? '\u2014'}\u7ec4`;
  resumeScopeHint.hidden = !actions.resumeCollection && !collectorVerification;
  resumeScopeHint.textContent = collectorVerification
    ? '\u91c7\u96c6\u5df2\u6682\u505c\u5e76\u7b49\u5f85\u7f51\u9875\u9a8c\u8bc1\u3002\u8bf7\u6253\u5f00\u9a8c\u8bc1\u9875\u9762\u5b8c\u6210\u767b\u5f55\u3001\u6ed1\u5757\u6216\u5b89\u5168\u9a8c\u8bc1\uff0c\u5b8c\u6210\u540e\u7ee7\u7eed\u5f53\u524d\u91c7\u96c6\u4efb\u52a1\u3002'
    : actions.resumeCollection ? `\u5c06\u7ee7\u7eed\uff1a${scopeLabel(state)}\u3002\u7ee7\u7eed\u4efb\u52a1\u5c06\u4f7f\u7528\u539f\u4efb\u52a1\u8303\u56f4\uff0c\u4e0d\u4f1a\u91c7\u7528\u5f53\u524d\u65b0\u9009\u62e9\u3002` : '';
  const reviewFile = workbookFileName(state.workbookPath || state.paths?.workbook);
  reviewScopeInfo.textContent = reviewFile ? `\u590d\u6838\u8303\u56f4\uff1a${scopeLabel(state)}\uff1b\u76ee\u6807\u6587\u4ef6\uff1a${reviewFile}` : `\u590d\u6838\u8303\u56f4\uff1a${scopeLabel(state)}`;
  updateScopeStatusUi(state);
}

async function refreshUnifiedStatus(snapshot = null) {
  const { state = {} } = snapshot || await api('/api/status');
  latestScopeState = state;
  const statusLabels = {
    unconfigured:'\u672a\u914d\u7f6e', idle:'\u7a7a\u95f2', running:'\u8fd0\u884c\u4e2d',
    waiting_user_action:'\u7b49\u5f85\u7528\u6237\u64cd\u4f5c', pause_requested:'\u6b63\u5728\u8bf7\u6c42\u6682\u505c',
    paused:'\u5df2\u6682\u505c', completed:'\u5df2\u5b8c\u6210', partial_completed:'\u90e8\u5206\u5b8c\u6210',
    failed:'\u5931\u8d25\u5e76\u4fdd\u7559\u65ad\u70b9', terminated:'\u5df2\u4eba\u5de5\u7ec8\u6b62',
  };
  const phaseLabels = {
    configuration:'\u914d\u7f6e', idle:'\u7a7a\u95f2', task_preparation:'\u51c6\u5907\u4efb\u52a1', list_scan:'\u626b\u63cf\u5217\u8868',
    detail_collection:'\u91c7\u96c6\u8be6\u60c5', category_classification:'\u6838\u9a8c\u6807\u7684\u7c7b\u578b', collector_verification:'\u91c7\u96c6\u7b49\u5f85\u9a8c\u8bc1',
    workbook_generation:'\u751f\u6210\u5de5\u4f5c\u7c3f', review_choice:'\u9009\u62e9\u590d\u6838\u65b9\u5f0f', ai_review:'AI\u590d\u6838',
    review_verification:'AI\u590d\u6838\u7b49\u5f85\u9a8c\u8bc1', workbench_review:'\u5de5\u4f5c\u53f0\u590d\u6838',
    finalization:'\u6536\u5c3e\u4e0e\u5f52\u6863', complete:'\u5b8c\u6210',
  };
  const collectorVerification = isActiveCollectorVerification(state);
  const staleCollectorVerification = state.status === 'waiting_user_action' && !collectorVerification;
  const runningCollection = state.status === 'running' && ['task_preparation','list_scan','detail_collection'].includes(state.phase);
  $('badge').textContent = staleCollectorVerification ? '\u72b6\u6001\u5df2\u66f4\u65b0' : statusLabels[state.status] || state.status || '-';
  $('phase').textContent = staleCollectorVerification ? '-' : phaseLabels[state.phase] || state.phase || '-';
  $('message').textContent = staleCollectorVerification ? '' : classificationMessage(state) || (runningCollection && /\u6682\u505c|\u9a8c\u8bc1|\u7b49\u5f85\u7528\u6237/u.test(state.statusMessage || state.message || '') ? '\u91c7\u96c6\u6b63\u5728\u8fdb\u884c\u4e2d\u3002' : state.statusMessage || state.message || '');
  $('elapsed').textContent = Number(state.elapsedMinutes || 0);
  $('current').textContent = state.current?.url ? `\u5f53\u524d\uff1a${state.current.url}` : '';
  $('approve').style.display = state.gate?.type === 'confirm_high_water' ? 'inline-block' : 'none';
  renderProgress(state.progressSummary);
  renderReviewProgress(state);
}
refreshStatus = refreshUnifiedStatus;
function normalizedVerificationUrl(value) {
  try {
    const url = new URL(String(value || '').replace(/\\_/g, '_'));
    return `${url.origin}${url.pathname}`;
  } catch { return ''; }
}
function isActiveCollectorVerification(state = {}) {
  const verification = state.verification || {};
  const urlsMatch = !(verification.recordUrl && state.current?.url)
    || normalizedVerificationUrl(verification.recordUrl) === normalizedVerificationUrl(state.current.url);
  return state.status === 'waiting_user_action'
    && state.phase === 'collector_verification'
    && verification.required === true
    && verification.owner === 'collector'
    && state.allowedActions?.reopenCollectorVerification === true
    && urlsMatch;
}
let statusRequestSequence = 0;
async function refreshConsistentStatus() {
  const requestSequence = ++statusRequestSequence;
  const snapshot = await api('/api/status');
  if (requestSequence !== statusRequestSequence) return;
  await refreshUnifiedStatus(snapshot);
  await refreshVerificationResumeButton(snapshot);
  await refreshOperationControls(snapshot);
}
refreshStatus = refreshConsistentStatus;

let outputCacheToken = null;
let agentCacheToken = null;
const EXPECTED_SERVER_BUILD = '20260830-safe-reselect-v1';
const apiUnchecked = api;
async function assertCurrentBackend() {
  const status = await apiUnchecked('/api/status');
  if (status.serverBuild !== EXPECTED_SERVER_BUILD) {
    throw new Error('网页功能已经更新，但后台仍是旧版本。请关闭旧Agent窗口，然后重新运行“启动法拍资产Agent.cmd”。');
  }
}
api = async (url, options = {}) => {
  if (String(options.method || 'GET').toUpperCase() !== 'GET') await assertCurrentBackend();
  return apiUnchecked(url, options);
};
const formatBytes = (bytes) => {
  const units = ['B', 'KB', 'MB', 'GB']; let value = Number(bytes || 0); let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(index ? 2 : 0)} ${units[index]}`;
};
function renderCachePreview(targetId, preview) {
  const skipped = (preview.skipped || []).map((item) => `跳过 ${item.batch}：${item.reason}`);
  const files = (preview.files || []).map((item) => `${formatBytes(item.size)}  ${item.relativePath}`);
  const box = $(targetId); box.hidden = false;
  box.textContent = [`可清理 ${preview.fileCount} 个文件，共 ${formatBytes(preview.bytes)}`, ...skipped, ...files].join('\n');
}
$('previewOutputCache').onclick = () => action(async () => {
  await assertCurrentBackend();
  const from = $('cacheFrom').value; const to = $('cacheTo').value;
  const preview = await api(`/api/cache/preview?kind=output&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  outputCacheToken = preview.previewToken; $('cleanOutputCache').disabled = !preview.fileCount;
  renderCachePreview('outputCachePreview', preview);
});
$('cleanOutputCache').onclick = () => action(async () => {
  if (!outputCacheToken || !confirm('确认删除预览中的历史过程文件？最终 Excel、批次元数据和报告会保留，但这些批次将不能再从采集断点或工作台中恢复。')) return;
  const result = await api('/api/cache/cleanup', { method:'POST', body:JSON.stringify({ kind:'output', from:$('cacheFrom').value, to:$('cacheTo').value, previewToken:outputCacheToken }) });
  outputCacheToken = null; $('cleanOutputCache').disabled = true;
  $('outputCachePreview').textContent = `已清理 ${result.deletedCount} 个文件，释放 ${formatBytes(result.deletedBytes)}。${result.failed.length ? `\n${result.failed.length} 个文件因正在使用等原因未删除。` : ''}`;
});
$('previewAgentCache').onclick = () => action(async () => {
  await assertCurrentBackend();
  const preview = await api('/api/cache/preview?kind=agent');
  agentCacheToken = preview.previewToken; $('cleanAgentCache').disabled = !preview.fileCount;
  renderCachePreview('agentCachePreview', preview);
});
$('cleanAgentCache').onclick = () => action(async () => {
  if (!agentCacheToken || !confirm('确认清理预览中的 Agent 浏览器缓存？登录资料、高水位、任务状态和保存路径不会删除；下次首次打开网页可能需要重新下载部分缓存。')) return;
  const result = await api('/api/cache/cleanup', { method:'POST', body:JSON.stringify({ kind:'agent', previewToken:agentCacheToken }) });
  agentCacheToken = null; $('cleanAgentCache').disabled = true;
  $('agentCachePreview').textContent = `已清理 ${result.deletedCount} 个文件，释放 ${formatBytes(result.deletedBytes)}。${result.failed.length ? `\n${result.failed.length} 个文件因正在使用等原因未删除。` : ''}`;
});

function mountCleanupFeedback(buttonId, feedbackId) {
  const feedback = document.createElement('div');
  feedback.id = feedbackId;
  feedback.className = 'cleanup-feedback';
  feedback.hidden = true;
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  feedback.innerHTML = '<div class="cleanup-progress" role="progressbar" aria-label="\u6b63\u5728\u6e05\u7406\u7f13\u5b58" aria-valuetext="\u6b63\u5728\u6e05\u7406"><span></span></div><p></p>';
  $(buttonId).parentElement.after(feedback);
  return feedback;
}
const outputCleanupFeedback = mountCleanupFeedback('cleanOutputCache', 'outputCleanupFeedback');
const agentCleanupFeedback = mountCleanupFeedback('cleanAgentCache', 'agentCleanupFeedback');
function setCleanupFeedback(feedback, state, message) {
  feedback.hidden = false;
  feedback.className = `cleanup-feedback is-${state}`;
  feedback.querySelector('.cleanup-progress').setAttribute('aria-valuetext', state === 'running' ? '\u6b63\u5728\u6e05\u7406' : message);
  feedback.querySelector('p').textContent = message;
}
async function runCacheCleanup({ buttonId, feedback, previewId, getToken, clearToken, payload }) {
  const button = $(buttonId); const originalText = button.textContent;
  button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = '\u6b63\u5728\u6e05\u7406\u2026';
  setCleanupFeedback(feedback, 'running', '\u6b63\u5728\u6e05\u7406\u7f13\u5b58\uff0c\u8bf7\u4fdd\u6301\u6b64\u9875\u9762\u6253\u5f00\u3002\u6587\u4ef6\u8f83\u591a\u65f6\u53ef\u80fd\u9700\u8981\u5341\u51e0\u79d2\u3002');
  clearError();
  try {
    const result = await api('/api/cache/cleanup', { method:'POST', body:JSON.stringify(payload()) });
    clearToken();
    $(previewId).textContent = `\u5df2\u6e05\u7406 ${result.deletedCount} \u4e2a\u6587\u4ef6\uff0c\u91ca\u653e ${formatBytes(result.deletedBytes)}\u3002`;
    setCleanupFeedback(feedback, 'complete', `\u6e05\u7406\u5b8c\u6210\uff1a${result.deletedCount} \u4e2a\u6587\u4ef6\uff0c\u5171\u91ca\u653e ${formatBytes(result.deletedBytes)}\u3002`);
  } catch (error) {
    setCleanupFeedback(feedback, 'error', `\u6e05\u7406\u672a\u5b8c\u6210\uff1a${error?.message || String(error)}`);
    showError(error);
  } finally {
    button.removeAttribute('aria-busy'); button.textContent = originalText; button.disabled = !getToken();
  }
}
$('cleanOutputCache').onclick = async () => {
  if (!outputCacheToken || !confirm('\u786e\u8ba4\u5220\u9664\u9884\u89c8\u4e2d\u7684\u5386\u53f2\u8fc7\u7a0b\u6587\u4ef6\u5417\uff1f\u6700\u7ec8 Excel\u3001\u6279\u6b21\u5143\u6570\u636e\u548c\u62a5\u544a\u4f1a\u4fdd\u7559\u3002')) return;
  await runCacheCleanup({ buttonId:'cleanOutputCache', feedback:outputCleanupFeedback, previewId:'outputCachePreview', getToken:() => outputCacheToken, clearToken:() => { outputCacheToken = null; }, payload:() => ({ kind:'output', from:$('cacheFrom').value, to:$('cacheTo').value, previewToken:outputCacheToken }) });
};
$('cleanAgentCache').onclick = async () => {
  if (!agentCacheToken || !confirm('\u786e\u8ba4\u6e05\u7406\u9884\u89c8\u4e2d\u7684 Agent \u7a0b\u5e8f\u7f13\u5b58\u5417\uff1f\u767b\u5f55\u72b6\u6001\u3001\u9ad8\u6c34\u4f4d\u3001\u4efb\u52a1\u72b6\u6001\u548c\u4fdd\u5b58\u8def\u5f84\u4e0d\u4f1a\u88ab\u5220\u9664\u3002')) return;
  await runCacheCleanup({ buttonId:'cleanAgentCache', feedback:agentCleanupFeedback, previewId:'agentCachePreview', getToken:() => agentCacheToken, clearToken:() => { agentCacheToken = null; }, payload:() => ({ kind:'agent', previewToken:agentCacheToken }) });
};

const manualActions = document.createElement('div');
manualActions.id = 'manualActions';
manualActions.className = 'manual-actions';
manualActions.innerHTML = '<button id="openUserManual" type="button" class="secondary">\u7528\u6237\u4f7f\u7528\u624b\u518c</button><button id="openFaqManual" type="button" class="secondary">\u5e38\u89c1\u95ee\u9898\u53ca\u89e3\u51b3\u529e\u6cd5</button>';
const headerTools = document.createElement('div');
headerTools.className = 'header-tools';
headerTools.append($('badge'), manualActions);
document.querySelector('header').append(headerTools);
const manualDialog = document.createElement('dialog');
manualDialog.id = 'manualDialog';
manualDialog.className = 'manual-dialog';
manualDialog.innerHTML = '<div class="manual-dialog-header"><div><p class="eyebrow">HELP CENTER</p><h2 id="manualDialogTitle"></h2></div><button id="closeManualDialog" type="button" class="secondary" aria-label="\u5173\u95ed\u624b\u518c">\u5173\u95ed</button></div><div id="manualDialogBody" class="manual-dialog-body" tabindex="0"></div>';
document.body.append(manualDialog);
const manualEscapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const manualInline = (value) => manualEscapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
function renderManualMarkdown(markdown) {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n'); const out = []; let list = null; let paragraphs = [];
  const flushParagraph = () => { if (paragraphs.length) out.push(`<p>${paragraphs.map(manualInline).join('<br>')}</p>`); paragraphs = []; };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    const heading = line.match(/^(#{1,4})\s+(.+)$/); const bullet = line.match(/^[-*]\s+(.+)$/); const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (heading) { flushParagraph(); closeList(); const level = Math.min(4, heading[1].length + 1); out.push(`<h${level}>${manualInline(heading[2])}</h${level}>`); }
    else if (bullet || ordered) { flushParagraph(); const type = ordered ? 'ol' : 'ul'; if (list && list !== type) closeList(); if (!list) { out.push(`<${type}>`); list = type; } out.push(`<li>${manualInline((bullet || ordered)[1])}</li>`); }
    else if (!line.trim()) { flushParagraph(); closeList(); }
    else if (line.startsWith('> ')) { flushParagraph(); closeList(); out.push(`<blockquote>${manualInline(line.slice(2))}</blockquote>`); }
    else paragraphs.push(line);
  }
  flushParagraph(); closeList(); return out.join('');
}
function renderFaqMarkdown(markdown) {
  const parts = String(markdown || '').replace(/\r/g, '').split(/^###\s+/m); const intro = renderManualMarkdown(parts.shift());
  const items = parts.map((part) => { const [question, ...answer] = part.split('\n'); return `<details class="faq-item"><summary><span>Q</span>${manualInline(question)}</summary><div class="faq-answer"><span>A</span><div>${renderManualMarkdown(answer.join('\n'))}</div></div></details>`; });
  return `${intro}<div class="faq-list">${items.join('')}</div>`;
}
async function openManual(kind, title) {
  $('manualDialogTitle').textContent = title; $('manualDialogBody').innerHTML = '<p class="manual-loading">\u6b63\u5728\u52a0\u8f7d\u624b\u518c\u2026</p>'; manualDialog.showModal();
  try {
    const response = await fetch(`/api/manual?kind=${encodeURIComponent(kind)}`); const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '\u8bf7\u5173\u95ed\u65e7\u540e\u53f0\u540e\u91cd\u65b0\u542f\u52a8 Agent\u3002');
    $('manualDialogBody').innerHTML = kind === 'faq' ? renderFaqMarkdown(data.markdown) : renderManualMarkdown(data.markdown);
    $('manualDialogBody').focus();
  } catch (error) { $('manualDialogBody').innerHTML = `<p class="manual-load-error">${manualEscapeHtml(error?.message || String(error))}</p>`; }
}
$('openUserManual').onclick = () => openManual('user', '\u7528\u6237\u4f7f\u7528\u624b\u518c');
$('openFaqManual').onclick = () => openManual('faq', '\u5e38\u89c1\u95ee\u9898\u53ca\u89e3\u51b3\u529e\u6cd5');
$('closeManualDialog').onclick = () => manualDialog.close();

$('saveScope').onclick = () => action(async () => { const current = await api('/api/config'); const scope = scopePayload(); const categories = scope.mode === 'custom' ? checkedValues('scopeCategory') : ['住宅用房','商业用房','工业用房']; if (!scope.selectedStatuses.length) throw new Error('至少选择一个拍卖状态'); if (scope.mode === 'custom' && (!scope.platforms.length || !categories.length || !scope.cities.length)) throw new Error('小范围采集至少选择一个平台、类型和城市'); await api('/api/config', { method: 'POST', body: JSON.stringify({ ...current, collection: { ...current.collection, platform: scope.platforms.length === 2 ? 'all' : scope.platforms[0], category: categories.join(','), selectedStatuses: scope.selectedStatuses, status: scope.selectedStatuses.join(','), scope } }) }); alert('采集范围已保存'); });
const scopeStatusHint = document.createElement('p');
statusScopeControls.classList.add('status-scope-controls');
scopeStatusHint.id = 'scopeStatusHint';
scopeStatusHint.className = 'hint scope-status-hint';
scopeStatusHint.textContent = '\u4ec5\u9009\u201c\u5373\u5c06\u5f00\u59cb\u201d\u53ea\u91c7\u96c6\u9884\u544a\u6807\u7684\uff1b\u4ec5\u9009\u201c\u5df2\u7ed3\u675f\u201d\u53ea\u91c7\u96c6\u5df2\u7ed3\u675f\u6807\u7684\uff1b\u4e24\u9879\u90fd\u9009\u4fdd\u6301\u5b8c\u6574\u91c7\u96c6\u3002';
statusScopeControls.append(scopeStatusHint);
const scopePreview = document.createElement('p');
scopePreview.id = 'scopeWorkbookPreview'; scopePreview.className = 'hint scope-workbook-preview';
$('scopeCard').querySelector('#customScope').after(scopePreview);
const taskScopeInfo = document.createElement('p');
taskScopeInfo.id = 'taskScopeInfo'; taskScopeInfo.className = 'hint task-scope-info'; $('current').after(taskScopeInfo);
const resumeScopeHint = document.createElement('p');
resumeScopeHint.id = 'resumeScopeHint'; resumeScopeHint.className = 'hint resume-scope-hint'; resumeScopeHint.hidden = true; $('resume').after(resumeScopeHint);
const reviewScopeInfo = document.createElement('p');
reviewScopeInfo.id = 'reviewScopeInfo'; reviewScopeInfo.className = 'hint review-scope-info'; $('reviewSummary').after(reviewScopeInfo);
let latestScopeState = {}; let latestAllowedActions = {}; let newTaskSubmitting = false;
const scopeLabel = (value) => value?.statusLabel || (Array.isArray(value?.selectedStatuses) && value.selectedStatuses.length ? value.selectedStatuses.join(' + ') : '\u5168\u90e8\u72b6\u6001\uff08\u65e7\u4efb\u52a1\uff09');
const workbookFileName = (value) => String(value || '').split(/[\\/]/u).filter(Boolean).at(-1) || '';
function selectedScopeWorkbookPreview(state = latestScopeState) {
  const authorityName = workbookFileName(state?.workbookPath || state?.paths?.workbook);
  if (authorityName) return authorityName;
  if (!state?.dateKey) return '\u521b\u5efa\u4efb\u52a1\u540e\u7531\u540e\u53f0\u786e\u5b9a\u3002';
  const statuses = selectedStatuses(); const suffix = statuses.length === 1 ? `\uff08${statuses[0]}\uff09` : '';
  return `${state.dateKey}\u65b0\u589e\u623f\u6e90\u4fe1\u606f${suffix}.xlsx`;
}
function updateScopeStatusUi(state = latestScopeState) {
  const hadError = scopeStatusHint.classList.contains('scope-status-error');
  const valid = selectedStatuses().length > 0;
  scopeStatusHint.classList.toggle('scope-status-error', !valid);
  if (!valid) scopeStatusHint.textContent = '\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u4e2a\u91c7\u96c6\u72b6\u6001';
  if (valid && hadError) scopeStatusHint.textContent = '\u4ec5\u9009\u201c\u5373\u5c06\u5f00\u59cb\u201d\u53ea\u91c7\u96c6\u9884\u544a\u6807\u7684\uff1b\u4ec5\u9009\u201c\u5df2\u7ed3\u675f\u201d\u53ea\u91c7\u96c6\u5df2\u7ed3\u675f\u6807\u7684\uff1b\u4e24\u9879\u90fd\u9009\u4fdd\u6301\u5b8c\u6574\u91c7\u96c6\u3002';
  $('start').disabled = !valid || latestAllowedActions.createTask === false;
  scopePreview.textContent = `\u9884\u671f\u6210\u679c\u540d\u79f0\uff1a${selectedScopeWorkbookPreview(state)}\uff08\u6700\u7ec8\u4ee5\u540e\u53f0\u5de5\u4f5c\u7c3f\u8def\u5f84\u4e3a\u51c6\uff09`;
}
async function saveSelectedScope() {
  const scope = scopePayload();
  if (!scope.selectedStatuses.length) throw new Error('\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u4e2a\u91c7\u96c6\u72b6\u6001');
  const current = await api('/api/config');
  const categories = scope.mode === 'custom' ? checkedValues('scopeCategory') : ['\u4f4f\u5b85\u7528\u623f','\u5546\u4e1a\u7528\u623f','\u5de5\u4e1a\u7528\u623f'];
  if (scope.mode === 'custom' && (!scope.platforms.length || !categories.length || !scope.cities.length)) throw new Error('\u5c0f\u8303\u56f4\u91c7\u96c6\u81f3\u5c11\u9009\u62e9\u4e00\u4e2a\u5e73\u53f0\u3001\u7c7b\u578b\u548c\u57ce\u5e02');
  await api('/api/config', { method: 'POST', body: JSON.stringify({ ...current, collection: { ...current.collection, platform: scope.platforms.length === 2 ? 'all' : scope.platforms[0], category: categories.join(','), selectedStatuses: scope.selectedStatuses, status: scope.selectedStatuses.join(','), scope } }) });
}
document.querySelectorAll('input[name="scopeStatus"]').forEach((input) => input.onchange = () => { updateScopeStatusUi(); if (selectedStatuses().length) action(() => scopeSelectionChanged()); });
const loadConfigWithStatuses = loadConfig;
loadConfig = async () => { await loadConfigWithStatuses(); captureScopeSelection(); updateScopeStatusUi(); };
const restoreScopeSelectionWithStatuses = restoreScopeSelection;
restoreScopeSelection = (value) => { restoreScopeSelectionWithStatuses(value); document.querySelectorAll('input[name="scopeStatus"]').forEach((input) => { input.checked = (value?.selectedStatuses || []).includes(input.value); }); updateScopeStatusUi(); };
$('saveScope').onclick = () => action(async () => { await saveSelectedScope(); scopeStatusHint.textContent = '\u91c7\u96c6\u8303\u56f4\u5df2\u4fdd\u5b58\u3002'; });
$('start').onclick = () => action(async () => {
  if (newTaskSubmitting) return;
  newTaskSubmitting = true;
  $('start').disabled = true;
  try {
  if (!selectedStatuses().length) { updateScopeStatusUi(); throw new Error('\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u4e2a\u91c7\u96c6\u72b6\u6001'); }
  const { state = {} } = await api('/api/status');
  if (['paused', 'failed'].includes(state.status) && !confirm('\u5f53\u524d\u4efb\u52a1\u5c1a\u672a\u5b8c\u6210\uff0c\u65b0\u5efa\u4efb\u52a1\u4f1a\u4fdd\u7559\u65e7\u4efb\u52a1\u4e3a\u5386\u53f2\u8bb0\u5f55\u3002\u662f\u5426\u7ee7\u7eed\uff1f')) return;
  await saveSelectedScope();
  await api('/api/new-task', { method: 'POST', body: JSON.stringify({ selectedStatuses: selectedStatuses() }) });
  await refreshStatus();
  } finally {
    newTaskSubmitting = false;
    await refreshStatus();
  }
});
const renderProgressWithScope = renderProgress;
renderProgress = (summary = {}) => {
  renderProgressWithScope(summary);
  const expected = Number(summary.expectedGroupCount ?? latestScopeState.expectedGroupCount ?? summary.groupTotal ?? 0);
  if (expected) {
    const scanned = Number(summary.scannedGroups ?? 0); const processed = Number(summary.processed ?? 0); const remaining = Number(summary.remaining ?? 0);
    $('estimate').textContent = summary.scanComplete ? `\u9884\u671f\u5206\u7ec4 ${expected}\u7ec4\uff1b\u5df2\u5904\u7406 ${processed}\u6761\uff0c\u5269\u4f59 ${remaining}\u6761\u3002` : `\u6b63\u5728\u6838\u5bf9\uff1a${scanned}/${expected}\u7ec4\uff1b\u5f53\u524d\u5df2\u5904\u7406 ${processed}\u6761\u3002`;
  }
};
const renderProgressWithClassification = renderProgress;
renderProgress = (summary = {}) => {
  renderProgressWithClassification(summary);
  if (latestScopeState.phase !== 'category_classification') return;
  const rows = summary?.groups || [];
  if (!rows.length) return;
  $('progressRows').innerHTML = rows.map((row) => {
    const classification = row.classification;
    const total = Number(classification?.total || 0);
    const completed = Number(classification?.completed || 0);
    const stateText = row.state || (classification?.status === 'in_progress'
      ? `\u6b63\u5728\u6838\u9a8c ${completed}/${total}`
      : classification?.status === 'completed' ? '\u6807\u7684\u7c7b\u578b\u6838\u9a8c\u5b8c\u6210' : '-');
    const progress = total > 0 ? Math.max(0, Math.min(100, Math.round(completed / total * 100))) : 0;
    const progressMarkup = classification && total > 0
      ? `<div class="classification-cell"><span>${stateText}</span><div class="classification-progress" aria-label="\u6807\u7684\u7c7b\u578b\u6838\u9a8c ${completed}/${total}"><i style="width:${progress}%"></i></div><small>${completed}/${total}</small></div>`
      : stateText;
    return `<tr><td>${row.platformLabel}</td><td>${row.city || '\u5168\u7701'}</td><td>${row.category} \u00b7 ${row.status}</td><td>${progressMarkup}</td><td>${row.planned}</td><td>${row.processed}</td><td>${row.remaining}</td></tr>`;
  }).join('');
};
const formatHistoryTime = (task) => {
  const source = task.createdAt || task.updatedAt;
  const timestamp = Date.parse(source || '');
  if (!Number.isFinite(timestamp)) return String(task.runName || task.dateKey || '\u672a\u77e5\u65f6\u95f4');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `\u5317\u4eac\u65f6\u95f4 ${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}`;
};
let historyPlatformLabel = (task) => {
  const platforms = task.collection?.scope?.platforms || task.collection?.platforms || (task.collection?.platform === 'all' ? ['alibaba','jd'] : [task.collection?.platform].filter(Boolean));
  return platforms.map((item) => item === 'alibaba' ? '\u963f\u91cc' : item === 'jd' ? '\u4eac\u4e1c' : item).join('+') || '\u672a\u77e5\u5e73\u53f0';
};
const historyCityLabel = (task) => (task.collection?.scope?.cities || task.scope?.cities || []).join('/') || '\u5168\u7701';
renderTaskDetail = async (task) => {
  selectedHistoryTask = task;
  const workbook = workbookFileName(task.workbookPath || task.paths?.workbook);
  $('taskHistoryDetail').innerHTML = `<h3>${escapeHtml(task.runName || task.dateKey || '\u672a\u547d\u540d\u6279\u6b21')}</h3><p><b>\u91c7\u96c6\u8303\u56f4\uff1a</b>${escapeHtml(scopeLabel(task))}</p><p><b>\u5e73\u53f0 / \u57ce\u5e02\uff1a</b>${escapeHtml(`${historyPlatformLabel(task)} / ${historyCityLabel(task)}`)}</p><p><b>\u72b6\u6001\uff1a</b>${escapeHtml(task.status || '-')}</p><p><b>taskId\uff1a</b><code>${escapeHtml(task.taskId)}</code></p><p><b>batchId\uff1a</b><code>${escapeHtml(task.batchId)}</code></p><p><b>\u5de5\u4f5c\u7c3f\uff1a</b>${escapeHtml(workbook || '-')}</p><p class="hint">${escapeHtml(task.statusMessage || '')}</p><button id="openHistoryFolder" class="secondary">\u6253\u5f00\u8be5\u6279\u6b21\u4fdd\u5b58\u6587\u4ef6\u5939</button>`;
  $('openHistoryFolder').onclick = () => action(() => api('/api/task/open-folder', { method:'POST', body:JSON.stringify({ taskId:task.taskId, batchId:task.batchId }) }));
};
refreshTaskHistory = async () => {
  let tasks = [];
  try { ({ tasks = [] } = await api('/api/tasks')); }
  catch (error) {
    const legacyBackend = /ENOENT|public[\\/]api[\\/]tasks|HTTP\s+(404|500)/iu.test(String(error?.message || error));
    if (!legacyBackend) throw error;
    $('taskHistoryList').innerHTML = '<p class="hint">\u5f53\u524d\u8fd0\u884c\u7684\u662f\u65e7\u7248Agent\u540e\u7aef\u3002\u8bf7\u5173\u95ed\u65e7\u670d\u52a1\u540e\u91cd\u65b0\u542f\u52a8\u3002</p>';
    return;
  }
  $('taskHistoryList').innerHTML = tasks.length ? tasks.map((task) => `<button class="task-history-item" data-task-id="${escapeHtml(task.taskId)}"><b>${escapeHtml(formatHistoryTime(task))}</b><span>${escapeHtml(`${scopeLabel(task)} \u00b7 ${historyPlatformLabel(task)} \u00b7 ${historyCityLabel(task)}`)}</span><small>${Number(task.progressSummary?.processed ?? task.count ?? 0)}\u6761 \u00b7 ${escapeHtml(task.status || '-')}</small></button>`).join('') : '<p class="hint">\u65b0\u7248\u4efb\u52a1\u5c1a\u672a\u4ea7\u751f\u5386\u53f2\u8bb0\u5f55\u3002</p>';
  document.querySelectorAll('.task-history-item').forEach((button) => button.onclick = () => action(async () => { const { task } = await api(`/api/task?taskId=${encodeURIComponent(button.dataset.taskId)}`); await renderTaskDetail(task); }));
  if (selectedHistoryTask) { const updated = tasks.find((task) => task.taskId === selectedHistoryTask.taskId); if (updated) await renderTaskDetail(updated); }
};

const platformModeForUi = (platforms) => {
  if (platforms.includes('alibaba_pc') && platforms.includes('alibaba')) throw new Error('阿里资产（PC端）与阿里资产不能同时选择');
  if (platforms.includes('jd_pc') && platforms.includes('jd')) throw new Error('\u4eac\u4e1c\u62cd\u5356\uff08PC\u7aef\uff09\u4e0e\u4eac\u4e1c\u62cd\u5356\u4e0d\u80fd\u540c\u65f6\u9009\u62e9');
  if (platforms.length > 2) throw new Error('\u6bcf\u4e2a\u5e73\u53f0\u7cfb\u5217\u53ea\u80fd\u9009\u62e9\u4e00\u4e2a\u91c7\u96c6\u6a21\u5f0f');
  if (platforms.includes('alibaba') && platforms.includes('jd_pc')) return 'alibaba_jd_pc';
  if (platforms.includes('alibaba_pc') && platforms.includes('jd_pc')) return 'alibaba_pc_jd_pc';
  if (platforms.length === 2 && platforms.includes('jd')) return platforms.includes('alibaba_pc') ? 'alibaba_pc_all' : 'all';
  return platforms[0] || '';
};
const provinceHighWaterHint = $('showProvinceHighWater').closest('div').querySelector('p.hint');
if (provinceHighWaterHint) provinceHighWaterHint.textContent = '按当前所选平台、状态和物业范围显示全省高水位；阿里资产（PC端）与原阿里资产分别保存。';
const alibabaPcCategoryScope = (categories) => `${[...new Set(categories)].sort().join('+')}@${$('includeAlibabaPcBankruptcy').checked ? 'with_bankruptcy' : 'without_bankruptcy'}`;
const jdPcCategoryScope = (categories) => [...new Set(categories)].sort().join('+');
function updateAlibabaPcControls(changed = null) {
  const pc = document.querySelector('input[name="scopePlatform"][value="alibaba_pc"]');
  const legacy = document.querySelector('input[name="scopePlatform"][value="alibaba"]');
  const jdPc = document.querySelector('input[name="scopePlatform"][value="jd_pc"]');
  const jdLegacy = document.querySelector('input[name="scopePlatform"][value="jd"]');
  if (changed === pc && pc.checked) legacy.checked = false;
  if (changed === legacy && legacy.checked) pc.checked = false;
  if (changed === jdPc && jdPc.checked) jdLegacy.checked = false;
  if (changed === jdLegacy && jdLegacy.checked) jdPc.checked = false;
  $('alibabaPcOptions').hidden = !pc.checked;
}
scopeDescriptor = () => ({
  province: $('scopeProvince').value,
  cities: selectedValues($('scopeCities')),
  platforms: checkedValues('scopePlatform'),
  categories: checkedValues('scopeCategory'),
  selectedStatuses: selectedStatuses(),
  includeBankruptcy: $('includeAlibabaPcBankruptcy').checked,
});
anchorRows = () => {
  const platforms = checkedValues('scopePlatform');
  const categories = checkedValues('scopeCategory');
  const cities = selectedValues($('scopeCities'));
  const rows = [];
  for (const platform of platforms) {
    const combinedCategories = platform === 'alibaba_pc' ? alibabaPcCategoryScope(categories) : platform === 'jd_pc' ? jdPcCategoryScope(categories) : null;
    const groupCategories = combinedCategories ? [combinedCategories] : categories;
    for (const category of groupCategories) for (const city of cities) for (const status of selectedStatuses()) {
      rows.push({ key:`${platform}:${category}:${status}:${city}`, platform, category:combinedCategories ? categories.join('、') : category, city, status });
    }
  }
  return rows;
};
scopePayload = () => {
  const mode = $('scopeMode').value;
  const anchors = {};
  document.querySelectorAll('.scope-anchor').forEach((input) => { anchors[input.dataset.key] = input.value.trim(); });
  return {
    mode,
    province: $('scopeProvince').value,
    cities: mode === 'custom' ? selectedValues($('scopeCities')) : [],
    platforms: checkedValues('scopePlatform'),
    selectedStatuses: selectedStatuses(),
    includeBankruptcy: $('includeAlibabaPcBankruptcy').checked,
    anchors: mode === 'custom' ? anchors : {},
    anchorsConsumed: false,
  };
};
saveSelectedScope = async () => {
  const scope = scopePayload();
  if (!scope.selectedStatuses.length) throw new Error('请至少选择一个采集状态');
  const categories = scope.mode === 'custom' ? checkedValues('scopeCategory') : ['住宅用房','商业用房','工业用房'];
  if (!scope.platforms.length || !categories.length || (scope.mode === 'custom' && !scope.cities.length)) {
    throw new Error('请至少选择一个平台、标的类别；小范围采集还必须选择城市');
  }
  const current = await api('/api/config');
  await api('/api/config', { method:'POST', body:JSON.stringify({
    ...current,
    collection: {
      ...current.collection,
      platform: platformModeForUi(scope.platforms),
      category: categories.join(','),
      selectedStatuses: scope.selectedStatuses,
      status: scope.selectedStatuses.join(','),
      alibabaPc: { ...current.collection?.alibabaPc, includeBankruptcy: scope.includeBankruptcy },
      scope,
    },
  }) });
};
const loadConfigWithAlibabaPc = loadConfig;
const renderAnchorEditorWithAlibabaPc = renderAnchorEditor;
renderAnchorEditor = (...args) => {
  renderAnchorEditorWithAlibabaPc(...args);
  const pcPlatformLabels = { alibaba_pc:'阿里资产（PC端）', jd_pc:'京东拍卖（PC端）' };
  document.querySelectorAll('.scope-anchor').forEach((input) => {
    const label = pcPlatformLabels[input.dataset.key.split(':', 1)[0]];
    if (!label) return;
    const textNode = [...input.closest('label').childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.nodeValue = textNode.nodeValue.replace(/^[^/]+/u, label);
  });
  const bulkInput = $('bulkAnchorText');
  if (bulkInput) {
    const selected = checkedValues('scopePlatform');
    const selectedCategoryExample = checkedValues('scopeCategory').join('+') || '\u8bf7\u9009\u62e9\u6807\u7684\u7c7b\u522b';
    const examples = [];
    if (selected.includes('alibaba_pc')) examples.push(`\u963f\u91cc\u8d44\u4ea7\uff08PC\u7aef\uff09:\u798f\u5dde\u5e02:${selectedCategoryExample}:\u5373\u5c06\u5f00\u59cb = https://sf-item.taobao.com/sf_item/...`);
    if (selected.includes('jd_pc')) examples.push(`\u4eac\u4e1c\u62cd\u5356\uff08PC\u7aef\uff09:\u798f\u5dde\u5e02:${selectedCategoryExample}:\u5373\u5c06\u5f00\u59cb = https://paimai.jd.com/...`);
    if (examples.length) bulkInput.placeholder = examples.join('\n');
    const bulkResult = $('bulkAnchorResult');
    if (examples.length && bulkResult) bulkResult.textContent = '\u0050\u0043\u7aef\u6bcf\u5ea7\u57ce\u5e02\u3001\u6bcf\u4e2a\u6240\u9009\u72b6\u6001\u53ea\u9700\u4e00\u6761\u9ad8\u6c34\u4f4d\uff1b\u7c7b\u522b\u7ec4\u5408\u5fc5\u987b\u4e0e\u5f53\u524d\u52fe\u9009\u8303\u56f4\u4e00\u81f4\u3002';
  }
  const importer = $('importBulkAnchors');
  if (importer && checkedValues('scopePlatform').some((platform) => ['alibaba_pc','jd_pc'].includes(platform))) {
    importer.onclick = () => action(async () => {
      const parsed = parseBulkHighWater($('bulkAnchorText').value, { includeBankruptcy:$('includeAlibabaPcBankruptcy').checked });
      if (!parsed.rows.length) throw new Error(parsed.errors[0]?.reason || '没有识别到可保存的PC端高水位');
      const validKeys = new Set(anchorRows().map((row) => row.key));
      const outside = parsed.rows.filter((row) => !validKeys.has(row.key));
      if (outside.length) throw new Error('粘贴内容与当前城市、状态、物业类型组合或破产资产选项不一致');
      Object.assign(anchorDraft, parsed.anchors);
      persistAnchorDraft();
      const profile = await api('/api/high-water/custom-save', { method:'POST', body:JSON.stringify({ ...scopeDescriptor(), anchors:parsed.anchors }) });
      Object.assign(anchorSaved, parsed.anchors);
      anchorEditorExpanded = true;
      renderAnchorEditor(profile.anchors || {});
      const ignored = parsed.errors.length ? `；${parsed.errors.length} 行未识别` : '';
      alert(`已识别并保存 ${Object.keys(parsed.anchors).length} 条PC端高水位${ignored}`);
    });
  }
};
loadConfig = async () => {
  await loadConfigWithAlibabaPc();
  const config = await api('/api/config');
  $('includeAlibabaPcBankruptcy').checked = config.collection?.alibabaPc?.includeBankruptcy !== false;
  updateAlibabaPcControls();
  captureScopeSelection();
};
document.querySelectorAll('input[name="scopePlatform"]').forEach((input) => {
  input.onchange = () => action(async () => { updateAlibabaPcControls(input); await scopeSelectionChanged(); });
});
$('includeAlibabaPcBankruptcy').onchange = () => action(() => scopeSelectionChanged());
const historyPlatformLabelWithPc = historyPlatformLabel;
historyPlatformLabel = (task) => {
  const platforms = task.collection?.scope?.platforms || [];
  if (!platforms.some((item) => ['alibaba_pc','jd_pc'].includes(item))) return historyPlatformLabelWithPc(task);
  return platforms.map((item) => item === 'alibaba_pc' ? '阿里资产（PC端）' : item === 'jd_pc' ? '京东拍卖（PC端）' : item === 'jd' ? '京东' : '阿里').join('+');
};

const developerPanel = document.createElement('section');
developerPanel.className = 'card';
developerPanel.id = 'developerDeliveryPanel';
developerPanel.hidden = true;
developerPanel.innerHTML = `<h2>开发者交付工具</h2><p class="hint">仅限开发版使用。生成过程复制到新目录，不会清理当前Agent、Edge Profile、高水位或历史结果。</p><p id="developerDeliveryStatus" class="hint">正在检查权限……</p><div class="grid"><label>开发者密码<input id="developerPassword" type="password" autocomplete="current-password"></label><label>交付版目标目录<input id="deliveryTarget" placeholder="例如：D:\\交付\\法拍资产Agent-交付版V2.0"></label></div><div class="actions"><button id="unlockDeveloper" class="secondary">验证并临时解锁</button><button id="generateDelivery" disabled>生成干净交付版</button></div><pre id="deliveryResult" class="output-box" hidden></pre>`;
cachePanel.after(developerPanel);

async function refreshDeveloperTools() {
  const status = await api('/api/developer/status');
  developerPanel.hidden = !status.developer;
  if (!status.developer) return;
  $('developerDeliveryStatus').textContent = !status.configured ? '尚未设置开发者密码，请先在终端运行 developer-password set。' : status.unlocked ? '已临时解锁，15分钟后自动锁定。' : '已锁定。';
  $('generateDelivery').disabled = !status.unlocked;
}
$('unlockDeveloper').onclick = () => action(async () => {
  const password = $('developerPassword').value;
  if (!password) throw new Error('请输入开发者密码');
  await api('/api/developer/unlock', { method:'POST', body:JSON.stringify({ password }) });
  $('developerPassword').value = '';
  await refreshDeveloperTools();
});
$('generateDelivery').onclick = () => action(async () => {
  const targetDirectory = $('deliveryTarget').value.trim();
  if (!targetDirectory) throw new Error('请填写新的交付目标目录');
  if (!confirm(`将在以下新目录生成交付版，不会修改当前开发版：\n${targetDirectory}\n\n是否继续？`)) return;
  $('generateDelivery').disabled = true;
  const result = await api('/api/developer/generate-delivery', { method:'POST', body:JSON.stringify({ targetDirectory }) });
  $('deliveryResult').hidden = false;
  $('deliveryResult').textContent = `结论：${result.deliverable ? '已生成，等待首次启动验证' : '禁止交付'}\n目标：${result.targetRoot}\n敏感项：${result.inspection?.findings?.length || 0}`;
  await refreshDeveloperTools();
});

const onboardingPanel = document.createElement('section');
onboardingPanel.className = 'card setup-panel';
onboardingPanel.id = 'onboardingPanel';
onboardingPanel.innerHTML = `<button id="onboardingToggle" class="setup-toggle" type="button" aria-expanded="false" aria-controls="onboardingContent"><span><strong>首次运行与基础配置</strong><small id="onboardingStatusLabel">基础配置已完成</small></span><span id="onboardingSummary" class="setup-summary"></span><span id="onboardingToggleIcon" class="setup-toggle-icon" aria-hidden="true">⌄</span></button><div id="onboardingContent" class="setup-panel-content" hidden><section class="setup-step"><div class="setup-step-heading"><span class="setup-step-number">1</span><div><h3>数据保存与运行目录</h3><p>普通用户通常只需要确认数据保存目录；高级目录一般不建议修改。</p></div></div><div id="setupOutputDirectory" class="setup-output-directory"></div><details id="advancedDirectorySettings" class="advanced-directory-settings"><summary>高级目录设置</summary><p class="hint">仅在部署调整时修改，系统不会自动删除或重置目录。</p><div id="advancedDirectoryFields"></div></details></section><section class="setup-step" id="platformLoginStep"><div class="setup-step-heading"><span class="setup-step-number">2</span><div><h3>平台登录准备</h3><p>打开登录准备后，在浏览器中完成登录、滑块或安全验证。</p></div></div><div id="platformReadinessCards" class="platform-readiness-grid"></div><pre id="onboardingChecks" class="output-box onboarding-checks" hidden></pre><div class="actions setup-complete-action"><button id="completeOnboarding">完成首次运行准备</button></div><p id="onboardingHint" class="hint"></p></section><section class="setup-step"><div class="setup-step-heading"><span class="setup-step-number">3</span><div><h3>AI复核配置 <small>（可选）</small></h3><p>如果选择工作台复核或暂不复核，可以暂时不填写API配置。</p></div></div><div id="setupReviewMode"></div><div id="setupApiConfig"></div></section><div id="setupSaveAction" class="actions setup-save-action"></div></div>`;
document.querySelector('section.status')?.before(onboardingPanel);

const configPanel = $('skillV2Dir')?.closest('section');
const outputDirectory = $('outputDir')?.closest('label');
const advancedDirectoryFields = $('advancedDirectoryFields');
if (outputDirectory) $('setupOutputDirectory').append(outputDirectory);
['skillV2Dir', 'stateDir', 'agentDataDir'].forEach((id) => {
  const field = $(id)?.closest('label');
  if (field) advancedDirectoryFields.append(field);
});
if ($('apiConfig')) $('setupApiConfig').append($('apiConfig'));
if ($('save')) {
  const directorySaveAction = document.createElement('div');
  directorySaveAction.className = 'actions setup-directory-save';
  $('save').textContent = '保存基础配置';
  directorySaveAction.append($('save'));
  const saveHint = document.createElement('span');
  saveHint.className = 'hint';
  saveHint.textContent = '保存运行目录及可选API服务参数；API Key请使用下方的“保存API Key”。';
  directorySaveAction.append(saveHint);
  $('advancedDirectorySettings')?.after(directorySaveAction);
}
$('setupSaveAction')?.remove();
configPanel?.remove();
$('setupReviewMode')?.remove();
const apiSetupStep = $('setupApiConfig')?.closest('.setup-step');
if (apiSetupStep) {
  apiSetupStep.querySelector('.setup-step-number').textContent = '2';
  apiSetupStep.querySelector('h3').textContent = 'API复核能力配置（可选）';
  apiSetupStep.querySelector('.setup-step-heading p').textContent = '此处只用于配置API复核所需的服务商、模型和API Key，不代表当前批次已经选择API复核。未配置API Key也不影响采集，可继续使用工作台复核或暂不复核。';
  const apiContent = document.createElement('div');
  apiContent.id = 'apiSetupContent';
  apiContent.hidden = true;
  apiContent.append($('setupApiConfig'));
  const apiToggle = document.createElement('button');
  apiToggle.id = 'apiSetupToggle';
  apiToggle.type = 'button';
  apiToggle.className = 'secondary api-setup-toggle';
  apiToggle.setAttribute('aria-expanded', 'false');
  apiToggle.setAttribute('aria-controls', 'apiSetupContent');
  apiToggle.textContent = '展开API配置';
  apiToggle.onclick = () => {
    const expanded = apiContent.hidden;
    apiContent.hidden = !expanded;
    apiToggle.setAttribute('aria-expanded', String(expanded));
    apiToggle.textContent = expanded ? '收起API配置' : '展开API配置';
  };
  apiSetupStep.querySelector('.setup-step-heading > div').append(apiToggle);
  apiSetupStep.append(apiContent);
  $('platformLoginStep')?.before(apiSetupStep);
  const platformStepNumber = $('platformLoginStep')?.querySelector('.setup-step-number');
  if (platformStepNumber) platformStepNumber.textContent = '3';
}

const onboardingPanelStorageKey = 'auction-agent-onboarding-panel-open-v1';
let incompletePanelTemporarilyCollapsed = false;
let lastOnboardingWasComplete = null;

function compactDirectory(value) {
  const parts = String(value || '').replace(/[\\/]+/g, '/').split('/').filter(Boolean);
  return parts.slice(-2).join(' / ') || '未设置';
}

function setOnboardingPanelExpanded(expanded, { persist = false } = {}) {
  $('onboardingContent').hidden = !expanded;
  $('onboardingToggle').setAttribute('aria-expanded', String(expanded));
  $('onboardingToggleIcon').textContent = expanded ? '⌃' : '⌄';
  if (persist) localStorage.setItem(onboardingPanelStorageKey, expanded ? 'open' : 'closed');
}

function updateSetupSummary(readiness = {}) {
  const output = $('outputDir')?.value || '';
  const alibaba = readiness.platformReadiness?.alibaba?.ready === true ? '已就绪' : '未就绪';
  const jd = readiness.platformReadiness?.jd?.ready === true ? '已就绪' : '未就绪';
  const outputSummary = compactDirectory(output);
  const apiStatus = apiCredentialConfigured ? '已配置' : '未配置（可选）';
  $('onboardingSummary').innerHTML = `<span title="${escapeHtml(output)}">数据保存目录：${escapeHtml(outputSummary)}</span><span>阿里资产：${alibaba}</span><span>京东拍卖：${jd}</span><span>API复核：${apiStatus}</span>`;
}

function renderPlatformReadiness(onboarding = {}) {
  const cards = $('platformReadinessCards');
  const running = new Set(onboarding.loginChecksRunning || []);
  const platforms = [
    { key: 'alibaba', label: '阿里资产', buttonId: 'prepareAlibabaLogin', buttonText: '打开阿里登录准备' },
    { key: 'jd', label: '京东拍卖', buttonId: 'prepareJdLogin', buttonText: '打开京东登录准备' },
  ];
  cards.innerHTML = platforms.map(({ key, label, buttonId, buttonText }) => {
    const readiness = onboarding.platformReadiness?.[key] || {};
    const checking = running.has(key);
    const ready = readiness.ready === true;
    const state = checking ? '正在检查' : ready ? '已登录/已就绪' : readiness.message ? '需要登录或验证' : '未检查';
    const message = checking ? '正在等待登录检查完成。' : readiness.message || (ready ? '登录准备已通过。' : '请先打开登录准备并完成验证。');
    const tone = checking ? 'checking' : ready ? 'ready' : readiness.message ? 'attention' : 'pending';
    return `<article class="platform-readiness-card ${tone}"><div><h4>${label}</h4><strong>${state}</strong><p>${escapeHtml(message)}</p></div><button id="${buttonId}" class="secondary" type="button">${buttonText}</button></article>`;
  }).join('');
}

function onboardingCanComplete(onboarding = {}) {
  const directoriesReady = Object.values(onboarding.checks || {}).every(Boolean);
  const requiredFamilies = new Set(checkedValues('scopePlatform').map((platform) => platform.startsWith('alibaba') ? 'alibaba' : 'jd'));
  const platformsReady = [...requiredFamilies].every((key) => onboarding.platformReadiness?.[key]?.ready === true);
  return directoriesReady && platformsReady && !(onboarding.loginChecksRunning || []).length;
}

$('onboardingToggle').onclick = () => {
  const expanded = $('onboardingContent').hidden;
  if (lastOnboardingWasComplete === false) {
    incompletePanelTemporarilyCollapsed = !expanded;
    setOnboardingPanelExpanded(expanded);
  } else {
    setOnboardingPanelExpanded(expanded, { persist: true });
  }
};

['outputDir'].forEach((id) => $(id)?.addEventListener('input', () => updateSetupSummary()));

function openApiConfiguration() {
  setOnboardingPanelExpanded(true, { persist: lastOnboardingWasComplete === true });
  $('advancedDirectorySettings')?.removeAttribute('open');
  if ($('apiSetupContent')?.hidden) $('apiSetupToggle')?.click();
  apiSetupStep?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  requestAnimationFrame(() => $('apiKey')?.focus());
}

async function refreshOnboarding() {
  const status = await api('/api/status');
  const delivery = status.distribution?.mode === 'delivery';
  const onboarding = delivery ? await api('/api/onboarding') : { completed: true, platformReadiness: {} };
  const completed = onboarding.completed === true;
  const missingCount = delivery ? Object.values(onboarding.checks || {}).filter((value) => !value).length
    + ['alibaba', 'jd'].filter((key) => onboarding.platformReadiness?.[key]?.ready !== true).length : 0;
  const becameIncomplete = lastOnboardingWasComplete !== false && !completed;
  lastOnboardingWasComplete = completed;
  onboardingPanel.classList.toggle('is-incomplete', !completed);
  $('onboardingStatusLabel').textContent = completed ? '基础配置已完成' : `尚有${missingCount}项未完成`;

  if (delivery) {
    $('platformLoginStep').hidden = false;
    const lines = Object.entries(onboarding.checks || {}).map(([key, value]) => `${value ? '✓' : '✗'} ${key}`);
    for (const [platform, value] of Object.entries(onboarding.platformReadiness || {})) lines.push(`${value.ready ? '✓' : '✗'} ${platform}：${value.message || ''}`);
    $('onboardingChecks').textContent = lines.join('\n');
    $('onboardingHint').textContent = onboarding.loginChecksRunning?.length ? `正在等待登录检查：${onboarding.loginChecksRunning.join('、')}` : '登录窗口关闭且检查通过后，状态会自动更新。';
    renderPlatformReadiness(onboarding);
    $('completeOnboarding').disabled = !onboardingCanComplete(onboarding);
    if (!completed) $('start').disabled = true;
  } else {
    renderPlatformReadiness(onboarding);
    $('platformLoginStep').hidden = true;
  }

  updateSetupSummary(onboarding);
  if (!completed) {
    if (becameIncomplete) incompletePanelTemporarilyCollapsed = false;
    setOnboardingPanelExpanded(!incompletePanelTemporarilyCollapsed);
  } else if (lastOnboardingWasComplete === true) {
    const saved = localStorage.getItem(onboardingPanelStorageKey);
    setOnboardingPanelExpanded(saved === 'open');
  }
}
onboardingPanel.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.id === 'prepareAlibabaLogin') action(async () => { await api('/api/onboarding/login', { method:'POST', body:JSON.stringify({ platform:'alibaba' }) }); await refreshOnboarding(); });
  if (button.id === 'prepareJdLogin') action(async () => { await api('/api/onboarding/login', { method:'POST', body:JSON.stringify({ platform:'jd' }) }); await refreshOnboarding(); });
  if (button.id === 'completeOnboarding') action(async () => { await api('/api/onboarding/complete', { method:'POST', body:'{}' }); await refreshOnboarding(); alert('首次运行准备已完成。'); });
});

await action(async () => { await loadConfig(); await refreshStatus(); await refreshTaskHistory(); await refreshDeveloperTools(); await refreshOnboarding(); });
setInterval(() => quietRefresh(refreshStatus), 5000);
setInterval(() => quietRefresh(refreshTaskHistory), 15000);
setInterval(() => quietRefresh(refreshOnboarding), 5000);
