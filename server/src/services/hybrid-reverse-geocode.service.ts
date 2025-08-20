import { Injectable } from '@nestjs/common';
import { MapRepository } from 'src/repositories/map.repository';
import { NominatimService } from 'src/services/nominatim.service';

@Injectable()
export class HybridReverseGeocodeService {
  constructor(
    private mapRepository: MapRepository,
    private nominatimService: NominatimService,
  ) {}

  // TODO: Implement reverse geocoding logic here
}
