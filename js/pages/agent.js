import { localApi } from '../api.js';
import { LS } from '../state.js';
import { esc } from '../utils.js';
import { toast } from '../components.js';
import { initIcons } from '../icons.js';
import { gotoPage } from '../navigation.js';
import { clearHotPlatforms } from './hotlist.js';

let skillCache = [];
let agentCache = [];
let agentMessages = [];
let agentThreads = [];
let currentAgentThreadId = null;
let currentAgentId = null;
let skillUpdateStatus = null;
const agentRuntimeErrors = new Map();
let streamingAbort = null;

export function clearSkillCache() {
  skillCache = [];
}

export async function loadSkills(force = false) {
  if (force) skillCache = [];
  if (!skillCache.length) skillCache = await localApi('skills');
  const navCount = document.getElementById('nav-skill-count');
  if (navCount) navCount.textContent = skillCache.length;
  return skillCache;
}

// ============ Skills 页面渲染 ============

export async function renderSkills() {
  try {
    const skills = await loadSkills();
    const localCountEl = document.getElementById('skill-local-count');
    if (localCountEl) localCountEl.textContent = `${skills.length} 个已下载`;
    const categoryEl = document.getElementById('skillCategory');
    if (categoryEl) {
      categoryEl.innerHTML = [
        '<option value="all">全部分类</option>',
        '<option value="热点">热点</option>',
        '<option value="创作">创作</option>',
        '<option value="分析">分析</option>',
        '<option value="检索">检索</option>',
        '<option value="生成工具">生成工具</option>',
      ].join('');
    }
    filterSkills();
    checkSkillUpdates(false);
  } catch (e) {
    const grid = document.getElementById('skill-grid');
    if (grid) grid.innerHTML = `<div class="text-red-400 text-sm">${esc(e.message)}</div>`;
  }
}

export function filterSkills() {
  const grid = document.getElementById('skill-grid');
  if (!grid) return;
  const keyword = document.getElementById('skillSearch')?.value.trim().toLowerCase() || '';
  const category = document.getElementById('skillCategory')?.value || 'all';
  const filtered = skillCache.filter(skill => {
    const cat = skill.llmCategory || skill.category || '其他';
    const matchesCategory = category === 'all' || cat === category || skill.category === category;
    return matchesCategory && (!keyword || `${skill.title} ${skill.name} ${skill.description}`.toLowerCase().includes(keyword));
  });
  grid.innerHTML = filtered.map(skill => {
    const cat = skill.llmCategory || skill.category || '其他';
    const catColor = { '热点': 'pill-hot', '创作': 'pill-brand', '分析': 'pill-sky', '检索': 'pill-green', '生成工具': 'pill-amber' }[cat] || 'pill-gray';
    const bindable = skill.sourceBinding;
    const bindBtn = bindable
      ? `<button class="btn ${skill.cronEnabled ? 'btn-ghost' : 'btn-primary'} py-1 text-[11px] flex-shrink-0" data-action="bindSkillToSource" data-slug="${esc(skill.slug)}" data-stop-propagation title="${skill.cronEnabled ? '已在热榜中' : '启用对应的定时任务'}">
          <i data-lucide="${skill.cronEnabled ? 'check' : 'plus'}" class="w-3 h-3"></i>${skill.cronEnabled ? '已绑定' : '绑定热榜'}
        </button>`
      : '';
    return `
    <div class="glass rounded-xl p-4 card flex flex-col relative" data-action="openSkillDetail" data-slug="${skill.slug}">
      ${skill.isNew ? '<span class="absolute -top-2 -right-2 pill pill-green shadow-lg">New</span>' : ''}
      <div class="flex items-start justify-between gap-3">
        <div class="font-semibold text-sm">${esc(skill.title)}</div>
        <span class="pill ${catColor} !text-[10px]">${esc(cat)}</span>
      </div>
      <p class="text-xs text-gray-500 mt-2 line-clamp-2 flex-1">${esc(skill.description || '暂无描述')}</p>
      <div class="flex items-center justify-between mt-4 gap-2">
        <code class="text-[10px] text-gray-600 truncate flex-1">${esc(skill.slug)}</code>
        ${bindBtn}
        <button class="btn btn-ghost py-1 text-[11px] flex-shrink-0" data-action="openAgentWithSkill" data-slug="${skill.slug}"><i data-lucide="bot" class="w-3 h-3"></i>Agent</button>
      </div>
    </div>`;
  }).join('') || '<div class="text-sm text-gray-500">没有匹配的 Skill</div>';
  initIcons(document.getElementById('content-area'));
}

export async function bindSkillToSource(el, d) {
  if (!d?.slug) return;
  try {
    const result = await localApi(`skills/${encodeURIComponent(d.slug)}/bind-source`, { method: 'POST' });
    const action = result.enabled ? '绑定' : '解绑';
    toast(`${d.slug} 已${action}热榜（${result.cronId}）`, 'success');
    clearHotPlatforms();
    await loadSkills(true);
    filterSkills();
  } catch (e) { toast(e.message, 'error'); }
}

export async function classifySkills() {
  if (!confirm('将调用 LLM 给所有 skill 自动分类（耗时约 30-90 秒），确认开始？')) return;
  toast('正在用 LLM 分类所有 skill…', 'info');
  try {
    const result = await localApi('skills/classify', { method: 'POST' });
    toast(`分类完成：${result.done}/${result.total} 成功${result.failed ? `，失败 ${result.failed}` : ''}`, 'success');
    await loadSkills(true);
    filterSkills();
  } catch (e) { toast(e.message, 'error'); }
}

function renderSkillUpdateStatus() {
  const host = document.getElementById('skill-update-status');
  const button = document.getElementById('skill-update-button');
  if (!host || !button) return;
  if (!skillUpdateStatus) {
    host.textContent = '尚未检查更新';
    button.classList.add('hidden');
    return;
  }
  if (skillUpdateStatus.available) {
    host.textContent = `发现更新：新增 ${skillUpdateStatus.added.length}、修改 ${skillUpdateStatus.changed.length}、删除 ${skillUpdateStatus.removed.length}`;
    host.className = 'text-[11px] text-amber-300';
    button.classList.remove('hidden');
  } else {
    host.textContent = '已是最新版本';
    host.className = 'text-[11px] text-emerald-300';
    button.classList.add('hidden');
  }
  initIcons(document.getElementById('content-area'));
}

export async function checkSkillUpdates(showToast = true) {
  const host = document.getElementById('skill-update-status');
  if (host) {
    host.textContent = '正在检查 GitHub 更新…';
    host.className = 'text-[11px] text-gray-500';
  }
  try {
    skillUpdateStatus = await localApi('skills/status');
    renderSkillUpdateStatus();
    if (showToast) toast(skillUpdateStatus.available ? '发现 Skill 更新' : 'Skill 已是最新版本', 'success');
    return skillUpdateStatus;
  } catch (e) {
    if (host) {
      host.textContent = '更新检查失败';
      host.className = 'text-[11px] text-red-400';
    }
    if (showToast) toast(e.message, 'error');
    return null;
  }
}

export async function updateCommunitySkillsUi() {
  const button = document.getElementById('skill-update-button');
  const statusEl = document.getElementById('skill-update-status');
  const grid = document.getElementById('skill-grid');

  const setStatus = (text, cls = 'text-[11px] text-gray-500') => {
    if (statusEl) { statusEl.textContent = text; statusEl.className = cls; }
  };
  const setButton = (text, disabled) => {
    if (!button) return;
    button.disabled = disabled;
    button.innerHTML = text;
    initIcons(button);
  };

  setButton('<i data-lucide="loader-circle" class="w-3.5 h-3.5 animate-spin"></i>检查更新…', true);
  setStatus('正在检查更新…');
  try {
    const status = await localApi('skills/status');
    if (!status.available) {
      setStatus('已是最新版本', 'text-[11px] text-emerald-300');
      setButton('<i data-lucide="download" class="w-3.5 h-3.5"></i>一键更新', false);
      button?.classList.add('hidden');
      toast('Skill 已是最新版本', 'success');
      return;
    }

    setButton('<i data-lucide="loader-circle" class="w-3.5 h-3.5 animate-spin"></i>下载中…', true);
    setStatus(`正在下载更新 (新增 ${status.added.length}、修改 ${status.changed.length})…`);

    const result = await localApi('skills/update', { method: 'POST', body: {} });
    skillUpdateStatus = { ...result, available: false };

    setButton('<i data-lucide="loader-circle" class="w-3.5 h-3.5 animate-spin"></i>刷新列表…', true);
    setStatus('正在刷新 Skill 列表…');
    if (grid) grid.innerHTML = '<div class="col-span-full text-sm text-gray-500 py-8 text-center"><i data-lucide="loader-circle" class="w-4 h-4 animate-spin inline-block mr-2"></i>加载中…</div>';
    initIcons(grid);

    await loadSkills(true);
    const localCountEl = document.getElementById('skill-local-count');
    if (localCountEl) localCountEl.textContent = `${skillCache.length} 个已下载`;
    filterSkills();
    renderSkillUpdateStatus();

    const addedCount = result.addedSlugs?.length || 0;
    toast(addedCount ? `Skill 更新完成，新增 ${addedCount} 个` : 'Skill 已是最新版本', 'success');
  } catch (e) {
    setStatus('更新失败', 'text-[11px] text-red-400');
    setButton('<i data-lucide="download" class="w-3.5 h-3.5"></i>一键更新', false);
    toast(e.message, 'error');
  }
}

export async function openSkillDetail(slug) {
  try {
    const skill = await localApi(`skills/${encodeURIComponent(slug)}`);
    const modal = document.createElement('div');
    modal.className = 'modal-mask';
    modal.innerHTML = `<div class="modal" style="max-width:760px;max-height:85vh;overflow-y:auto" data-action="stopPropagation">
      <div class="flex items-start justify-between mb-4">
        <div><h3 class="font-semibold">${esc(skill.title)}</h3><div class="text-[11px] text-gray-500 mt-1">${esc(skill.path)}</div></div>
        <button class="btn btn-ghost py-1 px-2" data-action="closeModal"><i data-lucide="x" class="w-4 h-4"></i></button>
      </div>
      <p class="text-sm text-gray-400 mb-4">${esc(skill.description)}</p>
      <pre class="text-xs text-gray-400 whitespace-pre-wrap bg-black/20 rounded-lg p-4 overflow-x-auto">${esc(skill.content.slice(0, 30000))}</pre>
      <button class="btn btn-primary mt-4" data-action="closeModalAndOpenAgentWithSkill" data-slug="${skill.slug}"><i data-lucide="bot" class="w-4 h-4"></i>使用此 Skill 对话</button>
    </div>`;
    modal.addEventListener('click', event => {
      if (event.target === modal) modal.remove();
    });
    document.getElementById('modal-host').appendChild(modal);
    initIcons(modal);
  } catch (e) {
    toast(e.message, 'error');
  }
}

export function openAgentWithSkill(slug) {
  LS.set('agentSkillDraft', `/${slug} `);
  gotoPage('agent');
}

// ============ Agent 线程管理（后端持久化） ============

async function loadThreadsFromServer() {
  try {
    const result = await localApi('agent/threads');
    agentThreads = result || [];
  } catch (e) {
    agentThreads = [];
  }
}

export async function startNewAgentThread() {
  const agentId = document.getElementById('agentProvider')?.value || currentAgentId || 'openclaw';
  try {
    const result = await localApi('agent/threads', { method: 'POST', body: { agentId } });
    await loadThreadsFromServer();
    switchAgentThread(result.id);
  } catch (e) {
    toast(e.message, 'error');
  }
}

export async function switchAgentThread(threadId) {
  currentAgentThreadId = threadId;
  const thread = agentThreads.find(t => t.id === threadId);
  if (thread) {
    document.getElementById('agent-thread-name').textContent = thread.name || '新对话';
    if (thread.agent_id) {
      const sel = document.getElementById('agentProvider');
      if (sel) { sel.value = thread.agent_id; currentAgentId = thread.agent_id; }
    }
    // 从后端加载消息
    try {
      const msgs = await localApi(`agent/threads/${encodeURIComponent(threadId)}/messages`);
      agentMessages = msgs.map(m => ({
        role: m.role, content: m.content, timestamp: m.timestamp, id: m.id, agentName: 'LLM',
      }));
    } catch {
      agentMessages = [];
    }
  }
  renderAgentMessages();
}

export async function clearCurrentAgentThread() {
  if (!currentAgentThreadId) return;
  if (!confirm('确定清空当前对话？')) return;
  try {
    await localApi(`agent/threads/${encodeURIComponent(currentAgentThreadId)}`, { method: 'PATCH', body: { name: '新对话' } });
    agentMessages = [];
    renderAgentMessages();
  } catch (e) { toast(e.message, 'error'); }
}

export async function deleteAgentThread(threadId) {
  try {
    await localApi(`agent/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' });
    agentThreads = agentThreads.filter(t => t.id !== threadId);
    if (currentAgentThreadId === threadId) {
      const currentAgentThreads = agentThreads.filter(t => t.agent_id === currentAgentId);
      if (currentAgentThreads.length) switchAgentThread(currentAgentThreads[0].id);
      else { agentMessages = []; currentAgentThreadId = null; }
    }
    renderAgentThreads();
    renderAgentMessages();
  } catch (e) { toast(e.message, 'error'); }
}

export function renderAgentThreads() {
  const host = document.getElementById('agent-thread-list');
  if (!host) return;
  const myThreads = agentThreads.filter(t => t.agent_id === currentAgentId);
  if (!myThreads.length) {
    host.innerHTML = '<div class="text-[10px] text-gray-600 px-2">当前 Agent 无对话记录</div>';
    initIcons(host);
    return;
  }
  host.innerHTML = myThreads.map(thread => `
    <div class="group flex items-center gap-1 px-2.5 py-2 rounded-lg border cursor-pointer text-xs ${thread.id === currentAgentThreadId ? 'border-purple-500/25 bg-purple-500/10 text-white' : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-white/10 hover:bg-white/[0.04]'}" data-action="switchAgentThread" data-id="${thread.id}">
      <span class="flex-1 truncate">${esc(thread.name || '新对话')}</span>
      <button class="hidden group-hover:flex btn btn-ghost py-0 px-0.5" data-action="deleteAgentThread" data-id="${thread.id}" title="删除">
        <i data-lucide="x" class="w-3 h-3"></i>
      </button>
    </div>
  `).join('');
  initIcons(host);
}

// ============ Agent Provider ============

export function onAgentProviderChange(agentId) {
  currentAgentId = agentId;
  LS.set('agentSelected', agentId);
  const agentName = agentCache.find(a => a.id === agentId)?.name || 'Agent';
  const currentName = document.getElementById('agent-current-name');
  if (currentName) currentName.textContent = agentName;
  renderAgentProviderStatus(agentId);
  renderAgentThreads();
  const myThreads = agentThreads.filter(t => t.agent_id === agentId);
  if (myThreads.length) {
    switchAgentThread(myThreads[0].id);
  } else {
    agentMessages = [];
    currentAgentThreadId = null;
    renderAgentMessages();
  }
}

function renderAgentProviderStatus(agentId) {
  const status = document.getElementById('agent-provider-status');
  if (!status) return;
  const agent = agentCache.find(item => item.id === agentId);
  const runtimeError = agentRuntimeErrors.get(agentId);
  if (!agent) {
    status.className = 'text-[10px] text-gray-600 mt-1.5 leading-relaxed';
    status.textContent = '未选择 Agent';
    return;
  }
  if (!agent.available) {
    status.className = 'text-[10px] text-red-400 mt-1.5 leading-relaxed';
    status.textContent = agent.reason || '未配置 LLM API Key';
    return;
  }
  if (runtimeError) {
    status.className = 'text-[10px] text-amber-400 mt-1.5 leading-relaxed';
    status.textContent = runtimeError;
    return;
  }
  status.className = 'text-[10px] text-emerald-400 mt-1.5 leading-relaxed';
  status.textContent = `LLM API 已配置 · ${agent.model || 'ready'}`;
}

// ============ 消息渲染 ============

export function formatTime(ts) {
  const d = new Date(ts);
  const diffMs = Date.now() - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)} 小时前`;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function buildMessageHTML(message, index) {
  const isUser = message.role === 'user';
  const bubbleClass = isUser
    ? 'bg-purple-500/15 border-purple-500/30'
    : 'bg-white/[0.03] border-white/10';
  const alignClass = isUser ? 'items-end' : 'items-start';
  const label = isUser ? '你' : esc(message.agentName || 'LLM');
  const labelColor = isUser ? 'text-purple-400' : 'text-cyan-400';
  return `
  <div class="flex flex-col ${alignClass}">
    <div class="flex items-center gap-2 mb-1.5 ${isUser ? 'flex-row-reverse' : ''}">
      <span class="text-[10px] ${labelColor} uppercase tracking-wider">${label}</span>
      <span class="text-[9px] text-gray-600">${formatTime(message.timestamp || Date.now())}</span>
    </div>
    <div class="relative group w-full max-w-[75%]">
      <div class="border ${bubbleClass} rounded-2xl p-4 ${isUser ? 'rounded-tr-sm' : 'rounded-tl-sm'}">
        <div class="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">${esc(message.content)}</div>
      </div>
      <div class="absolute top-2 ${isUser ? 'left-2' : 'right-2'} hidden group-hover:flex gap-1">
        <button class="btn btn-ghost py-0.5 px-1 text-[10px]" data-action="copyAgentMessage" data-index="${index}" title="复制">
          <i data-lucide="copy" class="w-3 h-3"></i>
        </button>
        ${!isUser ? `
        <button class="btn btn-ghost py-0.5 px-1 text-[10px]" data-action="regenerateAgentMessage" data-index="${index}" title="重新生成">
          <i data-lucide="refresh-cw" class="w-3 h-3"></i>
        </button>
        ` : ''}
        <button class="btn btn-ghost py-0.5 px-1 text-[10px] text-red-400" data-action="deleteAgentMessage" data-index="${index}" title="删除">
          <i data-lucide="trash-2" class="w-3 h-3"></i>
        </button>
      </div>
    </div>
  </div>`;
}

export function renderAgentMessages() {
  const host = document.getElementById('agentMessages');
  if (!host) return;
  if (!agentMessages.length) {
    host.innerHTML = `<div class="h-full min-h-[240px] flex items-center justify-center text-center" data-agent-empty>
      <div class="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-8 py-7">
        <i data-lucide="message-square" class="w-9 h-9 text-gray-600 mx-auto mb-3"></i>
        <p class="text-sm text-gray-400">开始一段新对话</p>
        <p class="text-xs text-gray-600 mt-1">输入 <code class="text-purple-300">/</code> 可选择 Skill</p>
      </div>
    </div>`;
    initIcons(host);
    return;
  }
  host.innerHTML = agentMessages.map((message, index) => buildMessageHTML(message, index)).join('');
  host.scrollTop = host.scrollHeight;
  initIcons(host);
}

function appendAgentMessage(message) {
  const host = document.getElementById('agentMessages');
  if (!host) return;
  const placeholder = host.querySelector('[data-agent-empty]');
  if (placeholder) placeholder.remove();
  const index = agentMessages.length - 1;
  host.insertAdjacentHTML('beforeend', buildMessageHTML(message, index));
  const inserted = host.lastElementChild;
  initIcons(inserted);
  host.scrollTop = host.scrollHeight;
}

function updateLastAssistantMessage(content) {
  const host = document.getElementById('agentMessages');
  if (!host) return;
  const bubbles = host.querySelectorAll('.flex.flex-col.items-start');
  const lastBubble = bubbles[bubbles.length - 1];
  if (!lastBubble) return;
  const contentDiv = lastBubble.querySelector('.text-sm');
  if (contentDiv) {
    contentDiv.textContent = content;
  }
  host.scrollTop = host.scrollHeight;
}

// ============ 消息操作 ============

export async function copyAgentMessage(index) {
  const msg = agentMessages[index];
  if (!msg) return;
  try {
    await navigator.clipboard.writeText(msg.content);
    toast('已复制', 'success');
  } catch { toast('复制失败', 'error'); }
}

export async function deleteAgentMessage(index) {
  const msg = agentMessages[index];
  if (!msg) return;
  if (msg.id) {
    try {
      await localApi(`agent/messages/${msg.id}?threadId=${encodeURIComponent(currentAgentThreadId)}`, { method: 'DELETE' });
    } catch {}
  }
  agentMessages.splice(index, 1);
  renderAgentMessages();
}

export function regenerateAgentMessage(index) {
  const userMsgIdx = agentMessages.slice(0, index).reverse().findIndex(m => m.role === 'user');
  if (userMsgIdx === -1) return;
  const actualUserIdx = index - 1 - userMsgIdx;
  const userMsg = agentMessages[actualUserIdx];
  agentMessages = agentMessages.slice(0, actualUserIdx);
  renderAgentMessages();
  document.getElementById('agentInput').value = userMsg.content;
  sendAgentMessage();
}

// ============ Skill 命令 ============

export function showSkillCommands() {
  const input = document.getElementById('agentInput');
  const host = document.getElementById('agentSkillCommands');
  if (!input || !host) return;
  const match = input.value.match(/^\/([a-z0-9-]*)$/i);
  if (!match) {
    host.classList.add('hidden');
    return;
  }
  const keyword = match[1].toLowerCase();
  const matches = skillCache.filter(skill =>
    !keyword || skill.slug.includes(keyword) || skill.title.toLowerCase().includes(keyword)
  ).slice(0, 12);
  host.innerHTML = matches.map(skill => `
    <button class="w-full text-left rounded-lg px-3 py-2 hover:bg-white/[0.06]" data-action="insertSkillCommand" data-slug="${skill.slug}">
      <div class="text-xs text-purple-300">/${esc(skill.slug)}</div>
      <div class="text-[11px] text-gray-500 mt-0.5">${esc(skill.title)} · ${esc(skill.category)}</div>
    </button>`).join('') || '<div class="p-2 text-xs text-gray-500">没有匹配的 Skill</div>';
  host.classList.remove('hidden');
  initIcons(host);
}

export function insertSkillCommand(slug) {
  const input = document.getElementById('agentInput');
  input.value = `/${slug} `;
  input.focus();
  document.getElementById('agentSkillCommands').classList.add('hidden');
}

// ============ 发送消息（SSE 流式） ============

export async function sendAgentMessage() {
  const input = document.getElementById('agentInput');
  const message = input.value.trim();
  if (!message) return;

  const agent = document.getElementById('agentProvider').value;
  const agentInfo = agentCache.find(item => item.id === agent);
  if (!agentInfo?.available) { toast('请选择可用的 Agent', 'error'); return; }

  const button = document.getElementById('agentSend');
  const timestamp = Date.now();

  // 用户消息
  const userMsg = { role: 'user', content: message, timestamp };
  agentMessages.push(userMsg);

  input.value = '';
  button.disabled = true;
  button.innerHTML = '<i data-lucide="loader-circle" class="w-4 h-4 animate-spin"></i>思考中…';
  initIcons(button);

  // 添加一个空白的 assistant 气泡用于流式更新
  const assistantMsg = { role: 'assistant', content: '', agentName: agentInfo.name || 'LLM', timestamp: Date.now() };
  agentMessages.push(assistantMsg);
  appendAgentMessage(assistantMsg);

  try {
    // SSE 流式请求
    const response = await fetch('/api/_/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, agent, threadId: currentAgentThreadId }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;
        try {
          const event = JSON.parse(jsonStr);
          switch (event.type) {
            case 'start':
              currentAgentThreadId = event.threadId;
              await loadThreadsFromServer();
              renderAgentThreads();
              break;
            case 'delta':
              assistantMsg.content += event.content;
              updateLastAssistantMessage(assistantMsg.content);
              break;
            case 'done':
              assistantMsg.content = event.answer || assistantMsg.content;
              updateLastAssistantMessage(assistantMsg.content);
              agentRuntimeErrors.delete(agent);
              renderAgentProviderStatus(agent);
              if (event.threadId) currentAgentThreadId = event.threadId;
              await loadThreadsFromServer();
              renderAgentThreads();
              break;
            case 'error':
              throw new Error(event.error);
          }
        } catch (parseErr) {
          if (parseErr.message && !parseErr.message.startsWith('Unexpected')) throw parseErr;
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      assistantMsg.content += '\n\n[已中断]';
    } else {
      agentRuntimeErrors.set(agent, e.message);
      renderAgentProviderStatus(agent);
      toast(e.message, 'error');
      assistantMsg.content = `执行失败：${e.message}`;
    }
    updateLastAssistantMessage(assistantMsg.content);
    await loadThreadsFromServer();
    renderAgentThreads();
  } finally {
    button.disabled = false;
    button.innerHTML = '<i data-lucide="send" class="w-4 h-4"></i>发送';
    initIcons(button);
  }
}

export function handleAgentInputKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    sendAgentMessage();
  }
}

// ============ 页面渲染 ============

export async function renderAgent() {
  try {
    const [skillsResult, agentsResult] = await Promise.allSettled([
      loadSkills(),
      localApi('agents'),
    ]);
    if (agentsResult.status === 'rejected') throw agentsResult.reason;
    if (skillsResult.status === 'rejected') {
      toast(`Skill 列表加载失败，但仍可使用 Agent：${skillsResult.reason.message}`, 'info');
    }
    agentCache = agentsResult.value;
    const select = document.getElementById('agentProvider');
    if (!select || !select.isConnected) return;
    if (!agentCache.length) {
      select.innerHTML = '<option value="" disabled selected>无可用 Agent · 请在设置中配置</option>';
      currentAgentId = '';
      const currentName = document.getElementById('agent-current-name');
      if (currentName) currentName.textContent = '未配置 Agent';
      renderAgentProviderStatus('');
      agentMessages = [];
      currentAgentThreadId = null;
      renderAgentMessages();
      renderAgentThreads();
      return;
    }
    select.innerHTML = agentCache.map(agent => `
      <option value="${esc(agent.id)}" ${agent.available ? '' : 'disabled'}>
        ${esc(agent.name)}${agent.agent_id ? ` · ${esc(agent.agent_id)}` : ''}${agent.available ? '' : ' · 不可用'}
      </option>`).join('');
    const preferred = LS.get('agentSelected', 'openclaw');
    const firstAvailable = agentCache.find(agent => agent.available)?.id || '';
    select.value = agentCache.some(agent => agent.id === preferred && agent.available) ? preferred : firstAvailable;
    currentAgentId = select.value;
    const selectedAgent = agentCache.find(agent => agent.id === currentAgentId);
    const currentName = document.getElementById('agent-current-name');
    if (currentName) currentName.textContent = selectedAgent?.name || '未配置 Agent';
    renderAgentProviderStatus(currentAgentId);

    // 从后端加载线程
    await loadThreadsFromServer();
    const myThreads = agentThreads.filter(t => t.agent_id === currentAgentId);
    if (myThreads.length) {
      await switchAgentThread(myThreads[0].id);
    } else {
      agentMessages = [];
      currentAgentThreadId = null;
      renderAgentMessages();
    }
    renderAgentThreads();

    const draft = LS.get('agentSkillDraft', '');
    if (draft) {
      document.getElementById('agentInput').value = draft;
      LS.set('agentSkillDraft', '');
      showSkillCommands();
    }
    renderAgentMessages();
  } catch (e) {
    const status = document.getElementById('agent-provider-status');
    if (status) {
      status.className = 'text-[10px] text-red-400 mt-1.5 leading-relaxed';
      status.textContent = e.message;
    }
    toast(e.message, 'error');
  }
}
