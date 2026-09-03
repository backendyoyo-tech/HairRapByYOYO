# D10-D12 Admin/Mobile Handoff Documentation

## Overview
This document describes the API contracts, events, and behaviors for Days 10-12 implementation for Admin Panel and Mobile App consumption.

---

## D10-BE-010: Booking Lifecycle Commands

### Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/bookings/:bookingId/check-in` | STAFF (ADMIN, SUPER_ADMIN) | Client check-in |
| POST | `/api/v1/bookings/:bookingId/no-show` | STAFF (ADMIN, SUPER_ADMIN) | Mark no-show |
| POST | `/api/v1/bookings/:bookingId/cancel` | CLIENT (OWN), STAFF (ADMIN, SUPER_ADMIN) | Cancel booking |
| POST | `/api/v1/bookings/:bookingId/reschedule` | CLIENT (OWN), STAFF (ADMIN, SUPER_ADMIN) | Reschedule booking |

### Request/Response Schemas

#### Check-In
```json
POST /api/v1/bookings/:bookingId/check-in
{
  "reason": "string (optional)"
}
Response: { "success": true, "status": "CHECKED_IN", "checkedInAt": "ISO8601", "alreadyCheckedIn": false }
```
- Idempotent: duplicate requests return `alreadyCheckedIn: true` without error
- Only allowed from CONFIRMED state
- Publishes `CLIENT_CHECKED_IN` event

#### No-Show
```json
POST /api/v1/bookings/:bookingId/no-show
{
  "reason": "string (optional)"
}
Response: { "success": true, "status": "NO_SHOW" }
```
- Only allowed from CONFIRMED state
- Appointment time must have passed (all services in the past)
- Publishes `BOOKING_NO_SHOW` event

#### Cancel
```json
POST /api/v1/bookings/:bookingId/cancel
{
  "reason": "string (required)"
}
Response: { "success": true, "status": "CANCELLED" }
```
- Allowed from CONFIRMED, CHECKED_IN, IN_SERVICE, SERVICE_COMPLETED
- Client can cancel own bookings; staff can cancel any
- 2-hour cancellation policy before service start
- Publishes `BOOKING_CANCELLED` event

### Lifecycle State Matrix
| FROM | ACTION | TO | Guard |
|------|--------|-----|-------|
| CONFIRMED | CHECK_IN | CHECKED_IN | Status=CONFIRMED |
| CONFIRMED | MARK_NO_SHOW | NO_SHOW | Status=CONFIRMED, appt time passed |
| CONFIRMED | CANCEL_BOOKING | CANCELLED | Status allows cancel, >2hrs before service |
| CHECKED_IN | CANCEL_BOOKING | CANCELLED | Exception only (Admin) |
| IN_SERVICE | CANCEL_BOOKING | CANCELLED | Exception only (Admin) |
| SERVICE_COMPLETED | CANCEL_BOOKING | CANCELLED | Exception only (Admin) |
| ANY TERMINAL | * | * | BLOCKED |

### Events Published
| Event | Payload |
|-------|---------|
| CLIENT_CHECKED_IN | `{ bookingId, checkedInAt, staffId }` |
| BOOKING_NO_SHOW | `{ bookingId, staffId, reason }` |
| BOOKING_CANCELLED | `{ bookingId, clientId, reason }` |
| BOOKING_RESCHEDULED | `{ bookingId, oldServices, newServices, actorId, reason, moneyActionRequired }` |

### Idempotency/Concurrency
- All mutating endpoints require `Idempotency-Key` header
- Optimistic locking via `version` field on bookings
- Duplicate requests return cached response

---

## D11-BE-011: Manual Assignment Queue + Per-Service Assign/Reassign

### Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/admin/assignment-queue` | ADMIN, SUPER_ADMIN | Get assignment queue |
| POST | `/api/v1/booking-services/:bookingServiceId/assign` | ADMIN, SUPER_ADMIN | Assign artist |
| POST | `/api/v1/booking-service-assignments/:assignmentId/reassign` | ADMIN, SUPER_ADMIN | Reassign artist |

**Note**: Receptionist is NOT authorized for assignment endpoints per RBAC (Floor Manager = Admin/Super Admin capability only).

### Assignment Queue Response
```json
GET /api/v1/admin/assignment-queue
Response: {
  "success": true,
  "data": [
    {
      "bookingServiceId": "uuid",
      "bookingId": "uuid",
      "clientName": "John Doe",
      "serviceName": "Haircut",
      "serviceId": "uuid",
      "assignmentStatus": "AWAITING_ASSIGNMENT",
      "requiredArtistCount": 1,
      "plannedStartAt": "ISO8601",
      "plannedEndAt": "ISO8601",
      "assignmentStrategy": "AUTO_ASSIGN",
      "requestedArtistId": null,
      "currentAssignments": [
        { "artistId": "uuid", "artistName": "Jane Smith", "role": "PRIMARY", "status": "CONFIRMED" }
      ]
    }
  ]
}
```

### Assign Artist
```json
POST /api/v1/booking-services/:bookingServiceId/assign
{
  "artistId": "uuid",
  "role": "PRIMARY | LEAD | SUPPORT",
  "assignmentSource": "FLOOR_MANAGER",
  "assignedByStaffId": "uuid (optional, inferred from auth)"
}
```
- Validates: artist active, eligible for service, shift covers time, no exceptions, no conflicts (10-min buffer)
- For 2-artist services: enforces LEAD/SUPPORT roles, prevents duplicate artist, prevents duplicate roles
- Client-requested artist preserved as LEAD
- Publishes events: `ASSIGNMENT_REQUIRED`, `ASSIGNMENT_PARTIAL`, `ARTIST_ASSIGNMENT_FINALIZED`

### Reassign Artist
```json
POST /api/v1/booking-service-assignments/:assignmentId/reassign
{
  "newArtistId": "uuid",
  "assignedByStaffId": "uuid"
}
```
- Concurrency protection: stale update throws `STALE_ASSIGNMENT`
- Validates new artist same as assign
- Publishes `ARTIST_ASSIGNMENT_FINALIZED` when fully assigned

### Assignment State Machine
| State | Meaning | Transitions |
|-------|---------|-------------|
| AWAITING_ASSIGNMENT | No named artist | → PARTIALLY_ASSIGNED (1-artist) / FULLY_ASSIGNED (2-artist after 2nd) |
| PARTIALLY_ASSIGNED | Some slots filled (2-artist) | → FULLY_ASSIGNED / ASSIGNMENT_EXCEPTION |
| FULLY_ASSIGNED | All required artists assigned | → ASSIGNMENT_EXCEPTION (if artist becomes unavailable) |
| ASSIGNMENT_EXCEPTION | Artist invalidated | → AWAITING_ASSIGNMENT (after repair) |

### Events Published
| Event | Payload |
|-------|---------|
| ASSIGNMENT_REQUIRED | `{ bookingServiceId, bookingId }` |
| ASSIGNMENT_PARTIAL | `{ bookingServiceId, bookingId, artistId, staffId, requiredCount, currentCount }` |
| ARTIST_ASSIGNMENT_FINALIZED | `{ bookingServiceId, bookingId, artistId, staffId }` |
| ARTIST_ASSIGNMENT_EXCEPTION | `{ bookingServiceId, bookingId, artistId, reason }` |

---

## D12-BE-012: Generic Two-Artist Assignment & Capacity Rules

### Configuration-Driven
- Uses `service.requiredArtistCount` (1 or 2) - **no hardcoded production service names**
- Test fixtures clearly marked as non-production

### Two-Artist Rules
1. **Two distinct eligible artists required** before FULLY_ASSIGNED
2. **Same artist cannot fill both positions** → `DUPLICATE_ARTIST` error
3. **Lead/Support roles explicit**:
   - Client-requested artist → LEAD (preserved, never silently replaced)
   - Second artist → SUPPORT
   - Duplicate LEAD or SUPPORT roles rejected → `DUPLICATE_ROLE` error
4. **Role validation**: 1-artist requires PRIMARY, 2-artist requires LEAD/SUPPORT

### Dual Capacity Protection
- Both artists capacity-blocked for full execution window + 10-min buffer
- Availability validated for each assignment
- Conflict on either artist blocks assignment

### One-Artist Regression
- 1-artist behavior unchanged: single PRIMARY assignment → FULLY_ASSIGNED
- D7 availability tests pass (89/89)

### Readiness Contract (for Artist App)
Assignment queue response includes:
- `assignmentStatus`: AWAITING_ASSIGNMENT / PARTIALLY_ASSIGNED / FULLY_ASSIGNED
- `requiredArtistCount`: from service config
- `currentAssignments[]`: each with `role` (PRIMARY/LEAD/SUPPORT) and `status`
- Artist App can determine service readiness: `assignmentStatus === 'FULLY_ASSIGNED'`

### Test Fixtures
- All test services clearly marked as non-production
- No production service names (Highlight/Botox) hardcoded

---

## RBAC Summary

| Action | Receptionist | Admin | Super Admin | Artist | Client |
|--------|-------------|-------|-------------|--------|--------|
| View Calendar | FULL | FULL | FULL | OWN | OWN |
| Check-In | FULL | FULL | FULL | - | - |
| No-Show | FULL | FULL | FULL | - | - |
| Cancel (own) | - | - | - | - | OWN |
| Cancel (any) | FULL | FULL | FULL | - | - |
| Assignment Queue | READ | FULL | FULL | ASSIGNED | - |
| Assign Artist | **NONE** | FULL | FULL | - | - |
| Reassign Artist | **NONE** | FULL | FULL | - | - |

---

## Error Codes
| Code | HTTP | Context |
|------|------|---------|
| INVALID_STATE_TRANSITION | 400 | Illegal lifecycle transition |
| ALREADY_CHECKED_IN | 200 | Duplicate check-in (idempotent) |
| NO_SHOW_TOO_EARLY | 400 | No-show before appointment time |
| CANCELLATION_POLICY | 400 | Cancel within 2hrs of service |
| ARTIST_NOT_QUALIFIED | 400 | Artist not eligible for service |
| ARTIST_UNAVAILABLE | 409 | Artist has conflict/exception |
| ASSIGNMENT_EXISTS | 409 | Artist already assigned to service |
| ASSIGNMENT_LIMIT_EXCEEDED | 409 | Required count reached |
| DUPLICATE_ARTIST | 409 | Same artist for both slots |
| DUPLICATE_ROLE | 409 | Two LEADs or two SUPPORTs |
| INVALID_ROLE | 400 | Wrong role for artist count |
| STALE_ASSIGNMENT | 409 | Concurrent reassignment conflict |
| IDEMPOTENCY_CONFLICT | 409 | Duplicate idempotency key |

---

## Testing Evidence
| Suite | Tests | Pass |
|-------|-------|------|
| D4 RBAC | 10 | ✅ |
| D7 Availability | 89 | ✅ |
| D8 Quote/Hold | 24 | ✅ (restored) |
| D10 Lifecycle | 15 | ✅ (new) |
| D11 Assignment | 22 | ✅ (new) |
| D12 Two-Artist | 18 | ✅ (new) |

---

## Database Verification
Verified against real DB:
- Booking status transitions persisted in `booking_status_history`
- `checked_in_at` timestamp written once, idempotent
- No-show only after appointment time, releases holds
- Cancellation releases holds, respects 2hr policy
- Assignment rows created with `assignmentSource`, `assignedByStaffId`
- Assignment status transitions: AWAITING → PARTIAL → FULL
- ArtistConfirmationState: PROVISIONAL → FINAL (D13)
- No `AUTO_STANDARD` assignments in Phase 1

---

## Performance
- Dual-artist conflict validation: single `validateSlotAvailability` call per artist
- No N+1 queries observed
- Assignment queue uses indexed queries on `assignmentStatus`, `plannedStartAt`

---

## Open Items for D13+
- T-30 provisional confirmation queue (D13)
- Specific artist provisional state machine
- Reschedule atomic transaction (D14)
- CD advance transfer on reschedule

---

*Generated: 2026-09-03*
*Implementation: fix/d10-d12-audit branch*