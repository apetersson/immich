import { Injectable } from '@nestjs/common';
import { GeoPoint, ReverseGeocodeResult } from 'src/repositories/map.repository';
import { BaseService } from 'src/services/base.service';

type NominatimAddress = Record<string, string | undefined>;
type NominatimPlace = {
  place_id: number | string;
  lat: string;
  lon: string;
  display_name?: string;
  address?: NominatimAddress;
  place_rank?: number | string;
  error?: string;
};

@Injectable()
export class NominatimService extends BaseService {
  async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    const nominatimUrl = this.configRepository.getEnv().nominatimUrl;
    if (!nominatimUrl) {
      return null;
    }

    try {
      // Ask for detailed address parts to make mapping reliable
      const url =
        `${nominatimUrl}/reverse` +
        `?lat=${point.latitude}` +
        `&lon=${point.longitude}` +
        `&format=jsonv2` +
        `&addressdetails=1` +
        `&namedetails=1` +
        `&zoom=18`;
      this.logger.debug(`Querying Nominatim: ${url}`);

      const response = await fetch(url, {
        headers: {
          // keep a UA, some Nominatim setups log/filter by this
          'User-Agent': 'immich-nominatim-service/1.0',
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const place = (await response.json()) as NominatimPlace;
      if (!place || place.error) {
        this.logger.warn(
          `Nominatim error/empty for ${point.latitude},${point.longitude}: ${place?.error || 'No result'}`,
        );
        return null;
      }

      const placeRank = toInt(place.place_rank);
      const minRankThreshold = 10; // keep your filter
      if (placeRank !== null && placeRank < minRankThreshold) {
        this.logger.debug(`Nominatim result place_rank ${placeRank} < ${minRankThreshold}, skipping.`);
        return null;
      }

      const address = place.address ?? {};
      const country = address.country ?? null;

      // 1) STATE: prefer ISO3166-2-lvlXX + paired human name at roughly the same level.
      const iso = pickBestIsoSubdivision(address); // { code, level } | null
      let stateName: string | null = null;

      if (iso) {
        stateName = pickNameForIsoLevel(address, iso.level) ?? null;
      }
      // Fallbacks if no ISO or no good name for that level
      if (!stateName) {
        stateName = pickFromOrdered(address, [
          'region',
          'state',
          'province',
          'state_district',
          'county',
          'municipality',
          'city_district',
          'district',
          'borough',
          'subregion',
          'subdivision',
        ]);
      }

      // Microstates / city-states (Monaco, Singapore, Vatican): if still no state,
      // promote suburb/quarter as state to keep informative granularity.
      if (!stateName && isCityState(address)) {
        stateName = pickFromOrdered(address, ['suburb', 'quarter', 'neighbourhood']);
      }

      const state =
        iso && (stateName || iso.code)
          ? [stateName, iso.code].filter(Boolean).join(' (').replace(/ \($/, '') + (iso.code && stateName ? ')' : '')
          : (stateName ?? null);

      // 2) CITY: pack informative, human-readable bits in a stable order, de-duplicated.
      const city = buildCityField(address);

      return { country, state, city };
    } catch (error) {
      this.logger.error(
        `Error querying Nominatim for ${point.latitude},${point.longitude}: ${(error as Error).message}`,
      );
      return null;
    }
  }
}

/* ---------------------------- helpers below ---------------------------- */

function toInt(v: unknown): number | null {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Scan address for ISO3166-2-lvlXX keys, pick the *highest* administrative unit below country.
 * OSM convention: lower number = larger area. We want the smallest `lvl` > 2 available.
 * For Monaco you’ll often only get lvl10 (wards), which is fine – we still include it.
 */
function pickBestIsoSubdivision(address: NominatimAddress): { code: string; level: number } | null {
  const entries: Array<{ level: number; code: string }> = [];

  for (const [k, v] of Object.entries(address)) {
    if (!v) {
      continue;
    }
    const m = /^ISO3166-2-lvl(\d{1,2})$/.exec(k);
    if (!m) {
      continue;
    }
    const lvl = Number.parseInt(m[1], 10);
    if (Number.isFinite(lvl) && lvl > 2) {
      entries.push({ level: lvl, code: v });
    }
  }
  if (entries.length === 0) {
    return null;
  }

  // Prefer the *largest area* below country first (lowest level number),
  // but if multiple present, take the lowest level number available.
  entries.sort((a, b) => a.level - b.level);
  return entries[0];
}

/**
 * Given an ISO level, pick the most suitable *name* at that granularity.
 * Mapping is heuristic because admin_level varies by country.
 */
function pickNameForIsoLevel(address: NominatimAddress, level: number): string | null | undefined {
  // Broad mapping buckets
  if (level <= 4) {
    return pickFromOrdered(address, ['region', 'state', 'province']);
  }
  if (level <= 6) {
    return pickFromOrdered(address, ['state_district', 'county', 'district']);
  }
  if (level <= 8) {
    return pickFromOrdered(address, ['municipality', 'city', 'town']);
  }
  // 9–12: city districts, suburbs, quarters, neighbourhoods
  return pickFromOrdered(address, ['city_district', 'borough', 'suburb', 'quarter', 'neighbourhood']);
}

function pickFromOrdered(address: NominatimAddress, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = address[k];
    if (v) {
      return v;
    }
  }
  return null;
}

function isCityState(address: NominatimAddress): boolean {
  // Monaco, Singapore, Vatican patterns: city equals country name or only city present
  const country = address.country?.toLowerCase();
  const city = address.city?.toLowerCase();
  if (!country) {
    return false;
  }
  return !!city && (city === country || ['monaco', 'singapore', 'vatican city'].includes(country));
}

/**
 * Build a compact, deduped "city" field:
 *   [amenity|shop|leisure|tourism|office|building|house_name] + house_number + road,
 *   then locality ladder [neighbourhood, quarter, suburb, village, town, city],
 *   then district/borough, then postcode.
 */
function buildCityField(address: NominatimAddress): string | null {
  const parts: string[] = [];

  const poi =
    pickFromOrdered(address, ['amenity', 'shop', 'leisure', 'tourism', 'office', 'building', 'house_name']) ?? null;
  if (poi) {
    parts.push(poi);
  }

  if (address.house_number) {
    parts.push(address.house_number);
  }
  if (address.road) {
    parts.push(address.road);
  }

  const locality = pickFromOrdered(address, ['neighbourhood', 'quarter', 'suburb', 'village', 'town', 'city']);
  if (locality) {
    parts.push(locality);
  }

  const district = pickFromOrdered(address, ['city_district', 'borough', 'district']);
  if (district && !eqIgnoreCase(district, locality || undefined)) {
    parts.push(district);
  }

  if (address.postcode) {
    parts.push(address.postcode);
  }

  // Deduplicate while preserving order (case-insensitive)
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(p.trim());
  }

  return out.length > 0 ? out.join(', ') : null;
}

function eqIgnoreCase(a?: string, b?: string): boolean {
  if (!a || !b) {
    return false;
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
