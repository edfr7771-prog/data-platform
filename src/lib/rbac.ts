/** الصلاحيات: دالة نقية بلا اعتماديات، تُفرَض في الخلفية (route handlers والصفحات)، وإخفاء الزر وحده ليس حماية. */
export type Role = 'super_admin' | 'org_admin' | 'data_analyst' | 'broker' | 'employee' | 'investor' | 'student' | 'viewer';
export type Action = 'property:read' | 'property:write' | 'property:delete' | 'property:export' | 'import:run' | 'audit:read' | 'org:manage' | 'request:read' | 'request:write' | 'analytics:read';

const MATRIX: Record<Action, Role[]> = {
  'property:read': ['org_admin', 'data_analyst', 'broker', 'employee', 'investor', 'viewer'],
  'property:write': ['org_admin', 'data_analyst', 'broker', 'employee'],
  'property:delete': ['org_admin', 'data_analyst'],
  'property:export': ['org_admin', 'data_analyst'],
  'import:run': ['org_admin', 'data_analyst'],
  'audit:read': ['org_admin'],
  'org:manage': ['org_admin'],
  // Phase 2: الطلبات بنفس صلاحيات العقارات، والتحليلات قراءة لكل من يقرأ العقارات (الطالب لا)
  'request:read': ['org_admin', 'data_analyst', 'broker', 'employee', 'investor', 'viewer'],
  'request:write': ['org_admin', 'data_analyst', 'broker', 'employee'],
  'analytics:read': ['org_admin', 'data_analyst', 'broker', 'employee', 'investor', 'viewer'],
};

/** super_admin دور منصة لا دور مؤسسة: لا يمنح وصولًا تلقائيًا لبيانات أي مؤسسة (أقل صلاحية). */
export const can = (role: Role | null | undefined, action: Action): boolean => !!role && MATRIX[action].includes(role);
export const ACTIONS = Object.keys(MATRIX) as Action[];
export const ORG_ROLES: Role[] = ['org_admin', 'data_analyst', 'broker', 'employee', 'investor', 'student', 'viewer'];
