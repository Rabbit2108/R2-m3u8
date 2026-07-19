// ============================================================
//  M3U8 解析器（支持主清单 / 子流显示）
//  访问根路径 → 操作界面
//  /parse?m3u8=URL → 返回 JSON
// ============================================================

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '') {
      return new Response(HTML_PAGE, {
        headers: { 'Content-Type': 'text/html;charset=utf-8' },
      });
    }

    if (url.pathname === '/parse') {
      const m3u8Url = url.searchParams.get('m3u8');
      if (!m3u8Url) {
        return jsonResponse({ error: '缺少 m3u8 参数' }, 400);
      }

      try {
        const resp = await fetch(m3u8Url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        const result = parseM3U8(text, m3u8Url);
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * 解析 M3U8，自动识别主清单或媒体清单
 */
function parseM3U8(content, baseUrl) {
  const lines = content.split('\n');
  const base = new URL(baseUrl);
  let playlistType = null;
  let targetDuration = null;
  let mediaSequence = null;

  // 存储子流（主清单）
  const streams = [];
  // 存储切片（媒体清单）
  const segments = [];

  // 临时变量用于 #EXTINF
  let extinfDuration = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // ---- 标签 ----
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = parseInt(line.split(':')[1]);
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = parseInt(line.split(':')[1]);
      continue;
    }
    if (line.startsWith('#EXT-X-PLAYLIST-TYPE:')) {
      playlistType = line.split(':')[1];
      continue;
    }

    // ---- #EXTINF 切片时长 ----
    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/#EXTINF:([\d.]+)/);
      if (match) {
        extinfDuration = parseFloat(match[1]);
      }
      continue;
    }

    // ---- #EXT-X-STREAM-INF 主清单子流 ----
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const resolution = line.match(/RESOLUTION=(\d+x\d+)/)?.[1] || null;
      const bandwidth = line.match(/BANDWIDTH=(\d+)/)?.[1] || null;
      const codecs = line.match(/CODECS="([^"]+)"/)?.[1] || null;
      // 下一行是子流 URL
      const nextLine = lines[i + 1]?.trim();
      if (nextLine && !nextLine.startsWith('#')) {
        streams.push({
          url: new URL(nextLine, base).href,
          resolution,
          bandwidth: bandwidth ? parseInt(bandwidth) : null,
          codecs,
        });
        i++; // 跳过下一行
      }
      continue;
    }

    // ---- #EXT-X-KEY 密钥 ----
    // 这里暂时保留但不影响子流显示，实际媒体清单才会用到
    // 但为了完整，可以存储，但主清单通常没有密钥

    // ---- 普通 URL（切片或子流） ----
    // 如果不是注释行，且不是前面已处理的 #EXTINF 行（#EXTINF 本身不以 URL 出现）
    if (!line.startsWith('#')) {
      // 如果当前有 #EXTINF，则为切片
      if (extinfDuration !== null) {
        segments.push({
          url: new URL(line, base).href,
          duration: extinfDuration,
          index: segments.length,
        });
        extinfDuration = null; // 重置
      } else {
        // 没有 #EXTINF 的 URL 可能是子流（但子流已由 STREAM-INF 处理），这里作为兜底
        // 但为了不重复，如果 streams 已经有内容，则忽略；否则视为切片
        if (streams.length === 0) {
          segments.push({
            url: new URL(line, base).href,
            duration: null,
            index: segments.length,
          });
        }
      }
    }
  }

  // 如果找到了子流，则返回主清单类型
  if (streams.length > 0) {
    return {
      type: 'master',
      baseUrl: base.href,
      streams,
      // 也保留一些通用信息
      targetDuration,
      mediaSequence,
      playlistType,
    };
  }

  // 否则返回媒体清单
  return {
    type: 'media',
    baseUrl: base.href,
    totalSegments: segments.length,
    totalDuration: segments.reduce((sum, s) => sum + (s.duration || 0), 0),
    targetDuration,
    mediaSequence,
    playlistType,
    segments,
  };
}

// ============================================================
//  Web 界面
// ============================================================
const HTML_PAGE = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>M3U8 解析器 - 支持主清单</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f1a;
      color: #e0e0e0;
      margin: 0;
      padding: 20px;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    .container {
      max-width: 1100px;
      width: 100%;
      background: #1a1a2e;
      padding: 30px;
      border-radius: 20px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    }
    h1 {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 500;
      color: #f0b90b;
      margin-top: 0;
    }
    h1 small {
      font-size: 14px;
      color: #888;
      font-weight: 400;
    }
    .badge {
      background: #f0b90b;
      color: #000;
      padding: 2px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      margin-left: 10px;
    }
    .input-row {
      display: flex;
      gap: 12px;
      margin: 20px 0;
      flex-wrap: wrap;
    }
    .input-row input {
      flex: 1;
      padding: 14px 18px;
      border: none;
      border-radius: 12px;
      background: #2a2a40;
      color: #fff;
      font-size: 16px;
      min-width: 200px;
      border: 1px solid #3a3a5a;
      transition: 0.2s;
    }
    .input-row input:focus {
      outline: none;
      border-color: #f0b90b;
      background: #22223a;
    }
    .input-row button {
      padding: 14px 32px;
      border: none;
      border-radius: 12px;
      background: #f0b90b;
      color: #0f0f1a;
      font-weight: 600;
      font-size: 16px;
      cursor: pointer;
      transition: 0.2s;
      white-space: nowrap;
    }
    .input-row button:hover {
      background: #ffca2c;
      transform: scale(1.02);
    }
    .input-row button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    .status {
      padding: 12px 16px;
      border-radius: 10px;
      background: #22223a;
      margin-bottom: 20px;
      display: none;
    }
    .status.error {
      display: block;
      background: #3a1a1a;
      color: #ff6b6b;
      border-left: 4px solid #ff6b6b;
    }
    .status.success {
      display: block;
      background: #1a3a2a;
      color: #69db7c;
      border-left: 4px solid #69db7c;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
      background: #12121f;
      padding: 16px;
      border-radius: 12px;
      margin: 16px 0;
    }
    .meta-item {
      display: flex;
      flex-direction: column;
    }
    .meta-item .label {
      font-size: 12px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .meta-item .value {
      font-weight: 500;
      font-size: 15px;
      word-break: break-all;
    }
    .section-title {
      font-size: 18px;
      font-weight: 500;
      margin: 24px 0 12px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .section-title button {
      background: #2a2a40;
      border: none;
      color: #ccc;
      padding: 6px 14px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      transition: 0.2s;
    }
    .section-title button:hover {
      background: #3a3a5a;
      color: #fff;
    }
    .table-wrap {
      overflow-x: auto;
      border-radius: 12px;
      border: 1px solid #2a2a40;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th {
      background: #0f0f1a;
      color: #aaa;
      font-weight: 500;
      text-align: left;
      padding: 12px 16px;
      border-bottom: 2px solid #2a2a40;
    }
    td {
      padding: 10px 16px;
      border-bottom: 1px solid #1f1f30;
      vertical-align: middle;
    }
    tr:hover td {
      background: #18182a;
    }
    .url-cell {
      word-break: break-all;
      font-size: 13px;
    }
    .copy-btn {
      background: #2a2a40;
      border: none;
      color: #ccc;
      padding: 4px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      transition: 0.2s;
      white-space: nowrap;
    }
    .copy-btn:hover {
      background: #3a3a5a;
      color: #fff;
    }
    .copy-all-btn {
      background: #2a2a40;
      border: none;
      color: #ccc;
      padding: 6px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      transition: 0.2s;
    }
    .copy-all-btn:hover {
      background: #3a3a5a;
      color: #fff;
    }
    .type-badge {
      display: inline-block;
      padding: 2px 12px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      background: #2a2a40;
      color: #aaa;
      margin-left: 12px;
    }
    .type-badge.master {
      background: #f0b90b;
      color: #000;
    }
    .type-badge.media {
      background: #2ecc71;
      color: #000;
    }
    .footer {
      margin-top: 30px;
      text-align: center;
      color: #555;
      font-size: 13px;
      border-top: 1px solid #1f1f30;
      padding-top: 20px;
    }
    .toast {
      position: fixed;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%);
      background: #2a2a40;
      color: #fff;
      padding: 12px 24px;
      border-radius: 12px;
      font-size: 14px;
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: none;
    }
    .toast.show {
      opacity: 1;
    }
  </style>
</head>
<body>
<div class="container">
  <h1>
    📺 M3U8 解析器
    <small>Cloudflare Worker 版</small>
    <span class="badge">支持主清单</span>
  </h1>

  <div class="input-row">
    <input type="text" id="m3u8Input" placeholder="请输入 M3U8 链接" />
    <button id="parseBtn">🔍 解析</button>
  </div>

  <div id="status" class="status"></div>

  <!-- 元数据 -->
  <div id="metaArea" style="display:none;">
    <div class="meta-grid" id="metaGrid"></div>
  </div>

  <!-- 子流列表（主清单） -->
  <div id="streamsArea" style="display:none;">
    <div class="section-title">
      <span>📡 子流列表 (<span id="streamCount">0</span>)</span>
      <button id="copyAllStreamsBtn">📋 复制所有 URL</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:50px;">#</th>
            <th>子流 URL</th>
            <th style="width:100px;">分辨率</th>
            <th style="width:100px;">带宽</th>
            <th style="width:120px;">编码</th>
            <th style="width:80px;">操作</th>
          </tr>
        </thead>
        <tbody id="streamsBody"></tbody>
      </table>
    </div>
  </div>

  <!-- 切片列表（媒体清单） -->
  <div id="segmentsArea" style="display:none;">
    <div class="section-title">
      <span>📦 切片列表 (<span id="segCount">0</span>)</span>
      <button id="copyAllUrlsBtn">📋 复制所有 URL</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:50px;">#</th>
            <th>切片 URL</th>
            <th style="width:90px;">时长 (s)</th>
            <th style="width:80px;">操作</th>
          </tr>
        </thead>
        <tbody id="segmentsBody"></tbody>
      </table>
    </div>
  </div>

  <div class="footer">
    ⚡ 数据由 Worker 后端抓取 · 无跨域 · 仅解析元数据
  </div>
</div>

<div id="toast" class="toast"></div>

<script>
  const input = document.getElementById('m3u8Input');
  const parseBtn = document.getElementById('parseBtn');
  const statusDiv = document.getElementById('status');
  const metaArea = document.getElementById('metaArea');
  const metaGrid = document.getElementById('metaGrid');
  const streamsArea = document.getElementById('streamsArea');
  const streamsBody = document.getElementById('streamsBody');
  const streamCount = document.getElementById('streamCount');
  const segmentsArea = document.getElementById('segmentsArea');
  const segmentsBody = document.getElementById('segmentsBody');
  const segCount = document.getElementById('segCount');
  const copyAllUrlsBtn = document.getElementById('copyAllUrlsBtn');
  const copyAllStreamsBtn = document.getElementById('copyAllStreamsBtn');
  const toast = document.getElementById('toast');

  let currentStreams = [];
  let currentSegments = [];

  function showStatus(msg, type = '') {
    statusDiv.textContent = msg;
    statusDiv.className = 'status ' + type;
    if (msg) statusDiv.style.display = 'block';
    else statusDiv.style.display = 'none';
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 2500);
  }

  async function parseM3U8() {
    const url = input.value.trim();
    if (!url) {
      showStatus('❌ 请输入 M3U8 地址', 'error');
      return;
    }

    parseBtn.disabled = true;
    parseBtn.textContent = '⏳ 解析中...';
    showStatus('⏳ 正在获取...', '');

    try {
      const resp = await fetch('/parse?m3u8=' + encodeURIComponent(url));
      const data = await resp.json();

      if (data.error) {
        showStatus('❌ ' + data.error, 'error');
        return;
      }

      renderResult(data);
      showStatus('✅ 解析成功', 'success');
    } catch (err) {
      showStatus('❌ 请求失败: ' + err.message, 'error');
    } finally {
      parseBtn.disabled = false;
      parseBtn.textContent = '🔍 解析';
    }
  }

  function renderResult(data) {
    // 隐藏所有区域
    metaArea.style.display = 'none';
    streamsArea.style.display = 'none';
    segmentsArea.style.display = 'none';

    // 元数据（通用）
    const metaItems = [
      { label: '类型', value: data.type === 'master' ? '主清单 (Master)' : '媒体清单 (Media)' },
      { label: '基础 URL', value: data.baseUrl || '-' },
    ];
    if (data.type === 'master') {
      metaItems.push(
        { label: '子流数量', value: data.streams?.length || 0 },
        { label: '目标时长', value: data.targetDuration || '-' },
        { label: '序列号', value: data.mediaSequence ?? '-' }
      );
    } else {
      metaItems.push(
        { label: '切片总数', value: data.totalSegments || 0 },
        { label: '总时长', value: data.totalDuration ? data.totalDuration.toFixed(2) + 's' : '-' },
        { label: '目标时长', value: data.targetDuration || '-' },
        { label: '序列号', value: data.mediaSequence ?? '-' }
      );
    }
    metaGrid.innerHTML = metaItems.map(item =>
      `<div class="meta-item"><span class="label">${item.label}</span><span class="value">${item.value}</span></div>`
    ).join('');
    metaArea.style.display = 'block';

    if (data.type === 'master') {
      // 显示子流
      currentStreams = data.streams || [];
      if (currentStreams.length > 0) {
        streamsArea.style.display = 'block';
        streamCount.textContent = currentStreams.length;
        const rows = currentStreams.map((s, idx) => {
          const bw = s.bandwidth ? (s.bandwidth / 1000).toFixed(0) + ' kbps' : '-';
          return `<tr>
            <td>${idx + 1}</td>
            <td class="url-cell">${escapeHtml(s.url)}</td>
            <td>${s.resolution || '-'}</td>
            <td>${bw}</td>
            <td style="font-size:12px;">${s.codecs || '-'}</td>
            <td><button class="copy-btn" data-url="${escapeHtml(s.url)}">📋 复制</button></td>
          </tr>`;
        }).join('');
        streamsBody.innerHTML = rows;
        // 绑定复制
        streamsBody.querySelectorAll('.copy-btn').forEach(btn => {
          btn.addEventListener('click', function() {
            copyToClipboard(this.dataset.url);
          });
        });
      }
    } else {
      // 显示切片
      currentSegments = data.segments || [];
      if (currentSegments.length > 0) {
        segmentsArea.style.display = 'block';
        segCount.textContent = currentSegments.length;
        const rows = currentSegments.map((seg, idx) => {
          const dur = seg.duration !== null && seg.duration !== undefined ? seg.duration.toFixed(2) : '-';
          return `<tr>
            <td>${idx + 1}</td>
            <td class="url-cell">${escapeHtml(seg.url)}</td>
            <td>${dur}</td>
            <td><button class="copy-btn" data-url="${escapeHtml(seg.url)}">📋 复制</button></td>
          </tr>`;
        }).join('');
        segmentsBody.innerHTML = rows;
        segmentsBody.querySelectorAll('.copy-btn').forEach(btn => {
          btn.addEventListener('click', function() {
            copyToClipboard(this.dataset.url);
          });
        });
      }
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('✅ 已复制');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast('✅ 已复制');
    }
  }

  // 复制所有 URL（切片或子流）
  copyAllUrlsBtn.addEventListener('click', function() {
    const urls = currentSegments.map(s => s.url).join('\n');
    if (!urls) { showToast('没有可复制的 URL'); return; }
    copyToClipboard(urls);
  });
  copyAllStreamsBtn.addEventListener('click', function() {
    const urls = currentStreams.map(s => s.url).join('\n');
    if (!urls) { showToast('没有可复制的 URL'); return; }
    copyToClipboard(urls);
  });

  parseBtn.addEventListener('click', parseM3U8);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') parseBtn.click(); });

  showStatus('💡 输入 M3U8 地址后点击“解析”', '');
</script>
</body>
</html>`;
