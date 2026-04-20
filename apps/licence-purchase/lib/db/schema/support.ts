import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { users } from './auth'

export const ATTACHMENT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/x-yaml',
  'text/yaml',
  'application/zip',
  'application/gzip',
  'application/x-gzip',
] as const

export type AllowedMimeType = (typeof ATTACHMENT_ALLOWED_MIME_TYPES)[number]

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

export type SupportTicketStatus =
  | 'open'
  | 'pending_customer'
  | 'pending_staff'
  | 'resolved'
  | 'closed'

export type SupportMessageAuthor = 'customer' | 'ai' | 'staff'

export type SupportAiJobStatus = 'queued' | 'running' | 'done' | 'failed'

export const supportTickets = pgTable(
  'support_ticket',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    subject: text('subject').notNull(),
    // 'open' | 'pending_customer' | 'pending_staff' | 'resolved' | 'closed'
    status: text('status').notNull().default('open'),
    aiPaused: boolean('ai_paused').notNull().default(false),
    aiFlagReason: text('ai_flag_reason'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('support_ticket_org_idx').on(table.organisationId),
    statusIdx: index('support_ticket_status_idx').on(table.status),
  }),
)

export const supportMessages = pgTable(
  'support_message',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    // 'customer' | 'ai' | 'staff'
    author: text('author').notNull(),
    authorUserId: text('author_user_id').references(() => users.id),
    body: text('body').notNull(),
    bodyRedacted: text('body_redacted'),
    aiModelId: text('ai_model_id'),
    aiInputTokens: integer('ai_input_tokens'),
    aiOutputTokens: integer('ai_output_tokens'),
    aiLatencyMs: integer('ai_latency_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ticketIdx: index('support_message_ticket_idx').on(table.ticketId),
  }),
)

// Singleton row, id = 'singleton'.
export const supportSettings = pgTable('support_settings', {
  id: text('id').primaryKey().default('singleton'),
  aiEnabled: boolean('ai_enabled').notNull().default(true),
  updatedByUserId: text('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const supportAiJobs = pgTable(
  'support_ai_job',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    // 'queued' | 'running' | 'done' | 'failed'
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    lockedBy: text('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('support_ai_job_status_idx').on(table.status),
    ticketIdx: index('support_ai_job_ticket_idx').on(table.ticketId),
  }),
)

// Rolling-window rate limit: one row per ticket per hour bucket.
export const supportAiRate = pgTable(
  'support_ai_rate',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => ({
    ticketWindow: uniqueIndex('support_ai_rate_ticket_window').on(
      table.ticketId,
      table.windowStart,
    ),
  }),
)

// Attachments uploaded by customers alongside their support messages.
// messageId is null until the message is saved (files are uploaded before submit).
export const supportAttachments = pgTable(
  'support_attachment',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    ticketId: text('ticket_id').references(() => supportTickets.id, { onDelete: 'cascade' }),
    messageId: text('message_id').references(() => supportMessages.id, { onDelete: 'cascade' }),
    uploadedByUserId: text('uploaded_by_user_id')
      .notNull()
      .references(() => users.id),
    filename: text('filename').notNull(),
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ticketIdx: index('support_attachment_ticket_idx').on(table.ticketId),
    messageIdx: index('support_attachment_message_idx').on(table.messageId),
  }),
)

export type SupportTicket = typeof supportTickets.$inferSelect
export type NewSupportTicket = typeof supportTickets.$inferInsert
export type SupportMessage = typeof supportMessages.$inferSelect
export type NewSupportMessage = typeof supportMessages.$inferInsert
export type SupportSettingsRow = typeof supportSettings.$inferSelect
export type SupportAiJob = typeof supportAiJobs.$inferSelect
export type NewSupportAiJob = typeof supportAiJobs.$inferInsert
export type SupportAttachment = typeof supportAttachments.$inferSelect
export type NewSupportAttachment = typeof supportAttachments.$inferInsert
