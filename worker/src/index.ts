import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  MY_BUCKET: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', cors());

// 根路径直接返回完整的 HTML 页面
app.get('/', (c) => {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>视频切片上传</title>
  <script src="https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/ffmpeg.min.js"></script>
</head>
<body>
  <input type="file" id="fileInput" accept="video/*">
  <button id="uploadBtn">上传并切片</button>
  <div id="progress"></div>
  <video id="player" controls style="width:100%;max-width:800px;display:none;"></video>

  <script>
    const { createFFmpeg, fetchFile } = FFmpeg;
    const ffmpeg = createFFmpeg({ log: true });
    const API_BASE = '';

    document.getElementById('uploadBtn').onclick = async () => {
      const file = document.getElementById('fileInput').files[0];
      if (!file) return alert('请选择视频文件');

      const progress = document.getElementById('progress');
      progress.textContent = '加载 FFmpeg...';

      if (!ffmpeg.isLoaded()) await ffmpeg.load();
      ffmpeg.setProgress(({ ratio }) => {
        progress.textContent = '切片中: ' + Math.round(ratio * 100) + '%';
      });

      progress.textContent = '写入文件到虚拟文件系统...';
      ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(file));

      progress.textContent = '切片中 (生成 HLS)...';
      ffmpeg.run(
        '-i', 'input.mp4',
        '-codec', 'copy',
        '-f', 'hls',
        '-hls_time', '10',
        '-hls_list_size', '0',
        '-hls_segment_filename', 'segment_%03d.ts',
        'playlist.m3u8'
      );

      progress.textContent = '切片完成，开始上传...';

      const files = ffmpeg.FS('readdir', '/').filter(f => f.endsWith('.ts') || f === 'playlist.m3u8');

      const uploads = files.map(async (filename) => {
        const key = 'videos/' + Date.now() + '/' + filename;
        const resp = await fetch(API_BASE + '/api/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key })
        });
        const { url } = await resp.json();

        const data = ffmpeg.FS('readFile', filename);
        return fetch(url, {
          method: 'PUT',
          body: data.buffer,
          headers: { 'Content-Type': filename.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t' }
        });
      });

      await Promise.all(uploads);
      progress.textContent = '✅ 全部上传完成！';

      const video = document.getElementById('player');
      const m3u8Key = 'videos/' + Date.now() + '/playlist.m3u8';
      video.src = API_BASE + '/api/playlist/' + m3u8Key;
      video.style.display = 'block';
      video.play();
    };
  </script>
</body>
</html>`;
  return c.html(html);
});

// API 路由保持不变
app.post('/api/presign', async (c) => {
  const { key } = await c.req.json<{ key: string }>();
  if (!key) return c.json({ error: 'Missing key' }, 400);
  const url = await c.env.MY_BUCKET.presignedUrl('put', key, { expiresIn: 3600 });
  return c.json({ url });
});

app.get('/api/playlist/:key', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.MY_BUCKET.get(key);
  if (!object) return c.json({ error: 'Not found' }, 404);
  return c.body(object.body, {
    headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
  });
});

export default app;
