import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { pinoLogger } from 'hono-pino'
import env from './core/env.js'

const app = new Hono().use( pinoLogger({ pino: { level: env.LOG_LEVEL } }) )

app.get('/', (c) => {
  return c.text('Hello Hono!');
})

app.get('/health', (c) => {
  return c.json({ "status": "healthy" });
})

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
