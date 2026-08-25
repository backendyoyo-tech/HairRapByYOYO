import assert from 'node:assert';
import { describe, it } from 'node:test';
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
      assert.ok(can('view_booking_calendar', actor('RECEPTIONIST')));
      assert.ok(can('view_booking_calendar', actor('ADMIN')));
      assert.ok(can('view_booking_calendar', actor('SUPER_ADMIN')));
    });

    it('should allow ARTIST only for OWN schedule', () => {
      // Without resource, OWN scope returns false.
      assert.ok(!can('view_booking_calendar', actor('ARTIST')));
      // With resource where they are the owner.
      assert.ok(can('view_booking_calendar', actor('ARTIST', 'artist-1'), { ownerId: 'artist-1' }));
      assert.ok(!can('view_booking_calendar', actor('ARTIST'), { ownerId: 'other' }));
    });

    it('should allow CLIENT only for OWN bookings', () => {
      assert.ok(!can('view_booking_calendar', actor('CLIENT')));
      assert.ok(can('view_booking_calendar', actor('CLIENT', 'client-1'), { ownerId: 'client-1' }));
      assert.ok(!can('view_booking_calendar', actor('CLIENT'), { ownerId: 'other' }));
    });
  });

  describe('create_booking_for_client', () => {
    it('should allow RECEPTIONIST, ADMIN, SUPER_ADMIN, CLIENT', () => {
      assert.ok(can('create_booking_for_client', actor('RECEPTIONIST')));
      assert.ok(can('create_booking_for_client', actor('ADMIN')));
      assert.ok(can('create_booking_for_client', actor('SUPER_ADMIN')));
      // CLIENT has OWN scope – needs resource.
      assert.ok(!can('create_booking_for_client', actor('CLIENT')));
      assert.ok(can('create_booking_for_client', actor('CLIENT', 'client-1'), { ownerId: 'client-1' }));
    });

    it('should deny ARTIST', () => {
      assert.ok(!can('create_booking_for_client', actor('ARTIST')));
    });
  });

  describe('approve_refund', () => {
    it('should allow ADMIN, SUPER_ADMIN to approve', () => {
      assert.ok(can('approve_refund', actor('ADMIN')));
      assert.ok(can('approve_refund', actor('SUPER_ADMIN')));
    });

    it('should allow CLIENT to initiate', () => {
      assert.ok(can('approve_refund', actor('CLIENT'))); // INITIATE allows
    });

    it('should deny RECEPTIONIST, ARTIST', () => {
      assert.ok(!can('approve_refund', actor('RECEPTIONIST')));
      assert.ok(!can('approve_refund', actor('ARTIST')));
    });
  });

  describe('manage_staff_users_roles', () => {
    it('should allow only SUPER_ADMIN', () => {
      assert.ok(can('manage_staff_users_roles', actor('SUPER_ADMIN')));
      assert.ok(!can('manage_staff_users_roles', actor('ADMIN')));
      assert.ok(!can('manage_staff_users_roles', actor('RECEPTIONIST')));
      assert.ok(!can('manage_staff_users_roles', actor('ARTIST')));
      assert.ok(!can('manage_staff_users_roles', actor('CLIENT')));
    });
  });

  describe('unknown action', () => {
    it('should deny unknown actions', () => {
      assert.ok(!can('unknown_action', actor('SUPER_ADMIN')));
    });
  });
});