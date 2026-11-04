import { createRequire } from 'module'
import { statSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  /** mtime of the generated client schema when the current instance was built */
  prismaGeneratedAt: number | undefined
}

function newClient(): PrismaClient {
  return new PrismaClient({
    log: ['query'],
  })
}

/** mtime of the generated client's schema copy (updates on every `prisma generate`) */
function generatedClientMtime(): number {
  try {
    const nodeRequire = createRequire(`${process.cwd()}/package.json`)
    return statSync(nodeRequire.resolve('.prisma/client/schema.prisma')).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Self-heal for long-running dev servers: the generated Prisma client is only
 * as fresh as the last `prisma generate`. If the server booted before a new
 * model OR new FIELDS were generated, its cached client instance (and Node's
 * require cache) won't expose them and hot-reloaded routes would crash on the
 * new fields. Detect the gap via the generated client's on-disk mtime and
 * rebuild from a freshly resolved module — no server restart needed. In
 * production the instance is created once, so this is a cheap no-op.
 */
function resolveClient(): PrismaClient {
  const existing = globalForPrisma.prisma

  // In production (Vercel / Cloud), always reuse single client cleanly without dynamic require
  if (process.env.NODE_ENV === 'production') {
    return existing ?? newClient()
  }

  const genMtime = generatedClientMtime()

  if (existing) {
    const builtAt = globalForPrisma.prismaGeneratedAt ?? 0
    // 1.5s grace so a generate that raced the boot isn't treated as newer.
    const stale = genMtime > builtAt + 1500
    // Legacy probe kept as a second net (model added before mtime tracking existed).
    const missingProbeModel =
      (existing as unknown as Record<string, unknown>).jobRequisition === undefined
    if (!stale && !missingProbeModel) {
      return existing // client is current
    }
  }

  try {
    const nodeRequire = createRequire(`${process.cwd()}/package.json`)
    // Drop cached copies so the next require() re-reads the regenerated client
    for (const id of ['.prisma/client', '.prisma/client/default', '.prisma/client/client', '@prisma/client']) {
      try {
        const resolved = nodeRequire.resolve(id)
        if (nodeRequire.cache[resolved]) delete nodeRequire.cache[resolved]
      } catch {
        /* optional module id — ignore */
      }
    }
    const fresh = nodeRequire('@prisma/client') as { PrismaClient: typeof PrismaClient }
    const rebuilt = new fresh.PrismaClient({ log: ['query'] })
    globalForPrisma.prismaGeneratedAt = generatedClientMtime()
    return rebuilt
  } catch (err) {
    return existing ?? newClient()
  }
}

export const db = resolveClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
  globalForPrisma.prismaGeneratedAt ??= generatedClientMtime()
}
