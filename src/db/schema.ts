import {pgSchema, pgTable, foreignKey, unique, pgPolicy, uuid, timestamp, index, text, jsonb, integer, check, numeric, date, boolean, bigint, uniqueIndex, smallint, time, bigserial, primaryKey, pgSequence, pgEnum, customType} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const appRole = pgEnum("app_role", ['admin', 'operator', 'owner', 'manager', 'cashier', 'receptionist'])
export const conversationMode = pgEnum("conversation_mode", ['ai', 'human'])
export const leadScore = pgEnum("lead_score", ['hot', 'warm', 'cold'])
export const leadStatus = pgEnum("lead_status", ['new', 'needs_attention', 'assigned', 'contacted', 'negotiating', 'won', 'lost'])
export const messageRole = pgEnum("message_role", ['customer', 'ai', 'staff', 'system'])
export const orderStatus = pgEnum("order_status", ['new', 'confirming', 'confirmed', 'preparing', 'delivered', 'cancelled'])
export const paymentStatus = pgEnum("payment_status", ['unpaid', 'partial', 'paid', 'refunded'])

export const orderNumberSeq = pgSequence("order_number_seq", {  startWith: "1000", increment: "1", minValue: "1", maxValue: "9223372036854775807", cache: "1", cycle: false })

export const userRoles = pgTable("user_roles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	role: appRole().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "user_roles_user_id_fkey"
		}).onDelete("cascade"),
	unique("user_roles_user_id_role_key").on(table.role, table.userId),
	pgPolicy("user_roles self read", { as: "permissive", for: "select", to: ["app_user"], using: sql`(user_id = app.user_id())` }),
]);

export const telegramBotState = pgTable("telegram_bot_state", {
	telegramUserId: text("telegram_user_id").primaryKey().notNull(),
	chatId: text("chat_id").notNull(),
	state: text().default('idle').notNull(),
	data: jsonb().default({}).notNull(),
	attempts: integer().default(0).notNull(),
	secretMessageId: text("secret_message_id"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).default(sql`(now() + '00:15:00'::interval)`).notNull(),
}, (table) => [
	index("telegram_bot_state_expiry_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const studyGroups = pgTable("study_groups", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	courseId: uuid("course_id").notNull(),
	teacherId: uuid("teacher_id"),
	name: text().notNull(),
	monthlyPrice: numeric("monthly_price", { precision: 14, scale:  2 }).default('0').notNull(),
	capacity: integer().default(0).notNull(),
	lessonDays: text("lesson_days").default('').notNull(),
	startsOn: date("starts_on"),
	endsOn: date("ends_on"),
	status: text().default('active').notNull(),
	note: text().default('').notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("study_groups_business_idx").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	index("study_groups_course_idx").using("btree", table.courseId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "study_groups_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.courseId],
			foreignColumns: [services.id],
			name: "study_groups_course_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.teacherId],
			foreignColumns: [employees.id],
			name: "study_groups_teacher_id_fkey"
		}).onDelete("set null"),
	unique("study_groups_one_name_per_business").on(table.businessId, table.name),
	pgPolicy("study_groups tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`(is_business_member(business_id) AND branch_access_ok(business_id, NULL::uuid))`, withCheck: sql`(is_business_member(business_id) AND branch_access_ok(business_id, NULL::uuid))`  }),
	check("study_groups_capacity_check", sql`capacity >= 0`),
	check("study_groups_monthly_price_check", sql`monthly_price >= (0)::numeric`),
	check("study_groups_status_check", sql`status = ANY (ARRAY['collecting'::text, 'active'::text, 'finished'::text, 'archived'::text])`),
]);

export const attendance = pgTable("attendance", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	studentId: uuid("student_id").notNull(),
	lessonDate: date("lesson_date").notNull(),
	groupName: text("group_name").default('').notNull(),
	status: text().default('present').notNull(),
	note: text().default('').notNull(),
	markedBy: uuid("marked_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	groupId: uuid("group_id"),
}, (table) => [
	index("attendance_business_date_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.lessonDate.asc().nullsLast().op("uuid_ops")),
	index("attendance_group_date_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.groupId.asc().nullsLast().op("date_ops"), table.lessonDate.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "attendance_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [studyGroups.id],
			name: "attendance_group_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.markedBy],
			foreignColumns: [profiles.id],
			name: "attendance_marked_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [customers.id],
			name: "attendance_student_id_fkey"
		}).onDelete("cascade"),
	unique("attendance_one_mark_per_day").on(table.businessId, table.groupName, table.lessonDate, table.studentId),
	pgPolicy("attendance tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`(is_business_member(business_id) AND branch_access_ok(business_id, NULL::uuid))`, withCheck: sql`(is_business_member(business_id) AND branch_access_ok(business_id, NULL::uuid))`  }),
	check("attendance_status_check", sql`status = ANY (ARRAY['present'::text, 'absent'::text, 'excused'::text, 'late'::text])`),
]);

export const aiSettings = pgTable("ai_settings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	model: text().default('google/gemini-3.7-flash').notNull(),
	toneOfVoice: text("tone_of_voice").default('friendly, professional, concise').notNull(),
	salesStrategy: text("sales_strategy").default('Consultative selling: qualify need, recommend in-stock products, handle objections, close politely.').notNull(),
	languageInstruction: text("language_instruction").default('Reply in the same language the customer writes in (Uzbek, Russian or English).').notNull(),
	escalationRules: text("escalation_rules").default('Escalate on discount requests, complaints, payment or delivery problems, or when the customer asks for a human.').notNull(),
	maxDiscountPercent: numeric("max_discount_percent", { precision: 5, scale:  2 }).default('0').notNull(),
	customInstructions: text("custom_instructions").default('').notNull(),
	enabled: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "ai_settings_business_id_fkey"
		}).onDelete("cascade"),
	unique("ai_settings_business_unique").on(table.businessId),
	pgPolicy("ai_settings admin write", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_admin(business_id)`, withCheck: sql`is_business_admin(business_id)`  }),
	pgPolicy("ai_settings member read", { as: "permissive", for: "select", to: ["app_user"] }),
]);

export const categories = pgTable("categories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	description: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "categories_business_id_fkey"
		}).onDelete("cascade"),
	unique("categories_business_name_unique").on(table.businessId, table.name),
	unique("categories_business_slug_unique").on(table.businessId, table.slug),
	pgPolicy("categories tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
]);

export const inventoryMovements = pgTable("inventory_movements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	productId: uuid("product_id").notNull(),
	change: integer().notNull(),
	reason: text().notNull(),
	referenceId: uuid("reference_id"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
}, (table) => [
	index("inventory_movements_product_idx").using("btree", table.productId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "inventory_movements_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "inventory_movements_product_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("inventory_movements tenant insert", { as: "permissive", for: "insert", to: ["app_user"], withCheck: sql`is_business_member(business_id)`  }),
	pgPolicy("inventory_movements tenant read", { as: "permissive", for: "select", to: ["app_user"] }),
]);

export const conversations = pgTable("conversations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	customerId: uuid("customer_id").notNull(),
	channel: text().default('telegram').notNull(),
	telegramChatId: text("telegram_chat_id"),
	mode: conversationMode().default('ai').notNull(),
	assignedMemberId: uuid("assigned_member_id"),
	lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastMessagePreview: text("last_message_preview"),
	unreadCount: integer("unread_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
}, (table) => [
	index("conversations_business_chat_idx").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.telegramChatId.asc().nullsLast().op("uuid_ops")),
	index("conversations_channel_idx").using("btree", table.channel.asc().nullsLast().op("text_ops")),
	index("conversations_customer_idx").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")),
	index("conversations_last_message_idx").using("btree", table.lastMessageAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_conversations_business").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.assignedMemberId],
			foreignColumns: [businessMembers.id],
			name: "conversations_assigned_member_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "conversations_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "conversations_customer_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("conversations tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
]);

export const messages = pgTable("messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	conversationId: uuid("conversation_id").notNull(),
	role: messageRole().notNull(),
	content: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
	memberId: uuid("member_id"),
	metadata: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
}, (table) => [
	index("idx_messages_business").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("messages_conversation_created_idx").using("btree", table.conversationId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("messages_conversation_idx").using("btree", table.conversationId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "messages_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "messages_conversation_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.memberId],
			foreignColumns: [businessMembers.id],
			name: "messages_member_id_fkey"
		}).onDelete("set null"),
	pgPolicy("messages tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
]);

export const leadEvents = pgTable("lead_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	leadId: uuid("lead_id").notNull(),
	eventType: text("event_type").notNull(),
	detail: text(),
	actor: text().default('ai').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
}, (table) => [
	index("lead_events_lead_idx").using("btree", table.leadId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "lead_events_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.leadId],
			foreignColumns: [leads.id],
			name: "lead_events_lead_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("lead_events tenant insert", { as: "permissive", for: "insert", to: ["app_user"], withCheck: sql`is_business_member(business_id)`  }),
	pgPolicy("lead_events tenant read", { as: "permissive", for: "select", to: ["app_user"] }),
]);

export const instagramEvents = pgTable("instagram_events", {
	mid: text().primaryKey().notNull(),
	payload: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("instagram_events admin read", { as: "permissive", for: "select", to: ["app_user"], using: sql`is_super_admin()` }),
]);

export const crmConfigs = pgTable("crm_configs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	industry: text().notNull(),
	businessDescription: text("business_description"),
	config: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "crm_configs_business_id_fkey"
		}).onDelete("cascade"),
	unique("crm_configs_business_id_key").on(table.businessId),
	pgPolicy("crm_configs admin delete", { as: "permissive", for: "delete", to: ["app_user"], using: sql`is_business_admin(business_id)` }),
	pgPolicy("crm_configs admin update", { as: "permissive", for: "update", to: ["app_user"] }),
	pgPolicy("crm_configs admin insert", { as: "permissive", for: "insert", to: ["app_user"] }),
	pgPolicy("crm_configs member read", { as: "permissive", for: "select", to: ["app_user"] }),
]);

export const crmRecords = pgTable("crm_records", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	moduleKey: text("module_key").notNull(),
	title: text().notNull(),
	stage: text(),
	data: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("crm_records_module_idx").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.moduleKey.asc().nullsLast().op("uuid_ops")),
	index("crm_records_stage_idx").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.stage.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "crm_records_business_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("crm_records tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
]);

export const leads = pgTable("leads", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	customerId: uuid("customer_id").notNull(),
	conversationId: uuid("conversation_id"),
	source: text().default('telegram').notNull(),
	requestedProduct: text("requested_product"),
	productId: uuid("product_id"),
	budget: text(),
	location: text(),
	phone: text(),
	score: leadScore().default('cold').notNull(),
	status: leadStatus().default('new').notNull(),
	assignedMemberId: uuid("assigned_member_id"),
	aiSummary: text("ai_summary"),
	handoffReason: text("handoff_reason"),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
	value: numeric().default('0').notNull(),
	nextAction: text("next_action"),
	stage: text(),
	lastContactAt: timestamp("last_contact_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_leads_business").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("leads_business_customer_status_idx").using("btree", table.businessId.asc().nullsLast().op("enum_ops"), table.customerId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("leads_business_stage_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.stage.asc().nullsLast().op("uuid_ops")),
	index("leads_created_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("leads_customer_idx").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("leads_open_dedup_uidx").using("btree", sql`business_id`, sql`customer_id`, sql`COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uu`).where(sql`(status <> ALL (ARRAY['won'::lead_status, 'lost'::lead_status]))`),
	index("leads_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.assignedMemberId],
			foreignColumns: [businessMembers.id],
			name: "leads_assigned_member_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "leads_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "leads_conversation_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "leads_customer_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "leads_product_id_fkey"
		}).onDelete("set null"),
	pgPolicy("leads tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
]);

export const tasks = pgTable("tasks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
	title: text().notNull(),
	description: text(),
	assignedMemberId: uuid("assigned_member_id"),
	customerId: uuid("customer_id"),
	leadId: uuid("lead_id"),
	orderId: uuid("order_id"),
	dueDate: date("due_date"),
	priority: text().default('medium').notNull(),
	status: text().default('pending').notNull(),
	createdBy: uuid("created_by"),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("tasks_business_status_idx").using("btree", table.businessId.asc().nullsLast().op("date_ops"), table.status.asc().nullsLast().op("uuid_ops"), table.dueDate.asc().nullsLast().op("text_ops")),
	index("tasks_customer_idx").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.assignedMemberId],
			foreignColumns: [businessMembers.id],
			name: "tasks_assigned_member_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "tasks_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "tasks_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "tasks_customer_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.leadId],
			foreignColumns: [leads.id],
			name: "tasks_lead_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "tasks_order_id_fkey"
		}).onDelete("set null"),
	pgPolicy("Business members manage tasks", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
]);

export const activities = pgTable("activities", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
	entityType: text("entity_type").notNull(),
	entityId: uuid("entity_id"),
	customerId: uuid("customer_id"),
	action: text().notNull(),
	detail: text(),
	actor: text().default('staff').notNull(),
	actorUserId: uuid("actor_user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("activities_business_created_idx").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("activities_customer_idx").using("btree", table.customerId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.actorUserId],
			foreignColumns: [user.id],
			name: "activities_actor_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "activities_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "activities_customer_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("Business members write activities", { as: "permissive", for: "insert", to: ["app_user"], withCheck: sql`is_business_member(business_id)`  }),
	pgPolicy("Business members read activities", { as: "permissive", for: "select", to: ["app_user"] }),
]);

export const telegramLinkRequests = pgTable("telegram_link_requests", {
	code: text().primaryKey().notNull(),
	telegramUserId: text("telegram_user_id").notNull(),
	telegramChatId: text("telegram_chat_id").notNull(),
	telegramUsername: text("telegram_username"),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).default(sql`(now() + '00:30:00'::interval)`).notNull(),
	consumedAt: timestamp("consumed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const platformAdmins = pgTable("platform_admins", {
	userId: uuid("user_id").primaryKey().notNull(),
	email: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "platform_admins_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("Super admins read platform admins", { as: "permissive", for: "select", to: ["app_user"], using: sql`is_super_admin()` }),
]);

export const profiles = pgTable("profiles", {
	id: uuid().primaryKey().notNull(),
	email: text(),
	fullName: text("full_name"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: text().default('active').notNull(),
	phone: text(),
	lastActiveAt: timestamp("last_active_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.id],
			foreignColumns: [user.id],
			name: "profiles_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("Super admins read all profiles", { as: "permissive", for: "select", to: ["app_user"], using: sql`is_super_admin()` }),
	pgPolicy("profiles self read", { as: "permissive", for: "select", to: ["app_user"] }),
	pgPolicy("profiles self update", { as: "permissive", for: "update", to: ["app_user"] }),
]);

export const auditLogs = pgTable("audit_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	actorUserId: uuid("actor_user_id"),
	actorEmail: text("actor_email"),
	actorKind: text("actor_kind").default('user').notNull(),
	action: text().notNull(),
	targetType: text("target_type"),
	targetId: text("target_id"),
	targetLabel: text("target_label"),
	businessId: uuid("business_id"),
	status: text().default('success').notNull(),
	ip: text(),
	metadata: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("audit_logs_action_idx").using("btree", table.action.asc().nullsLast().op("text_ops")),
	index("audit_logs_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("audit_logs_created_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("audit_logs_login_failed_idx").using("btree", table.action.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`(action = 'login_failed'::text)`),
	foreignKey({
			columns: [table.actorUserId],
			foreignColumns: [user.id],
			name: "audit_logs_actor_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "audit_logs_business_id_fkey"
		}).onDelete("set null"),
	pgPolicy("business admins read own medical audit logs", { as: "permissive", for: "select", to: ["app_user"], using: sql`((business_id IS NOT NULL) AND ("left"(action, 8) = 'medical.'::text) AND is_business_admin(business_id))` }),
	pgPolicy("Super admins read audit logs", { as: "permissive", for: "select", to: ["app_user"] }),
]);

export const aiUsageEvents = pgTable("ai_usage_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id"),
	userId: uuid("user_id"),
	feature: text().notNull(),
	model: text(),
	inputTokens: integer("input_tokens").default(0).notNull(),
	outputTokens: integer("output_tokens").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ai_usage_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("ai_usage_created_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "ai_usage_events_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "ai_usage_events_user_id_fkey"
		}).onDelete("set null"),
	pgPolicy("Members read their ai usage", { as: "permissive", for: "select", to: ["app_user"], using: sql`((business_id IS NOT NULL) AND is_business_member(business_id))` }),
	pgPolicy("Super admins read ai usage", { as: "permissive", for: "select", to: ["app_user"] }),
]);

export const systemSettings = pgTable("system_settings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	platformName: text("platform_name").default('KETA CRM').notNull(),
	supportEmail: text("support_email").default('keta.comp.dev@gmail.com').notNull(),
	supportPhone: text("support_phone").default('+998 77 763 02 16').notNull(),
	defaultTimezone: text("default_timezone").default('Asia/Tashkent').notNull(),
	defaultCurrency: text("default_currency").default('UZS').notNull(),
	maintenanceMode: boolean("maintenance_mode").default(false).notNull(),
	maintenanceMessage: text("maintenance_message"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("Everyone signed in reads system settings", { as: "permissive", for: "select", to: ["app_user"], using: sql`true` }),
]);

export const featureFlags = pgTable("feature_flags", {
	key: text().primaryKey().notNull(),
	label: text().notNull(),
	enabled: boolean().default(true).notNull(),
	targetPlan: text("target_plan"),
	targetBusinessId: uuid("target_business_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.targetBusinessId],
			foreignColumns: [businesses.id],
			name: "feature_flags_target_business_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("Signed in users read feature flags", { as: "permissive", for: "select", to: ["app_user"], using: sql`true` }),
]);

export const systemNotifications = pgTable("system_notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().notNull(),
	body: text().notNull(),
	kind: text().default('info').notNull(),
	targetKind: text("target_kind").default('all').notNull(),
	targetValue: text("target_value"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("system_notifications_created_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "system_notifications_created_by_fkey"
		}).onDelete("set null"),
	pgPolicy("Targeted users read system notifications", { as: "permissive", for: "select", to: ["app_user"], using: sql`(is_super_admin() OR (target_kind = 'all'::text) OR ((target_kind = 'organization'::text) AND (target_value ~ '^[0-9a-fA-F-]{36}$'::text) AND is_business_member((target_value)::uuid)) OR ((target_kind = 'plan'::text) AND (EXISTS ( SELECT 1
   FROM (business_members m
     JOIN businesses b ON ((b.id = m.business_id)))
  WHERE ((m.user_id = app.user_id()) AND (b.plan = system_notifications.target_value))))) OR ((target_kind = 'industry'::text) AND (EXISTS ( SELECT 1
   FROM (business_members m
     JOIN crm_configs c ON ((c.business_id = m.business_id)))
  WHERE ((m.user_id = app.user_id()) AND (c.industry = system_notifications.target_value))))))` }),
]);

export const orderItems = pgTable("order_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: uuid("order_id").notNull(),
	productId: uuid("product_id"),
	productName: text("product_name").notNull(),
	sku: text(),
	quantity: integer().default(1).notNull(),
	unitPrice: numeric("unit_price", { precision: 14, scale:  2 }).default('0').notNull(),
	lineTotal: numeric("line_total", { precision: 14, scale:  2 }).default('0').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
}, (table) => [
	index("order_items_order_idx").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "order_items_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "order_items_order_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "order_items_product_id_fkey"
		}).onDelete("set null"),
	pgPolicy("order_items tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
	check("order_items_line_total_non_negative", sql`line_total >= (0)::numeric)) NOT VALID`),
	check("order_items_quantity_positive", sql`quantity > 0)) NOT VALID`),
	check("order_items_unit_price_non_negative", sql`unit_price >= (0)::numeric)) NOT VALID`),
]);

export const products = pgTable("products", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sku: text().notNull(),
	name: text().notNull(),
	categoryId: uuid("category_id"),
	description: text().default('').notNull(),
	price: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	compareAtPrice: numeric("compare_at_price", { precision: 14, scale:  2 }),
	costPrice: numeric("cost_price", { precision: 14, scale:  2 }),
	stockQuantity: integer("stock_quantity").default(0).notNull(),
	reservedQuantity: integer("reserved_quantity").default(0).notNull(),
	lowStockThreshold: integer("low_stock_threshold").default(5).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	isArchived: boolean("is_archived").default(false).notNull(),
	images: jsonb().default([]).notNull(),
	specifications: jsonb().default({}).notNull(),
	tags: text().array().default([""]).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
}, (table) => [
	index("idx_products_business").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("products_active_idx").using("btree", table.isActive.asc().nullsLast().op("bool_ops"), table.isArchived.asc().nullsLast().op("bool_ops")),
	index("products_business_active_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.isActive.asc().nullsLast().op("uuid_ops"), table.isArchived.asc().nullsLast().op("uuid_ops")),
	index("products_category_idx").using("btree", table.categoryId.asc().nullsLast().op("uuid_ops")),
	index("products_name_idx").using("gin", sql`to_tsvector('simple'::regconfig, ((name || ' '::text) || descri`),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "products_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.id],
			name: "products_category_id_fkey"
		}).onDelete("set null"),
	unique("products_business_sku_unique").on(table.businessId, table.sku),
	pgPolicy("products tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
	check("products_price_non_negative", sql`price >= (0)::numeric)) NOT VALID`),
	check("products_reserved_non_negative", sql`reserved_quantity >= 0)) NOT VALID`),
	check("products_stock_non_negative", sql`stock_quantity >= 0)) NOT VALID`),
]);

export const orders = pgTable("orders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderNumber: text("order_number").default(sql`(\'ORD-\'::text || (nextval(\'order_number_seq\'::regclass))::text)`).notNull(),
	customerId: uuid("customer_id").notNull(),
	leadId: uuid("lead_id"),
	conversationId: uuid("conversation_id"),
	status: orderStatus().default('new').notNull(),
	paymentStatus: paymentStatus("payment_status").default('unpaid').notNull(),
	total: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	deliveryAddress: text("delivery_address"),
	phone: text(),
	notes: text(),
	assignedMemberId: uuid("assigned_member_id"),
	stockApplied: boolean("stock_applied").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
	discount: numeric().default('0').notNull(),
}, (table) => [
	index("idx_orders_business").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("orders_business_created_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("orders_created_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("orders_customer_idx").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")),
	index("orders_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.assignedMemberId],
			foreignColumns: [businessMembers.id],
			name: "orders_assigned_member_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "orders_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "orders_conversation_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "orders_customer_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.leadId],
			foreignColumns: [leads.id],
			name: "orders_lead_id_fkey"
		}).onDelete("set null"),
	unique("orders_order_number_key").on(table.orderNumber),
	pgPolicy("orders tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
	check("orders_total_non_negative", sql`total >= (0)::numeric)) NOT VALID`),
]);

export const payments = pgTable("payments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
	customerId: uuid("customer_id"),
	orderId: uuid("order_id"),
	amount: numeric().default('0').notNull(),
	method: text().default('cash').notNull(),
	status: text().default('pending').notNull(),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	dueDate: date("due_date"),
	note: text(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	data: jsonb().default({}).notNull(),
	appointmentId: uuid("appointment_id"),
	groupId: uuid("group_id"),
	periodMonth: text("period_month"),
}, (table) => [
	index("payments_appointment_idx").using("btree", table.appointmentId.asc().nullsLast().op("uuid_ops")),
	index("payments_business_paid_idx").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.paidAt.desc().nullsFirst().op("timestamptz_ops")),
	index("payments_business_status_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	index("payments_customer_idx").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")),
	index("payments_group_period_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.groupId.asc().nullsLast().op("text_ops"), table.periodMonth.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("payments_group_tuition_uniq").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.groupId.asc().nullsLast().op("uuid_ops"), table.customerId.asc().nullsLast().op("text_ops"), table.periodMonth.asc().nullsLast().op("uuid_ops")).where(sql`((group_id IS NOT NULL) AND (period_month IS NOT NULL) AND (status = 'pending'::text))`),
	index("payments_order_idx").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "payments_appointment_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "payments_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "payments_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "payments_customer_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [studyGroups.id],
			name: "payments_group_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "payments_order_id_fkey"
		}).onDelete("set null"),
	pgPolicy("Business members manage payments", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
	check("payments_amount_positive", sql`amount > (0)::numeric)) NOT VALID`),
	check("payments_period_month_check", sql`(period_month IS NULL) OR (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text)`),
]);

export const workSchedules = pgTable("work_schedules", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	employeeId: uuid("employee_id").notNull(),
	weekday: smallint().notNull(),
	startTime: time("start_time").notNull(),
	endTime: time("end_time").notNull(),
	breakStart: time("break_start"),
	breakEnd: time("break_end"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_work_schedules_business").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("work_schedules_employee_weekday").using("btree", table.employeeId.asc().nullsLast().op("int2_ops"), table.weekday.asc().nullsLast().op("int2_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "work_schedules_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "work_schedules_employee_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("work_schedules tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
	check("work_schedules_check", sql`end_time > start_time`),
	check("work_schedules_weekday_check", sql`(weekday >= 1) AND (weekday <= 7)`),
]);

export const timeOff = pgTable("time_off", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	employeeId: uuid("employee_id").notNull(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'string' }).notNull(),
	reason: text().default('').notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_time_off_business").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("idx_time_off_employee_range").using("btree", table.employeeId.asc().nullsLast().op("timestamptz_ops"), table.startsAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "time_off_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "time_off_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "time_off_employee_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("time_off tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
	check("time_off_check", sql`ends_at > starts_at`),
]);

export const services = pgTable("services", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	name: text().notNull(),
	durationMinutes: integer("duration_minutes").default(30).notNull(),
	price: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	depositType: text("deposit_type").default('none').notNull(),
	depositValue: numeric("deposit_value", { precision: 14, scale:  2 }).default('0').notNull(),
}, (table) => [
	index("idx_services_business_active").using("btree", table.businessId.asc().nullsLast().op("bool_ops"), table.isActive.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "services_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "services_created_by_fkey"
		}).onDelete("set null"),
	pgPolicy("services tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
	check("services_deposit_type_check", sql`deposit_type = ANY (ARRAY['none'::text, 'fixed'::text, 'percent'::text])`),
	check("services_deposit_value_check", sql`deposit_value >= (0)::numeric`),
	check("services_duration_minutes_check", sql`(duration_minutes > 0) AND (duration_minutes <= 1440)`),
	check("services_name_check", sql`char_length(TRIM(BOTH FROM name)) > 0`),
	check("services_price_check", sql`price >= (0)::numeric`),
]);

export const branches = pgTable("branches", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	name: text().notNull(),
	address: text().default('').notNull(),
	phone: text().default('').notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("branches_business_name").using("btree", sql`business_id`, sql`lower(name)`),
	index("idx_branches_business").using("btree", table.businessId.asc().nullsLast().op("bool_ops"), table.isActive.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "branches_business_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("branches tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
	check("branches_name_check", sql`char_length(TRIM(BOTH FROM name)) > 0`),
]);

export const expenses = pgTable("expenses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
	category: text().default('other').notNull(),
	amount: numeric({ precision: 14, scale:  2 }).notNull(),
	expenseDate: date("expense_date").default(sql`CURRENT_DATE`).notNull(),
	paymentMethod: text("payment_method").default('cash').notNull(),
	note: text().default('').notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	branchId: uuid("branch_id"),
}, (table) => [
	index("idx_expenses_business_branch").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.branchId.asc().nullsLast().op("uuid_ops")),
	index("idx_expenses_business_category").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.category.asc().nullsLast().op("text_ops")),
	index("idx_expenses_business_date").using("btree", table.businessId.asc().nullsLast().op("date_ops"), table.expenseDate.desc().nullsFirst().op("date_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "expenses_branch_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "expenses_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "expenses_created_by_fkey"
		}).onDelete("set null"),
	pgPolicy("expenses tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`(is_business_member(business_id) AND branch_access_ok(business_id, branch_id))`, withCheck: sql`(is_business_member(business_id) AND branch_access_ok(business_id, branch_id))`  }),
	check("expenses_amount_check", sql`amount > (0)::numeric`),
]);

export const cashSessions = pgTable("cash_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
	status: text().default('open').notNull(),
	openedBy: uuid("opened_by"),
	closedBy: uuid("closed_by"),
	openedAt: timestamp("opened_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	closedAt: timestamp("closed_at", { withTimezone: true, mode: 'string' }),
	openingAmount: numeric("opening_amount", { precision: 14, scale:  2 }).default('0').notNull(),
	cashIncome: numeric("cash_income", { precision: 14, scale:  2 }),
	cashExpense: numeric("cash_expense", { precision: 14, scale:  2 }),
	expectedCash: numeric("expected_cash", { precision: 14, scale:  2 }),
	countedAmount: numeric("counted_amount", { precision: 14, scale:  2 }),
	difference: numeric({ precision: 14, scale:  2 }),
	note: text().default('').notNull(),
	branchId: uuid("branch_id"),
}, (table) => [
	uniqueIndex("cash_sessions_one_open").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'open'::text)`),
	index("idx_cash_sessions_business_opened").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.openedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "cash_sessions_branch_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "cash_sessions_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.closedBy],
			foreignColumns: [user.id],
			name: "cash_sessions_closed_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.openedBy],
			foreignColumns: [user.id],
			name: "cash_sessions_opened_by_fkey"
		}).onDelete("set null"),
	pgPolicy("cash_sessions tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`(is_business_member(business_id) AND branch_access_ok(business_id, branch_id))`, withCheck: sql`(is_business_member(business_id) AND branch_access_ok(business_id, branch_id))`  }),
	check("cash_sessions_opening_amount_check", sql`opening_amount >= (0)::numeric`),
	check("cash_sessions_status_check", sql`status = ANY (ARRAY['open'::text, 'closed'::text])`),
]);

export const businessMembers = pgTable("business_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: appRole().default('admin').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	branchId: uuid("branch_id"),
}, (table) => [
	index("idx_business_members_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "business_members_branch_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "business_members_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "business_members_user_id_fkey"
		}).onDelete("cascade"),
	unique("business_members_business_id_user_id_key").on(table.businessId, table.userId),
	pgPolicy("members admin delete", { as: "permissive", for: "delete", to: ["app_user"], using: sql`is_business_admin(business_id)` }),
	pgPolicy("members admin update", { as: "permissive", for: "update", to: ["app_user"] }),
	pgPolicy("members read own business", { as: "permissive", for: "select", to: ["app_user"] }),
]);

export const employees = pgTable("employees", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	userId: uuid("user_id"),
	fullName: text("full_name").notNull(),
	position: text().default('').notNull(),
	phone: text().default('').notNull(),
	email: text().default('').notNull(),
	hiredOn: date("hired_on"),
	isActive: boolean("is_active").default(true).notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	branchId: uuid("branch_id"),
}, (table) => [
	uniqueIndex("employees_business_user").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(user_id IS NOT NULL)`),
	index("idx_employees_business_active").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.isActive.asc().nullsLast().op("bool_ops")),
	index("idx_employees_business_branch").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.branchId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "employees_branch_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "employees_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "employees_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "employees_user_id_fkey"
		}).onDelete("set null"),
	pgPolicy("employees tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
	check("employees_full_name_check", sql`char_length(TRIM(BOTH FROM full_name)) > 0`),
]);

export const appointments = pgTable("appointments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	serviceId: uuid("service_id"),
	customerId: uuid("customer_id"),
	employeeId: uuid("employee_id"),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'string' }).notNull(),
	status: text().default('new').notNull(),
	note: text().default('').notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	branchId: uuid("branch_id"),
	serviceName: text("service_name"),
	price: numeric({ precision: 14, scale:  2 }),
	durationMinutes: integer("duration_minutes"),
	data: jsonb().default({}).notNull(),
	depositAmount: numeric("deposit_amount", { precision: 14, scale:  2 }),
	depositPaidAmount: numeric("deposit_paid_amount", { precision: 14, scale:  2 }),
	depositPaidAt: timestamp("deposit_paid_at", { withTimezone: true, mode: 'string' }),
	depositMethod: text("deposit_method").default('').notNull(),
	depositRefundedAt: timestamp("deposit_refunded_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_appointments_business_branch").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.branchId.asc().nullsLast().op("uuid_ops"), table.startsAt.asc().nullsLast().op("uuid_ops")),
	index("idx_appointments_business_start").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.startsAt.asc().nullsLast().op("uuid_ops")),
	index("idx_appointments_business_status").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops")),
	index("idx_appointments_deposit_pending").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.startsAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((deposit_amount > (0)::numeric) AND (deposit_paid_at IS NULL))`),
	index("idx_appointments_employee").using("btree", table.employeeId.asc().nullsLast().op("timestamptz_ops"), table.startsAt.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "appointments_branch_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "appointments_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "appointments_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "appointments_customer_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "appointments_employee_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.serviceId],
			foreignColumns: [services.id],
			name: "appointments_service_id_fkey"
		}).onDelete("set null"),
	pgPolicy("appointments tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`(is_business_member(business_id) AND branch_access_ok(business_id, branch_id))`, withCheck: sql`(is_business_member(business_id) AND branch_access_ok(business_id, branch_id))`  }),
	check("appointments_check", sql`ends_at > starts_at`),
	check("appointments_deposit_amount_check", sql`(deposit_amount IS NULL) OR (deposit_amount >= (0)::numeric)`),
	check("appointments_deposit_paid_amount_check", sql`(deposit_paid_amount IS NULL) OR (deposit_paid_amount >= (0)::numeric)`),
	check("appointments_deposit_state", sql`((deposit_refunded_at IS NULL) AND (deposit_paid_at IS NULL) AND (deposit_paid_amount IS NULL)) OR ((deposit_refunded_at IS NULL) AND (deposit_paid_at IS NOT NULL) AND (deposit_paid_amount IS NOT NULL)) OR (deposit_refunded_at IS NOT NULL)`),
	check("appointments_duration_minutes_check", sql`(duration_minutes > 0) AND (duration_minutes <= 1440)`),
	check("appointments_price_check", sql`price >= (0)::numeric`),
	check("appointments_status_check", sql`status = ANY (ARRAY['new'::text, 'confirmed'::text, 'arrived'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text])`),
]);

export const bookingRequests = pgTable("booking_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	phone: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_booking_requests_business_phone_time").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.phone.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "booking_requests_business_id_fkey"
		}).onDelete("cascade"),
]);

export const payrollRules = pgTable("payroll_rules", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	employeeId: uuid("employee_id").notNull(),
	baseSalary: numeric("base_salary", { precision: 14, scale:  2 }).default('0').notNull(),
	commissionPercent: numeric("commission_percent", { precision: 5, scale:  2 }).default('0').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_payroll_rules_business").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "payroll_rules_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "payroll_rules_employee_id_fkey"
		}).onDelete("cascade"),
	unique("payroll_rules_employee_id_key").on(table.employeeId),
	pgPolicy("payroll_rules tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
	check("payroll_rules_base_salary_check", sql`base_salary >= (0)::numeric`),
	check("payroll_rules_commission_percent_check", sql`(commission_percent >= (0)::numeric) AND (commission_percent <= (100)::numeric)`),
]);

export const telegramLinks = pgTable("telegram_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	telegramUserId: text("telegram_user_id").notNull(),
	telegramChatId: text("telegram_chat_id").notNull(),
	telegramUsername: text("telegram_username"),
	userId: uuid("user_id").notNull(),
	businessId: uuid("business_id").notNull(),
	status: text().default('active').notNull(),
	dailyReports: boolean("daily_reports").default(true).notNull(),
	reportTime: text("report_time").default('21:00').notNull(),
	timezone: text().default('Asia/Tashkent').notNull(),
	lastReportDate: date("last_report_date"),
	notifyNewOrder: boolean("notify_new_order").default(true).notNull(),
	notifyPayment: boolean("notify_payment").default(true).notNull(),
	notifyLead: boolean("notify_lead").default(true).notNull(),
	notifyLowStock: boolean("notify_low_stock").default(false).notNull(),
	linkedAt: timestamp("linked_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	notifyBooking: boolean("notify_booking").default(true).notNull(),
}, (table) => [
	index("telegram_links_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("telegram_links_daily_idx").using("btree", table.dailyReports.asc().nullsLast().op("text_ops"), table.reportTime.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "telegram_links_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "telegram_links_user_id_fkey"
		}).onDelete("cascade"),
	unique("telegram_links_telegram_user_id_key").on(table.telegramUserId),
	pgPolicy("Members manage their business telegram links", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
]);

export const payrollStatements = pgTable("payroll_statements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	employeeId: uuid("employee_id").notNull(),
	periodStart: date("period_start").notNull(),
	periodEnd: date("period_end").notNull(),
	serviceRevenue: numeric("service_revenue", { precision: 14, scale:  2 }).default('0').notNull(),
	baseAmount: numeric("base_amount", { precision: 14, scale:  2 }).default('0').notNull(),
	commissionAmount: numeric("commission_amount", { precision: 14, scale:  2 }).default('0').notNull(),
	bonusAmount: numeric("bonus_amount", { precision: 14, scale:  2 }).default('0').notNull(),
	advanceAmount: numeric("advance_amount", { precision: 14, scale:  2 }).default('0').notNull(),
	deductionAmount: numeric("deduction_amount", { precision: 14, scale:  2 }).default('0').notNull(),
	totalComputed: numeric("total_computed", { precision: 14, scale:  2 }).default('0').notNull(),
	totalPaid: numeric("total_paid", { precision: 14, scale:  2 }).default('0').notNull(),
	status: text().default('draft').notNull(),
	approvedBy: uuid("approved_by"),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	note: text().default('').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expenseId: uuid("expense_id"),
	paidMethod: text("paid_method").default('cash').notNull(),
}, (table) => [
	index("idx_payroll_statements_business_period").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.periodStart.asc().nullsLast().op("date_ops")),
	index("idx_payroll_statements_expense").using("btree", table.expenseId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.approvedBy],
			foreignColumns: [user.id],
			name: "payroll_statements_approved_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "payroll_statements_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "payroll_statements_employee_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.expenseId],
			foreignColumns: [expenses.id],
			name: "payroll_statements_expense_id_fkey"
		}).onDelete("set null"),
	unique("payroll_statement_period").on(table.businessId, table.employeeId, table.periodStart),
	pgPolicy("payroll_statements tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
	check("payroll_statements_advance_amount_check", sql`advance_amount >= (0)::numeric`),
	check("payroll_statements_base_amount_check", sql`base_amount >= (0)::numeric`),
	check("payroll_statements_bonus_amount_check", sql`bonus_amount >= (0)::numeric`),
	check("payroll_statements_check", sql`period_end >= period_start`),
	check("payroll_statements_commission_amount_check", sql`commission_amount >= (0)::numeric`),
	check("payroll_statements_deduction_amount_check", sql`deduction_amount >= (0)::numeric`),
	check("payroll_statements_service_revenue_check", sql`service_revenue >= (0)::numeric`),
	check("payroll_statements_status_check", sql`status = ANY (ARRAY['draft'::text, 'approved'::text, 'paid'::text])`),
	check("payroll_statements_total_paid_check", sql`total_paid >= (0)::numeric`),
]);

export const customers = pgTable("customers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	telegramUserId: text("telegram_user_id"),
	telegramUsername: text("telegram_username"),
	fullName: text("full_name"),
	phone: text(),
	location: text(),
	notes: text(),
	totalOrders: integer("total_orders").default(0).notNull(),
	totalSpent: numeric("total_spent", { precision: 14, scale:  2 }).default('0').notNull(),
	lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
	instagramUserId: text("instagram_user_id"),
	email: text(),
	status: text().default('active').notNull(),
	source: text().default('manual').notNull(),
	assignedMemberId: uuid("assigned_member_id"),
	lastContactAt: timestamp("last_contact_at", { withTimezone: true, mode: 'string' }),
	marketingConsent: boolean("marketing_consent").default(false).notNull(),
	consentUpdatedAt: timestamp("consent_updated_at", { withTimezone: true, mode: 'string' }),
	erasedAt: timestamp("erased_at", { withTimezone: true, mode: 'string' }),
	erasedBy: uuid("erased_by"),
}, (table) => [
	index("customers_business_source_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.source.asc().nullsLast().op("uuid_ops")),
	index("customers_business_status_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("customers_business_tg_user_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.telegramUserId.asc().nullsLast().op("uuid_ops")).where(sql`(telegram_user_id IS NOT NULL)`),
	uniqueIndex("customers_instagram_user_uidx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.instagramUserId.asc().nullsLast().op("text_ops")).where(sql`(instagram_user_id IS NOT NULL)`),
	index("customers_last_interaction_idx").using("btree", table.lastInteractionAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_customers_business").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("idx_customers_business_erased").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.erasedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.assignedMemberId],
			foreignColumns: [businessMembers.id],
			name: "customers_assigned_member_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "customers_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.erasedBy],
			foreignColumns: [user.id],
			name: "customers_erased_by_fkey"
		}).onDelete("set null"),
	unique("customers_business_telegram_unique").on(table.businessId, table.telegramUserId),
	pgPolicy("customers tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
]);

export const errorEvents = pgTable("error_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	fingerprint: text().notNull(),
	bucket: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	level: text().default('error').notNull(),
	route: text().default('').notNull(),
	message: text().default('').notNull(),
	detail: text().default('').notNull(),
	statusCode: integer("status_code"),
	businessId: uuid("business_id"),
	userId: uuid("user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_error_events_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_error_events_route").using("btree", table.route.asc().nullsLast().op("text_ops")),
	unique("error_events_fingerprint_bucket_key").on(table.bucket, table.fingerprint),
	check("error_events_level_check", sql`level = ANY (ARRAY['error'::text, 'warning'::text])`),
]);

export const businessSettings = pgTable("business_settings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessName: text("business_name").default('My Store').notNull(),
	businessDescription: text("business_description").default('').notNull(),
	workingHours: text("working_hours").default('09:00 - 20:00').notNull(),
	deliveryInfo: text("delivery_info").default('').notNull(),
	paymentMethods: text("payment_methods").default('').notNull(),
	returnPolicy: text("return_policy").default('').notNull(),
	currency: text().default('UZS').notNull(),
	staffGroupChatId: text("staff_group_chat_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
	phone: text().default('').notNull(),
	logoPath: text("logo_path").default('').notNull(),
}, (table) => [
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "business_settings_business_id_fkey"
		}).onDelete("cascade"),
	unique("business_settings_business_unique").on(table.businessId),
	pgPolicy("business_settings admin write", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_admin(business_id)`, withCheck: sql`is_business_admin(business_id)`  }),
	pgPolicy("business_settings member read", { as: "permissive", for: "select", to: ["app_user"] }),
]);

export const leadAssignments = pgTable("lead_assignments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	leadId: uuid("lead_id").notNull(),
	memberId: uuid("member_id").notNull(),
	assignedBy: uuid("assigned_by"),
	assignedAt: timestamp("assigned_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	businessId: uuid("business_id").default(sql`current_business_id()`).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.memberId],
			foreignColumns: [businessMembers.id],
			name: "lead_assignments_member_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "operator_assignments_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.leadId],
			foreignColumns: [leads.id],
			name: "operator_assignments_lead_id_fkey"
		}).onDelete("cascade"),
	unique("operator_assignments_lead_id_operator_id_key").on(table.leadId, table.memberId),
	pgPolicy("operator_assignments tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
]);

export const businesses = pgTable("businesses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ownerId: uuid("owner_id").notNull(),
	name: text().default('My Business').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: text().default('active').notNull(),
	plan: text().default('free').notNull(),
	suspendedAt: timestamp("suspended_at", { withTimezone: true, mode: 'string' }),
	suspendReason: text("suspend_reason"),
	bookingSlug: text("booking_slug"),
	bookingEnabled: boolean("booking_enabled").default(true).notNull(),
	trialEndsAt: timestamp("trial_ends_at", { withTimezone: true, mode: 'string' }),
	subscriptionEndsAt: timestamp("subscription_ends_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_businesses_trial_ends_at").using("btree", table.trialEndsAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [user.id],
			name: "businesses_owner_id_fkey"
		}).onDelete("cascade"),
	unique("businesses_booking_slug_key").on(table.bookingSlug),
	pgPolicy("Super admins read all businesses", { as: "permissive", for: "select", to: ["app_user"], using: sql`is_super_admin()` }),
	pgPolicy("businesses owner update", { as: "permissive", for: "update", to: ["app_user"] }),
	pgPolicy("businesses member read", { as: "permissive", for: "select", to: ["app_user"] }),
	check("businesses_booking_slug_check", sql`booking_slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'::text`),
	check("businesses_plan_check", sql`plan = ANY (ARRAY['free'::text, 'start'::text, 'pro'::text, 'max'::text])`),
]);

export const billingInvoices = pgTable("billing_invoices", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	invoiceNo: bigserial("invoice_no", { mode: "bigint" }).notNull(),
	plan: text().notNull(),
	amount: numeric({ precision: 14, scale:  2 }).notNull(),
	provider: text().notNull(),
	status: text().default('pending').notNull(),
	providerTxnId: text("provider_txn_id"),
	providerState: integer("provider_state"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	providerTime: bigint("provider_time", { mode: "number" }),
	performTime: timestamp("perform_time", { withTimezone: true, mode: 'string' }),
	cancelTime: timestamp("cancel_time", { withTimezone: true, mode: 'string' }),
	cancelReason: integer("cancel_reason"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("billing_invoices_invoice_no_key").using("btree", table.invoiceNo.asc().nullsLast().op("int8_ops")),
	uniqueIndex("billing_invoices_provider_txn_key").using("btree", table.provider.asc().nullsLast().op("text_ops"), table.providerTxnId.asc().nullsLast().op("text_ops")).where(sql`(provider_txn_id IS NOT NULL)`),
	index("idx_billing_invoices_business").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "billing_invoices_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "billing_invoices_created_by_fkey"
		}).onDelete("set null"),
	pgPolicy("billing_invoices owner insert", { as: "permissive", for: "insert", to: ["app_user"], withCheck: sql`is_business_member(business_id)`  }),
	pgPolicy("billing_invoices tenant read", { as: "permissive", for: "select", to: ["app_user"] }),
	check("billing_invoices_amount_check", sql`amount >= (0)::numeric`),
	check("billing_invoices_status_check", sql`status = ANY (ARRAY['pending'::text, 'paid'::text, 'cancelled'::text, 'refunded'::text])`),
]);

export const notificationReads = pgTable("notification_reads", {
	userId: uuid("user_id").notNull(),
	notificationId: uuid("notification_id").notNull(),
	readAt: timestamp("read_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("notification_reads_notification_idx").using("btree", table.notificationId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.notificationId],
			foreignColumns: [systemNotifications.id],
			name: "notification_reads_notification_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "notification_reads_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.notificationId, table.userId], name: "notification_reads_pkey"}),
	pgPolicy("own notification reads insert", { as: "permissive", for: "insert", to: ["app_user"], withCheck: sql`(user_id = app.user_id())`  }),
	pgPolicy("own notification reads select", { as: "permissive", for: "select", to: ["app_user"] }),
	pgPolicy("own notification reads delete", { as: "permissive", for: "delete", to: ["app_user"] }),
]);

export const telegramUpdates = pgTable("telegram_updates", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	updateId: bigint("update_id", { mode: "number" }).notNull(),
	payload: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	businessId: uuid("business_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "telegram_updates_business_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.businessId, table.updateId], name: "telegram_updates_pkey"}),
	pgPolicy("telegram_updates tenant read", { as: "permissive", for: "select", to: ["app_user"], using: sql`is_business_member(business_id)` }),
]);

export const employeeServices = pgTable("employee_services", {
	employeeId: uuid("employee_id").notNull(),
	serviceId: uuid("service_id").notNull(),
	businessId: uuid("business_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	commissionPercent: numeric("commission_percent", { precision: 5, scale:  2 }),
}, (table) => [
	index("idx_employee_services_business").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "employee_services_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "employee_services_employee_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.serviceId],
			foreignColumns: [services.id],
			name: "employee_services_service_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.employeeId, table.serviceId], name: "employee_services_pkey"}),
	pgPolicy("employee_services tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
	check("employee_services_commission_percent_check", sql`(commission_percent >= (0)::numeric) AND (commission_percent <= (100)::numeric)`),
]);

export const groupMembers = pgTable("group_members", {
	groupId: uuid("group_id").notNull(),
	studentId: uuid("student_id").notNull(),
	businessId: uuid("business_id").notNull(),
	monthlyPrice: numeric("monthly_price", { precision: 14, scale:  2 }),
	status: text().default('active').notNull(),
	joinedAt: timestamp("joined_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("group_members_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("group_members_student_idx").using("btree", table.studentId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "group_members_business_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [studyGroups.id],
			name: "group_members_group_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.studentId],
			foreignColumns: [customers.id],
			name: "group_members_student_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.groupId, table.studentId], name: "group_members_pkey"}),
	pgPolicy("group_members tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`(is_business_member(business_id) AND branch_access_ok(business_id, NULL::uuid))`, withCheck: sql`(is_business_member(business_id) AND branch_access_ok(business_id, NULL::uuid))`  }),
	check("group_members_monthly_price_check", sql`(monthly_price IS NULL) OR (monthly_price >= (0)::numeric)`),
	check("group_members_status_check", sql`status = ANY (ARRAY['active'::text, 'archived'::text])`),
]);

export const storageObjects = pgTable("storage_objects", {
	bucket: text().notNull(),
	path: text().notNull(),
	businessId: uuid("business_id").notNull(),
	contentType: text("content_type").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sizeBytes: bigint("size_bytes", { mode: "number" }).default(0).notNull(),
		data: bytea("data").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("storage_objects_business_idx").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.businessId],
			foreignColumns: [businesses.id],
			name: "storage_objects_business_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.bucket, table.path], name: "storage_objects_pkey"}),
	pgPolicy("storage_objects tenant", { as: "permissive", for: "all", to: ["app_user"], using: sql`is_business_member(business_id)`, withCheck: sql`is_business_member(business_id)`  }),
	check("storage_objects_bucket_check", sql`bucket = ANY (ARRAY['branding'::text, 'crm_attachments'::text])`),
]);

// drizzle-kit introspect neon_auth sxemasini chiqarmaydi, ammo public jadvallaridagi
// tashqi kalitlar shu jadvalga qaraydi. Blok qo'lda yozilgan (Better Auth sxemasi).
// schema.ts uni user deb, relations.ts esa generator beradigan userInNeonAuth deb
// ataydi — ikkala nom bir jadvalga qaraydi.
const neonAuth = pgSchema("neon_auth");
export const user = neonAuth.table("user", {
  id: uuid().primaryKey().notNull(),
  name: text().notNull(),
  email: text().notNull(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  role: text(),
  banned: boolean(),
  banReason: text(),
  banExpires: timestamp("banExpires", { withTimezone: true, mode: "string" }),
});
export const userInNeonAuth = user;
