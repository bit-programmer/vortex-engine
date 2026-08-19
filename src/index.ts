import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { pinoLogger } from 'hono-pino'
import env from './core/env.js'

import api from './routes/api.js'
import auth from './routes/auth.js'

export const app = new Hono().use(pinoLogger({ pino: { level: env.LOG_LEVEL } }))

app.route('/api', api)
app.route('/api', auth)

app.get('/', (c) => {
  return c.text('Hello Hono!');
})

app.get('/health', (c) => {
  return c.json({ "status": "healthy" });
})

const isTest = process.argv[1] && process.argv[1].includes('test-api');
if (!isTest && process.env.VERCEL !== '1') {
  serve({
    fetch: app.fetch,
    port: 3001
  }, (info) => {
    console.log(`Server is running on http://localhost:${info.port}`)
  })
}

export default app