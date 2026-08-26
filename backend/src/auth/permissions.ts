import { ActorContext } from './actor.middleware.js';

export type PermissionScope = 'FULL' | 'OWN' | 'ASSIGNED' | 'READ' | 'INITIATE' | 'APPROVE' | 'NONE';
export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'RECEPTIONIST' | 'ARTIST' | 'CLIENT';

/**
 * Permission matrix for Phase 1.
 * Each action maps to a record of role → scope.
 * Scope semantics:
 *   FULL      – can perform the action unconditionally.
 *   OWN       – can perform on resources they own (ownerId === actor.actorId or accountId).
 *   ASSIGNED  – can perform on resources they are assigned to (assignedId === actor.actorId).
 *   READ      – read-only access (view, not modify).
 *   INITIATE  – may create a request but not approve/execute financial outcome.
 *   APPROVE   – may approve/execute a controlled financial or operational action.
 *   NONE      – no access.
 */
export const permissionMatrix: Record<string, Partial<Record<Role, PermissionScope>>> = {
  // ---- Appointments, Availability & Manual Assignment ----
  view_booking_calendar: {
    RECEPTIONIST: 'FULL',
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
    ARTIST: 'OWN',
    CLIENT: 'OWN',
  },
  create_booking_for_client: {
    RECEPTIONIST: 'FULL',
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
    CLIENT: 'OWN',
  },
  reschedule_cancel_booking: {
    RECEPTIONIST: 'FULL',
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
    CLIENT: 'OWN',
  },
  check_in_client: {
    RECEPTIONIST: 'FULL',
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
  },
  mark_no_show: {
    RECEPTIONIST: 'FULL',
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
  },
  manual_auto_assign_team: {
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
  },
  change_assigned_artist_team: {
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
  },

  // ---- Client Data ----
  view_client_basic_profile: {
    RECEPTIONIST: 'FULL',
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
    ARTIST: 'ASSIGNED',
    CLIENT: 'OWN',
  },
  view_full_consultation_history: {
    RECEPTIONIST: 'READ',
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
    ARTIST: 'ASSIGNED',
    CLIENT: 'OWN',
  },
  create_update_consultation: {
    ARTIST: 'ASSIGNED',
  },
  sign_high_risk_service_consent: {
    RECEPTIONIST: 'READ',
    ADMIN: 'READ',
    SUPER_ADMIN: 'READ',
    ARTIST: 'READ',
    CLIENT: 'OWN',
  },

  // ---- Service Execution ----
  start_complete_service_session: {
    ARTIST: 'ASSIGNED',
  },
  add_service_product_to_open_bill: {
    RECEPTIONIST: 'FULL',
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
    ARTIST: 'ASSIGNED',
  },
  close_finalize_invoice: {
    RECEPTIONIST: 'FULL',
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
  },
  view_reprint_closed_invoice: {
    RECEPTIONIST: 'FULL',
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
    CLIENT: 'OWN',
  },
  edit_closed_invoice_financial_values: {}, // NONE for all
  approve_refund: {
    ADMIN: 'APPROVE',
    SUPER_ADMIN: 'APPROVE',
    CLIENT: 'INITIATE', // client can request
  },

  // ---- Expenses ----
  record_daily_expense: {
    RECEPTIONIST: 'INITIATE',
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
  },
  approve_reject_expense: {
    ADMIN: 'APPROVE',
    SUPER_ADMIN: 'APPROVE',
  },

  // ---- Artist Management ----
  change_artist_revenue_split: {
    RECEPTIONIST: 'FULL',
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
    ARTIST: 'READ', // artist can see their own result
  },
  manage_artists_eligibility: {
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
    ARTIST: 'READ', // artist can view own eligibility
  },
  manage_artist_shift_day_off: {
    RECEPTIONIST: 'READ',
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
    ARTIST: 'READ', // own schedule
  },
  create_sudden_unavailability_exception: {
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
  },
  suggested_slot_content_override: {
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
  },

  // ---- Products / Inventory ----
  manage_products_inventory: {
    RECEPTIONIST: 'READ', // ops read
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
    ARTIST: 'READ', // artist can read/use products
    CLIENT: 'READ', // client can browse retail
  },

  // ---- Finance Reports ----
  view_finance_reports: {
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
    ARTIST: 'READ', // own performance
  },

  // ---- Settings ----
  manage_tax_payment_invoice_settings: {
    SUPER_ADMIN: 'FULL',
  },

  // ---- User Management ----
  manage_staff_users_roles: {
    SUPER_ADMIN: 'FULL',
  },
  view_audit_logs: {
    ADMIN: 'READ', // scoped
    SUPER_ADMIN: 'FULL',
  },

  // ---- Memberships ----
  sell_assign_membership: {
    RECEPTIONIST: 'FULL',
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
    CLIENT: 'OWN', // client purchase for self
  },
  add_remove_membership_member: {
    RECEPTIONIST: 'FULL',
    ADMIN: 'FULL',
    SUPER_ADMIN: 'FULL',
  },
  manual_wallet_membership_balance_adjustment: {
    ADMIN: 'APPROVE',
    SUPER_ADMIN: 'APPROVE',
  },
  change_membership_price_credit_value: {
    SUPER_ADMIN: 'FULL',
  },

  // ---- Staff Auth ----
  view_fixed_staff_role_structure: {
    RECEPTIONIST: 'READ',
    ADMIN: 'READ',
    SUPER_ADMIN: 'FULL',
  },
  create_staff_user: { SUPER_ADMIN: 'FULL' },
  assign_change_staff_role: { SUPER_ADMIN: 'FULL' },
  deactivate_staff_account: { SUPER_ADMIN: 'FULL' },
  reset_other_staff_credential: { SUPER_ADMIN: 'FULL' },
  view_manage_active_staff_sessions: { SUPER_ADMIN: 'FULL' },
  security_access_configuration: { SUPER_ADMIN: 'FULL' },
  system_backup_configuration: { SUPER_ADMIN: 'FULL' },
};

/**
 * Check if an actor has a given permission.
 * @param action – the action key (e.g., 'view_booking_calendar')
 * @param actor – the authenticated actor context
 * @param resource – optional resource context for scope checks:
 *   - ownerId: the ID of the owner of the resource (for OWN scope)
 *   - assignedId: the ID of the artist/staff assigned to the resource (for ASSIGNED scope)
 * @returns true if the actor is allowed, false otherwise
 */
export function can(
  action: string,
  actor: ActorContext,
  resource?: { ownerId?: string; assignedId?: string }
): boolean {
  const entry = permissionMatrix[action];
  if (!entry) {
    // Unknown action – default deny.
    return false;
  }

  const scope = entry[actor.role as Role];
  if (!scope || scope === 'NONE') {
    return false;
  }

  // FULL – unconditional allow.
  if (scope === 'FULL') {
    return true;
  }

  // READ – allow read-only actions.
  if (scope === 'READ') {
    return true;
  }

  // INITIATE – allow creation of requests (e.g., expense, refund request).
  if (scope === 'INITIATE') {
    return true;
  }

  // APPROVE – allow approval actions.
  if (scope === 'APPROVE') {
    return true;
  }

  // OWN – require resource.ownerId to match actor.actorId or actor.accountId.
  if (scope === 'OWN') {
    if (!resource) return false;
    const owner = resource.ownerId;
    return !!owner && (owner === actor.actorId || owner === actor.accountId);
  }

  // ASSIGNED – require resource.assignedId to match actor.actorId.
  if (scope === 'ASSIGNED') {
    if (!resource) return false;
    const assigned = resource.assignedId;
    return !!assigned && assigned === actor.actorId;
  }

  return false;
}

/**
 * Create a permission check for a specific action.
 * Useful for middleware composition.
 */
export function createPermissionCheck(action: string) {
  return (actor: ActorContext, resource?: { ownerId?: string; assignedId?: string }) =>
    can(action, actor, resource);
}