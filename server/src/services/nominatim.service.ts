import { Injectable } from '@nestjs/common';
import { GeoPoint, ReverseGeocodeResult } from 'src/repositories/map.repository';
import { BaseService } from 'src/services/base.service';
import { parseStringPromise } from 'xml2js';

@Injectable()
export class NominatimService extends BaseService {
  async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    const nominatimUrl = this.configRepository.getEnv().nominatimUrl;

    if (!nominatimUrl) {
      return null;
    }

    try {
      const url = `${nominatimUrl}?lat=${point.latitude}&lon=${point.longitude}&format=xml`;
      this.logger.debug(`Querying Nominatim: ${url}`);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const xmlResult = await response.text();

      const result = await parseStringPromise(xmlResult, { explicitArray: false, ignoreAttrs: false });

      if (!result || !result.reversegeocode || result.reversegeocode.error) {
        this.logger.warn(
          `Nominatim returned an error or no result for ${point.latitude},${point.longitude}: ${result?.reversegeocode?.error || 'No result'}`,
        );
        return null;
      }

      const place = result.reversegeocode.result;
      const addressparts = result.reversegeocode.addressparts;

      // Rank Cutoff
      const placeRank = Number.parseInt(place.$.place_rank, 10);
      const minRankThreshold = 10; // Example threshold: consider anything below 10 (country-level) as too broad

      if (placeRank < minRankThreshold) {
        this.logger.debug(
          `Nominatim result for ${point.latitude},${point.longitude} has place_rank ${placeRank}, which is below the minRankThreshold of ${minRankThreshold}. Skipping.`,
        );
        return null;
      }

      // Field Mapping
      const country = addressparts.country || null;

      let state: string | null = null;
      // Prioritize highest-level administrative subdivision smaller than country
      if (addressparts.region) {
        state = addressparts.region;
      } else if (addressparts.state) {
        state = addressparts.state;
      } else if (addressparts['ISO3166-2-lvl4']) {
        // Example, adjust levels as needed
        state = addressparts['ISO3166-2-lvl4'];
      } else if (addressparts['ISO3166-2-lvl6']) {
        state = addressparts['ISO3166-2-lvl6'];
      } else if (addressparts.county) {
        state = addressparts.county;
      } else if (addressparts.state_district) {
        state = addressparts.state_district;
      } else if (addressparts.city_district) {
        state = addressparts.city_district;
      }

      const cityParts: string[] = [];

      // Specific Address/Place
      if (addressparts.house_number) {
        cityParts.push(addressparts.house_number);
      }
      if (addressparts.house_name) {
        cityParts.push(addressparts.house_name);
      }
      if (addressparts.road) {
        cityParts.push(addressparts.road);
      }
      if (addressparts.leisure) {
        cityParts.push(addressparts.leisure);
      } else if (addressparts.shop) {
        cityParts.push(addressparts.shop);
      } else if (addressparts.tourism) {
        cityParts.push(addressparts.tourism);
      }

      // Localities/Subdivisions
      if (addressparts.hamlet) {
        cityParts.push(addressparts.hamlet);
      } else if (addressparts.croft) {
        cityParts.push(addressparts.croft);
      } else if (addressparts.isolated_dwelling) {
        cityParts.push(addressparts.isolated_dwelling);
      } else if (addressparts.suburb) {
        cityParts.push(addressparts.suburb);
      } else if (addressparts.village) {
        cityParts.push(addressparts.village);
      } else if (addressparts.town) {
        cityParts.push(addressparts.town);
      } else if (addressparts.city) {
        cityParts.push(addressparts.city);
      }

      // Other relevant details
      if (addressparts.postcode) {
        cityParts.push(addressparts.postcode);
      }
      if (addressparts.district && addressparts.district !== state) {
        cityParts.push(addressparts.district);
      }
      if (addressparts.borough && addressparts.borough !== state) {
        cityParts.push(addressparts.borough);
      }
      if (addressparts.subdivision && addressparts.subdivision !== state) {
        cityParts.push(addressparts.subdivision);
      }
      if (addressparts.neighbourhood) {
        cityParts.push(addressparts.neighbourhood);
      }
      if (addressparts.allotments) {
        cityParts.push(addressparts.allotments);
      }
      if (addressparts.quarter) {
        cityParts.push(addressparts.quarter);
      }

      const city = cityParts.filter(Boolean).join(', ') || null;

      return { country, state, city };
    } catch (error) {
      this.logger.error(
        `Error querying Nominatim for ${point.latitude},${point.longitude}: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
