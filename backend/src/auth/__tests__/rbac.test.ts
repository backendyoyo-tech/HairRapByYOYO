import { describe, it, expect } from 'vitest';
import { ActorContext } from '../actor.middleware.js';
import { can } from '../permissions.js';

// Helper to create a mock actor
function actor(role: string, actorId = 'actor-1', accountId = 'account-1'): ActorContext {
  return {
    accountId,
    actorType: 'STAFF' as any,
    actorId,
    role,
    accountType: 'STAFF' as any,
    sessionId: 'session-1',
  };
}

describe('RBAC permissions', () => {
  describe('view_booking_calendar', () => {
    it('should allow RECEPTIONIST, ADMIN, SUPER_ADMIN', () => {
      expect(can('view_booking_calendar', actor('RECEPTIONIST'))).toBe(true);
      expect(can('view_booking_calendar', actor('ADMIN'))).toBe(true);
      expect(can('view_booking_calendar', actor('SUPER_ADMIN'))).toBe(true);
    });

    it('should allow ARTIST only for OWN schedule', () => {
      // Without resource, OWN scope returns false.
      expect(can('view_booking_calendar', actor('ARTIST'))).toBe(false);
      // With resource where they are the owner.
      expect(can('view_booking_calendar', actor('ARTIST', 'artist-1'), { ownerId: 'artist-1' })).toBe(true);
      expect(can('view_booking_calendar', actor('ARTIST'), { ownerId: 'other' })).toBe(false);
    });

    it('should allow CLIENT only for OWN bookings', () => {
      expect(can('view_booking_calendar', actor('CLIENT'))).toBe(false);
      expect(can('view_booking_calendar', actor('CLIENT', 'client-1'), { ownerId: 'client-1' })).toBe(true);
      expect(can('view_booking_calendar', actor('CLIENT'), { ownerId: 'other' })).toBe(false);
    });
  });

  describe('create_booking_for_client', () => {
    it('should allow RECEPTIONIST, ADMIN, SUPER_ADMIN, CLIENT', () => {
      expect(can('create_booking_for_client', actor('RECEPTIONIST'))).toBe(true);
      expect(can('create_booking_for_client', actor('ADMIN'))).toBe(true);
      expect(can('create_booking_for_client', actor('SUPER_ADMIN'))).toBe(true);
      // CLIENT has OWN scope – needs resource.
      expect(can('create_booking_for_client', actor('CLIENT'))).toBe(false);
      expect(can('create_booking_for_client', actor('CLIENT', 'client-1'), { ownerId: 'client-1' })).toBe(true);
    });

    it('should deny ARTIST', () => {
      expect(can('create_booking_for_client', actor('ARTIST'))).toBe(false);
    });
  });

  describe('approve_refund', () => {
    it('should allow ADMIN, SUPER_ADMIN to approve', () => {
      expect(can('approve_refund', actor('ADMIN'))).toBe(true);
      expect(can('approve_refund', actor('SUPER_ADMIN'))).toBe(true);
    });

    it('should allow CLIENT to initiate', () => {
      expect(can('approve_refund', actor('CLIENT'))).toBe(true); // INITIATE allows
    });

    it('should deny RECEPTIONIST, ARTIST', () => {
      expect(can('approve_refund', actor('RECEPTIONIST'))).toBe(false);
      expect(can('approve_refund', actor('ARTIST'))).toBe(false);
    });
  });

  describe('manage_staff_users_roles', () => {
    it('should allow only SUPER_ADMIN', () => {
      expect(can('manage_staff_users_roles', actor('SUPER_ADMIN'))).toBe(true);
      expect(can('manage_staff_users_roles', actor('ADMIN'))).toBe(false);
      expect(can('manage_staff_users_roles', actor('RECEPTIONIST'))).toBe(false);
      expect(can('manage_staff_users_roles', actor('ARTIST'))).toBe(false);
      expect(can('manage_staff_users_roles', actor('CLIENT'))).toBe(false);
    });
  });

  describe('unknown action', () => {
    it('should deny unknown actions', () => {
      expect(can('unknown_action', actor('SUPER_ADMIN'))).toBe(false);
    });
  });
});