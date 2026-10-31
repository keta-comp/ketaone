import { relations } from "drizzle-orm/relations";
import { userInNeonAuth, userRoles, businesses, studyGroups, services, employees, attendance, profiles, customers, aiSettings, categories, inventoryMovements, products, businessMembers, conversations, messages, leadEvents, leads, crmConfigs, crmRecords, tasks, orders, activities, platformAdmins, auditLogs, aiUsageEvents, featureFlags, systemNotifications, orderItems, appointments, payments, workSchedules, timeOff, branches, expenses, cashSessions, bookingRequests, payrollRules, telegramLinks, payrollStatements, businessSettings, leadAssignments, billingInvoices, notificationReads, telegramUpdates, employeeServices, groupMembers, storageObjects } from "./schema";

export const userRolesRelations = relations(userRoles, ({one}) => ({
	userInNeonAuth: one(userInNeonAuth, {
		fields: [userRoles.userId],
		references: [userInNeonAuth.id]
	}),
}));

export const userInNeonAuthRelations = relations(userInNeonAuth, ({many}) => ({
	userRoles: many(userRoles),
	tasks: many(tasks),
	activities: many(activities),
	platformAdmins: many(platformAdmins),
	profiles: many(profiles),
	auditLogs: many(auditLogs),
	aiUsageEvents: many(aiUsageEvents),
	systemNotifications: many(systemNotifications),
	payments: many(payments),
	timeOffs: many(timeOff),
	services: many(services),
	expenses: many(expenses),
	cashSessions_closedBy: many(cashSessions, {
		relationName: "cashSessions_closedBy_userInNeonAuth_id"
	}),
	cashSessions_openedBy: many(cashSessions, {
		relationName: "cashSessions_openedBy_userInNeonAuth_id"
	}),
	businessMembers: many(businessMembers),
	employees: many(employees),
	appointments: many(appointments),
	telegramLinks: many(telegramLinks),
	payrollStatements: many(payrollStatements),
	customers: many(customers),
	businesses: many(businesses),
	billingInvoices: many(billingInvoices),
	notificationReads: many(notificationReads),
}));

export const studyGroupsRelations = relations(studyGroups, ({one, many}) => ({
	business: one(businesses, {
		fields: [studyGroups.businessId],
		references: [businesses.id]
	}),
	service: one(services, {
		fields: [studyGroups.courseId],
		references: [services.id]
	}),
	employee: one(employees, {
		fields: [studyGroups.teacherId],
		references: [employees.id]
	}),
	attendances: many(attendance),
	payments: many(payments),
	groupMembers: many(groupMembers),
}));

export const businessesRelations = relations(businesses, ({one, many}) => ({
	studyGroups: many(studyGroups),
	attendances: many(attendance),
	aiSettings: many(aiSettings),
	categories: many(categories),
	inventoryMovements: many(inventoryMovements),
	conversations: many(conversations),
	messages: many(messages),
	leadEvents: many(leadEvents),
	crmConfigs: many(crmConfigs),
	crmRecords: many(crmRecords),
	leads: many(leads),
	tasks: many(tasks),
	activities: many(activities),
	auditLogs: many(auditLogs),
	aiUsageEvents: many(aiUsageEvents),
	featureFlags: many(featureFlags),
	orderItems: many(orderItems),
	products: many(products),
	orders: many(orders),
	payments: many(payments),
	workSchedules: many(workSchedules),
	timeOffs: many(timeOff),
	services: many(services),
	branches: many(branches),
	expenses: many(expenses),
	cashSessions: many(cashSessions),
	businessMembers: many(businessMembers),
	employees: many(employees),
	appointments: many(appointments),
	bookingRequests: many(bookingRequests),
	payrollRules: many(payrollRules),
	telegramLinks: many(telegramLinks),
	payrollStatements: many(payrollStatements),
	customers: many(customers),
	businessSettings: many(businessSettings),
	leadAssignments: many(leadAssignments),
	userInNeonAuth: one(userInNeonAuth, {
		fields: [businesses.ownerId],
		references: [userInNeonAuth.id]
	}),
	billingInvoices: many(billingInvoices),
	telegramUpdates: many(telegramUpdates),
	employeeServices: many(employeeServices),
	groupMembers: many(groupMembers),
	storageObjects: many(storageObjects),
}));

export const servicesRelations = relations(services, ({one, many}) => ({
	studyGroups: many(studyGroups),
	business: one(businesses, {
		fields: [services.businessId],
		references: [businesses.id]
	}),
	userInNeonAuth: one(userInNeonAuth, {
		fields: [services.createdBy],
		references: [userInNeonAuth.id]
	}),
	appointments: many(appointments),
	employeeServices: many(employeeServices),
}));

export const employeesRelations = relations(employees, ({one, many}) => ({
	studyGroups: many(studyGroups),
	workSchedules: many(workSchedules),
	timeOffs: many(timeOff),
	branch: one(branches, {
		fields: [employees.branchId],
		references: [branches.id]
	}),
	business: one(businesses, {
		fields: [employees.businessId],
		references: [businesses.id]
	}),
	userInNeonAuth: one(userInNeonAuth, {
		fields: [employees.createdBy],
		references: [userInNeonAuth.id]
	}),
	profile: one(profiles, {
		fields: [employees.userId],
		references: [profiles.id]
	}),
	appointments: many(appointments),
	payrollRules: many(payrollRules),
	payrollStatements: many(payrollStatements),
	employeeServices: many(employeeServices),
}));

export const attendanceRelations = relations(attendance, ({one}) => ({
	business: one(businesses, {
		fields: [attendance.businessId],
		references: [businesses.id]
	}),
	studyGroup: one(studyGroups, {
		fields: [attendance.groupId],
		references: [studyGroups.id]
	}),
	profile: one(profiles, {
		fields: [attendance.markedBy],
		references: [profiles.id]
	}),
	customer: one(customers, {
		fields: [attendance.studentId],
		references: [customers.id]
	}),
}));

export const profilesRelations = relations(profiles, ({one, many}) => ({
	attendances: many(attendance),
	userInNeonAuth: one(userInNeonAuth, {
		fields: [profiles.id],
		references: [userInNeonAuth.id]
	}),
	employees: many(employees),
}));

export const customersRelations = relations(customers, ({one, many}) => ({
	attendances: many(attendance),
	conversations: many(conversations),
	leads: many(leads),
	tasks: many(tasks),
	activities: many(activities),
	orders: many(orders),
	payments: many(payments),
	appointments: many(appointments),
	businessMember: one(businessMembers, {
		fields: [customers.assignedMemberId],
		references: [businessMembers.id]
	}),
	business: one(businesses, {
		fields: [customers.businessId],
		references: [businesses.id]
	}),
	userInNeonAuth: one(userInNeonAuth, {
		fields: [customers.erasedBy],
		references: [userInNeonAuth.id]
	}),
	groupMembers: many(groupMembers),
}));

export const aiSettingsRelations = relations(aiSettings, ({one}) => ({
	business: one(businesses, {
		fields: [aiSettings.businessId],
		references: [businesses.id]
	}),
}));

export const categoriesRelations = relations(categories, ({one, many}) => ({
	business: one(businesses, {
		fields: [categories.businessId],
		references: [businesses.id]
	}),
	products: many(products),
}));

export const inventoryMovementsRelations = relations(inventoryMovements, ({one}) => ({
	business: one(businesses, {
		fields: [inventoryMovements.businessId],
		references: [businesses.id]
	}),
	product: one(products, {
		fields: [inventoryMovements.productId],
		references: [products.id]
	}),
}));

export const productsRelations = relations(products, ({one, many}) => ({
	inventoryMovements: many(inventoryMovements),
	leads: many(leads),
	orderItems: many(orderItems),
	business: one(businesses, {
		fields: [products.businessId],
		references: [businesses.id]
	}),
	category: one(categories, {
		fields: [products.categoryId],
		references: [categories.id]
	}),
}));

export const conversationsRelations = relations(conversations, ({one, many}) => ({
	businessMember: one(businessMembers, {
		fields: [conversations.assignedMemberId],
		references: [businessMembers.id]
	}),
	business: one(businesses, {
		fields: [conversations.businessId],
		references: [businesses.id]
	}),
	customer: one(customers, {
		fields: [conversations.customerId],
		references: [customers.id]
	}),
	messages: many(messages),
	leads: many(leads),
	orders: many(orders),
}));

export const businessMembersRelations = relations(businessMembers, ({one, many}) => ({
	conversations: many(conversations),
	messages: many(messages),
	leads: many(leads),
	tasks: many(tasks),
	orders: many(orders),
	branch: one(branches, {
		fields: [businessMembers.branchId],
		references: [branches.id]
	}),
	business: one(businesses, {
		fields: [businessMembers.businessId],
		references: [businesses.id]
	}),
	userInNeonAuth: one(userInNeonAuth, {
		fields: [businessMembers.userId],
		references: [userInNeonAuth.id]
	}),
	customers: many(customers),
	leadAssignments: many(leadAssignments),
}));

export const messagesRelations = relations(messages, ({one}) => ({
	business: one(businesses, {
		fields: [messages.businessId],
		references: [businesses.id]
	}),
	conversation: one(conversations, {
		fields: [messages.conversationId],
		references: [conversations.id]
	}),
	businessMember: one(businessMembers, {
		fields: [messages.memberId],
		references: [businessMembers.id]
	}),
}));

export const leadEventsRelations = relations(leadEvents, ({one}) => ({
	business: one(businesses, {
		fields: [leadEvents.businessId],
		references: [businesses.id]
	}),
	lead: one(leads, {
		fields: [leadEvents.leadId],
		references: [leads.id]
	}),
}));

export const leadsRelations = relations(leads, ({one, many}) => ({
	leadEvents: many(leadEvents),
	businessMember: one(businessMembers, {
		fields: [leads.assignedMemberId],
		references: [businessMembers.id]
	}),
	business: one(businesses, {
		fields: [leads.businessId],
		references: [businesses.id]
	}),
	conversation: one(conversations, {
		fields: [leads.conversationId],
		references: [conversations.id]
	}),
	customer: one(customers, {
		fields: [leads.customerId],
		references: [customers.id]
	}),
	product: one(products, {
		fields: [leads.productId],
		references: [products.id]
	}),
	tasks: many(tasks),
	orders: many(orders),
	leadAssignments: many(leadAssignments),
}));

export const crmConfigsRelations = relations(crmConfigs, ({one}) => ({
	business: one(businesses, {
		fields: [crmConfigs.businessId],
		references: [businesses.id]
	}),
}));

export const crmRecordsRelations = relations(crmRecords, ({one}) => ({
	business: one(businesses, {
		fields: [crmRecords.businessId],
		references: [businesses.id]
	}),
}));

export const tasksRelations = relations(tasks, ({one}) => ({
	businessMember: one(businessMembers, {
		fields: [tasks.assignedMemberId],
		references: [businessMembers.id]
	}),
	business: one(businesses, {
		fields: [tasks.businessId],
		references: [businesses.id]
	}),
	userInNeonAuth: one(userInNeonAuth, {
		fields: [tasks.createdBy],
		references: [userInNeonAuth.id]
	}),
	customer: one(customers, {
		fields: [tasks.customerId],
		references: [customers.id]
	}),
	lead: one(leads, {
		fields: [tasks.leadId],
		references: [leads.id]
	}),
	order: one(orders, {
		fields: [tasks.orderId],
		references: [orders.id]
	}),
}));

export const ordersRelations = relations(orders, ({one, many}) => ({
	tasks: many(tasks),
	orderItems: many(orderItems),
	businessMember: one(businessMembers, {
		fields: [orders.assignedMemberId],
		references: [businessMembers.id]
	}),
	business: one(businesses, {
		fields: [orders.businessId],
		references: [businesses.id]
	}),
	conversation: one(conversations, {
		fields: [orders.conversationId],
		references: [conversations.id]
	}),
	customer: one(customers, {
		fields: [orders.customerId],
		references: [customers.id]
	}),
	lead: one(leads, {
		fields: [orders.leadId],
		references: [leads.id]
	}),
	payments: many(payments),
}));

export const activitiesRelations = relations(activities, ({one}) => ({
	userInNeonAuth: one(userInNeonAuth, {
		fields: [activities.actorUserId],
		references: [userInNeonAuth.id]
	}),
	business: one(businesses, {
		fields: [activities.businessId],
		references: [businesses.id]
	}),
	customer: one(customers, {
		fields: [activities.customerId],
		references: [customers.id]
	}),
}));

export const platformAdminsRelations = relations(platformAdmins, ({one}) => ({
	userInNeonAuth: one(userInNeonAuth, {
		fields: [platformAdmins.userId],
		references: [userInNeonAuth.id]
	}),
}));

export const auditLogsRelations = relations(auditLogs, ({one}) => ({
	userInNeonAuth: one(userInNeonAuth, {
		fields: [auditLogs.actorUserId],
		references: [userInNeonAuth.id]
	}),
	business: one(businesses, {
		fields: [auditLogs.businessId],
		references: [businesses.id]
	}),
}));

export const aiUsageEventsRelations = relations(aiUsageEvents, ({one}) => ({
	business: one(businesses, {
		fields: [aiUsageEvents.businessId],
		references: [businesses.id]
	}),
	userInNeonAuth: one(userInNeonAuth, {
		fields: [aiUsageEvents.userId],
		references: [userInNeonAuth.id]
	}),
}));

export const featureFlagsRelations = relations(featureFlags, ({one}) => ({
	business: one(businesses, {
		fields: [featureFlags.targetBusinessId],
		references: [businesses.id]
	}),
}));

export const systemNotificationsRelations = relations(systemNotifications, ({one, many}) => ({
	userInNeonAuth: one(userInNeonAuth, {
		fields: [systemNotifications.createdBy],
		references: [userInNeonAuth.id]
	}),
	notificationReads: many(notificationReads),
}));

export const orderItemsRelations = relations(orderItems, ({one}) => ({
	business: one(businesses, {
		fields: [orderItems.businessId],
		references: [businesses.id]
	}),
	order: one(orders, {
		fields: [orderItems.orderId],
		references: [orders.id]
	}),
	product: one(products, {
		fields: [orderItems.productId],
		references: [products.id]
	}),
}));

export const paymentsRelations = relations(payments, ({one}) => ({
	appointment: one(appointments, {
		fields: [payments.appointmentId],
		references: [appointments.id]
	}),
	business: one(businesses, {
		fields: [payments.businessId],
		references: [businesses.id]
	}),
	userInNeonAuth: one(userInNeonAuth, {
		fields: [payments.createdBy],
		references: [userInNeonAuth.id]
	}),
	customer: one(customers, {
		fields: [payments.customerId],
		references: [customers.id]
	}),
	studyGroup: one(studyGroups, {
		fields: [payments.groupId],
		references: [studyGroups.id]
	}),
	order: one(orders, {
		fields: [payments.orderId],
		references: [orders.id]
	}),
}));

export const appointmentsRelations = relations(appointments, ({one, many}) => ({
	payments: many(payments),
	branch: one(branches, {
		fields: [appointments.branchId],
		references: [branches.id]
	}),
	business: one(businesses, {
		fields: [appointments.businessId],
		references: [businesses.id]
	}),
	userInNeonAuth: one(userInNeonAuth, {
		fields: [appointments.createdBy],
		references: [userInNeonAuth.id]
	}),
	customer: one(customers, {
		fields: [appointments.customerId],
		references: [customers.id]
	}),
	employee: one(employees, {
		fields: [appointments.employeeId],
		references: [employees.id]
	}),
	service: one(services, {
		fields: [appointments.serviceId],
		references: [services.id]
	}),
}));

export const workSchedulesRelations = relations(workSchedules, ({one}) => ({
	business: one(businesses, {
		fields: [workSchedules.businessId],
		references: [businesses.id]
	}),
	employee: one(employees, {
		fields: [workSchedules.employeeId],
		references: [employees.id]
	}),
}));

export const timeOffRelations = relations(timeOff, ({one}) => ({
	business: one(businesses, {
		fields: [timeOff.businessId],
		references: [businesses.id]
	}),
	userInNeonAuth: one(userInNeonAuth, {
		fields: [timeOff.createdBy],
		references: [userInNeonAuth.id]
	}),
	employee: one(employees, {
		fields: [timeOff.employeeId],
		references: [employees.id]
	}),
}));

export const branchesRelations = relations(branches, ({one, many}) => ({
	business: one(businesses, {
		fields: [branches.businessId],
		references: [businesses.id]
	}),
	expenses: many(expenses),
	cashSessions: many(cashSessions),
	businessMembers: many(businessMembers),
	employees: many(employees),
	appointments: many(appointments),
}));

export const expensesRelations = relations(expenses, ({one, many}) => ({
	branch: one(branches, {
		fields: [expenses.branchId],
		references: [branches.id]
	}),
	business: one(businesses, {
		fields: [expenses.businessId],
		references: [businesses.id]
	}),
	userInNeonAuth: one(userInNeonAuth, {
		fields: [expenses.createdBy],
		references: [userInNeonAuth.id]
	}),
	payrollStatements: many(payrollStatements),
}));

export const cashSessionsRelations = relations(cashSessions, ({one}) => ({
	branch: one(branches, {
		fields: [cashSessions.branchId],
		references: [branches.id]
	}),
	business: one(businesses, {
		fields: [cashSessions.businessId],
		references: [businesses.id]
	}),
	userInNeonAuth_closedBy: one(userInNeonAuth, {
		fields: [cashSessions.closedBy],
		references: [userInNeonAuth.id],
		relationName: "cashSessions_closedBy_userInNeonAuth_id"
	}),
	userInNeonAuth_openedBy: one(userInNeonAuth, {
		fields: [cashSessions.openedBy],
		references: [userInNeonAuth.id],
		relationName: "cashSessions_openedBy_userInNeonAuth_id"
	}),
}));

export const bookingRequestsRelations = relations(bookingRequests, ({one}) => ({
	business: one(businesses, {
		fields: [bookingRequests.businessId],
		references: [businesses.id]
	}),
}));

export const payrollRulesRelations = relations(payrollRules, ({one}) => ({
	business: one(businesses, {
		fields: [payrollRules.businessId],
		references: [businesses.id]
	}),
	employee: one(employees, {
		fields: [payrollRules.employeeId],
		references: [employees.id]
	}),
}));

export const telegramLinksRelations = relations(telegramLinks, ({one}) => ({
	business: one(businesses, {
		fields: [telegramLinks.businessId],
		references: [businesses.id]
	}),
	userInNeonAuth: one(userInNeonAuth, {
		fields: [telegramLinks.userId],
		references: [userInNeonAuth.id]
	}),
}));

export const payrollStatementsRelations = relations(payrollStatements, ({one}) => ({
	userInNeonAuth: one(userInNeonAuth, {
		fields: [payrollStatements.approvedBy],
		references: [userInNeonAuth.id]
	}),
	business: one(businesses, {
		fields: [payrollStatements.businessId],
		references: [businesses.id]
	}),
	employee: one(employees, {
		fields: [payrollStatements.employeeId],
		references: [employees.id]
	}),
	expense: one(expenses, {
		fields: [payrollStatements.expenseId],
		references: [expenses.id]
	}),
}));

export const businessSettingsRelations = relations(businessSettings, ({one}) => ({
	business: one(businesses, {
		fields: [businessSettings.businessId],
		references: [businesses.id]
	}),
}));

export const leadAssignmentsRelations = relations(leadAssignments, ({one}) => ({
	businessMember: one(businessMembers, {
		fields: [leadAssignments.memberId],
		references: [businessMembers.id]
	}),
	business: one(businesses, {
		fields: [leadAssignments.businessId],
		references: [businesses.id]
	}),
	lead: one(leads, {
		fields: [leadAssignments.leadId],
		references: [leads.id]
	}),
}));

export const billingInvoicesRelations = relations(billingInvoices, ({one}) => ({
	business: one(businesses, {
		fields: [billingInvoices.businessId],
		references: [businesses.id]
	}),
	userInNeonAuth: one(userInNeonAuth, {
		fields: [billingInvoices.createdBy],
		references: [userInNeonAuth.id]
	}),
}));

export const notificationReadsRelations = relations(notificationReads, ({one}) => ({
	systemNotification: one(systemNotifications, {
		fields: [notificationReads.notificationId],
		references: [systemNotifications.id]
	}),
	userInNeonAuth: one(userInNeonAuth, {
		fields: [notificationReads.userId],
		references: [userInNeonAuth.id]
	}),
}));

export const telegramUpdatesRelations = relations(telegramUpdates, ({one}) => ({
	business: one(businesses, {
		fields: [telegramUpdates.businessId],
		references: [businesses.id]
	}),
}));

export const employeeServicesRelations = relations(employeeServices, ({one}) => ({
	business: one(businesses, {
		fields: [employeeServices.businessId],
		references: [businesses.id]
	}),
	employee: one(employees, {
		fields: [employeeServices.employeeId],
		references: [employees.id]
	}),
	service: one(services, {
		fields: [employeeServices.serviceId],
		references: [services.id]
	}),
}));

export const groupMembersRelations = relations(groupMembers, ({one}) => ({
	business: one(businesses, {
		fields: [groupMembers.businessId],
		references: [businesses.id]
	}),
	studyGroup: one(studyGroups, {
		fields: [groupMembers.groupId],
		references: [studyGroups.id]
	}),
	customer: one(customers, {
		fields: [groupMembers.studentId],
		references: [customers.id]
	}),
}));

export const storageObjectsRelations = relations(storageObjects, ({one}) => ({
	business: one(businesses, {
		fields: [storageObjects.businessId],
		references: [businesses.id]
	}),
}));