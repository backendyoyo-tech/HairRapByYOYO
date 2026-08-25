import { NextFunction, Request, Response } from 'express';
import { AppError } from '../shared/errors/app-error.js';
import { ActorContext } from './actor.middleware.js';
import { can } from './permissions.js';

/**
 * Middleware that checks if the authenticated actor has a specific permission.
 * @param action – the action key (e.g., 'view_booking_calendar')
 * @param getResource – optional function to extract resource context from the request.
 *   The resource must have `ownerId` and/or `assignedId` for scope checks.
 * @returns Express middleware
 *
 * Example usage:
 *   router.get('/bookings', requirePermission('view_booking_calendar'), ...);
 *   router.post('/bookings/:id/cancel', requirePermission('reschedule_cancel_booking', (req) => ({ ownerId: req.params.id })), ...);
 */
export function requirePermission(
  action: string,
  getResource?: (req: Request) => { ownerId?: string; assignedId?: string }
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const actor = req.actor;
    if (!actor) {
      return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required.'));
    }

    const resource = getResource ? getResource(req) : undefined;

    if (!can(action, actor, resource)) {
      // Provide a helpful error message that includes the action and role.
      return next(
        new AppError(
          403,
          'PERMISSION_DENIED',
          `You do not have permission to perform '${action}' with role '${actor.role}'.`
        )
      );
    }

    next();
  };
}

/**
 * Convenience middleware to check a simple permission without resource context.
 */
export function requireSimplePermission(action: string) {
  return requirePermission(action);
}

/**
 * Check if a specific actor has permission, for use in route handlers.
 */
export function checkPermission(
  actor: ActorContext,
  action: string,
  resource?: { ownerId?: string; assignedId?: string }
): boolean {
  return can(action, actor, resource);
}