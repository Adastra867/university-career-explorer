import express from 'express';
import { fileURLToPath } from 'node:url';
import api from './api.js';
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(express.json({ limit: '1mb' }));
app.use('/api', api);
app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url)), { dotfiles: 'deny' }));
app.use('/api', (req, res) => res.status(404).json({ code: 'NOT_FOUND', error: '接口不存在' }));
app.use((error, req, res, next) => {
  if (error.name === 'ZodError') return res.status(400).json({ code: 'INVALID_INPUT', error: '输入格式或长度无效，请检查后重试' });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ code: 'INVALID_JSON', error: '请求不是有效的JSON' });
  if (error.type === 'entity.too.large') return res.status(413).json({ code: 'BODY_TOO_LARGE', error: '请求内容超过1MB' });
  const status = error.status || 500;
  if (status >= 500) console.error('Request failed:', error.code || 'INTERNAL_ERROR');
  res.status(status).json({ code: error.code || 'INTERNAL_ERROR', error: status === 500 ? '服务暂不可用，请稍后重试' : error.message });
});
