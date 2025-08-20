import { Injectable } from '@nestjs/common';
import { GeoPoint, MapRepository, ReverseGeocodeResult } from 'src/repositories/map.repository';
import { NominatimService } from 'src/services/nominatim.service';

@Injectable()
export class HybridReverseGeocodeService {
  constructor(
    private mapRepository: MapRepository,
    private nominatimService: NominatimService,
  ) {}

  async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    let result = await this.nominatimService.reverseGeocode(point);

    if (result === null) {
      result = await this.mapRepository.reverseGeocode(point);
    }

    return result;
  }
}
