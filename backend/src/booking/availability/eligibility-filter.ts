/**
 * Artist/Service Eligibility Filter - D7.4
 * Filters artists based on active status and service eligibility mapping
 * Uses dependency injection for testability
 */

import { PrismaClient } from "../generated/prisma/client.js";

interface EligibilityConfig {
  /** Service IDs requested in the availability search */
  serviceIds: string[];
  /** Optional specific artist ID for targeted search */
  requestedArtistId?: string;
}

interface MultiServiceEligibilityResult {
  /** Artists eligible for ALL services (required for specific artist request) */
  fullyEligibleArtists: string[];
  /** Per-service eligible artists (for auto-assign) */
  perServiceEligible: Map<string, string[]>;
}

/**
 * Creates eligibility filter functions with a Prisma client
 * Uses dependency injection for testability
 */
export function createEligibilityFilter(prisma: PrismaClient) {
  
  /**
   * Gets all artists eligible for the requested services
   * Eligibility requires:
   * 1. Artist profile is Active
   * 2. Artist is mapped to the requested service via artist_services (active mapping)
   * 3. If specific artist requested, only that artist is returned (if eligible)
   */
  async function getEligibleArtists(
    config: EligibilityConfig
  ): Promise<Array<{
    id: string;
    firstName: string;
    lastName: string;
    displayName: string;
    specialization?: string;
    isAvailable: boolean;
    artistServices: Array<{ serviceId: string; isActive: boolean }>;
  }>> {
    const { serviceIds, requestedArtistId } = config;

    const whereClause: any = {
      isAvailable: true, // Artist profile active status
      artistServices: {
        some: {
          serviceId: { in: serviceIds },
          isActive: true,
        },
      },
    };

    if (requestedArtistId) {
      whereClause.id = requestedArtistId;
    }

    const artists = await prisma.artistProfile.findMany({
      where: whereClause,
      include: {
        artistServices: {
          where: {
            serviceId: { in: serviceIds },
            isActive: true,
          },
          select: {
            serviceId: true,
            isActive: true,
          },
        },
      },
    });

    return artists.map((artist) => ({
      id: artist.id,
      firstName: artist.firstName,
      lastName: artist.lastName,
      displayName: artist.displayName,
      specialization: artist.specialization ?? undefined,
      isAvailable: artist.isAvailable,
      artistServices: artist.artistServices,
    }));
  }

  /**
   * Checks if a specific artist is eligible for a specific service
   */
  async function isArtistEligibleForService(
    artistId: string,
    serviceId: string
  ): Promise<boolean> {
    const artistService = await prisma.artistService.findFirst({
      where: {
        artistId,
        serviceId,
        isActive: true,
      },
    });

    if (!artistService) {
      return false;
    }

    // Also check artist profile is active
    const artist = await prisma.artistProfile.findUnique({
      where: { id: artistId },
      select: { isAvailable: true },
    });

    return artist?.isAvailable === true;
  }

  /**
   * Gets the eligibility status for multiple artists for a service
   * Returns a map of artistId -> eligible boolean
   */
  async function getEligibilityMap(
    artistIds: string[],
    serviceId: string
  ): Promise<Map<string, boolean>> {
    const mappings = await prisma.artistService.findMany({
      where: {
        artistId: { in: artistIds },
        serviceId,
        isActive: true,
      },
      select: { artistId: true },
    });

    const eligibleIds = new Set(mappings.map((m) => m.artistId));
    const artistProfiles = await prisma.artistProfile.findMany({
      where: { id: { in: artistIds } },
      select: { id: true, isAvailable: true },
    });

    const result = new Map<string, boolean>();
    for (const artist of artistProfiles) {
      result.set(artist.id, eligibleIds.has(artist.id) && artist.isAvailable);
    }

    return result;
  }

  /**
   * Filters candidate slots by artist eligibility
   * Only keeps slots where the artist is eligible for ALL requested services
   */
  function filterSlotsByEligibility(
    slots: Array<{ artistId: string; startAt: Date; endAt: Date }>,
    eligibilityMap: Map<string, boolean>
  ): Array<{ artistId: string; startAt: Date; endAt: Date }> {
    return slots.filter(slot => eligibilityMap.get(slot.artistId) === true);
  }

  /**
   * Computes multi-service eligibility per authoritative contract
   * - Specific artist: must be eligible for ALL services
   * - Auto-assign: returns per-service eligible artists
   */
  async function computeMultiServiceEligibility(
    serviceIds: string[],
    requestedArtistId?: string
  ): Promise<MultiServiceEligibilityResult> {
    if (requestedArtistId) {
      // Specific artist requested: must be eligible for ALL services
      let eligibleForAll = true;
      for (const serviceId of serviceIds) {
        const eligible = await isArtistEligibleForService(requestedArtistId, serviceId);
        if (!eligible) {
          eligibleForAll = false;
          break;
        }
      }

      return {
        fullyEligibleArtists: eligibleForAll ? [requestedArtistId] : [],
        perServiceEligible: new Map(),
      };
    }

    // Auto-assign: find eligible artists per service
    const perServiceEligible = new Map<string, string[]>();
    
    for (const serviceId of serviceIds) {
      const artists = await prisma.artistProfile.findMany({
        where: {
          isAvailable: true,
          artistServices: {
            some: { serviceId, isActive: true },
          },
        },
        select: { id: true },
      });
      
      perServiceEligible.set(serviceId, artists.map(a => a.id));
    }

    return {
      fullyEligibleArtists: [],
      perServiceEligible,
    };
  }

  return {
    getEligibleArtists,
    isArtistEligibleForService,
    getEligibilityMap,
    filterSlotsByEligibility,
    computeMultiServiceEligibility,
  };
}

export type { EligibilityConfig, MultiServiceEligibilityResult };