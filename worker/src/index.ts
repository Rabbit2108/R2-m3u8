import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  MY_BUCKET: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', cors());

// 生成预签名上传 URL
app.post('/api/presign', async (c) => {
  const { key } = await c.req.json<{ key: string }>();
  if (!key) return c.json({ error: 'Missing key' }, 400);

  const bucket = c.env.MY_BUCKET;
  const url = await bucket.presignedUrl('put', key, {
    expiresIn: 3600, // 1 小时有效期
  });

  return c.json({ url });
});

// 获取已上传文件的播放地址
app.get('/api/playlist/:key', async (c) => {
  const key = c.req.param('key');
  // 假设 m3u8 存放在 video/xxx/playlist.m3u8
  const object = await c.env.MY_BUCKET.get(key);
  if (!object) return c.json({ error: 'Not found' }, 404);
  return c.body(object.body, {
    headers: { 'Content-Type': 'application/vnd.apple.mpegurl' }
  });
});

export default app;
