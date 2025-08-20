import { Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import { MapMarkerDto, MapMarkerResponseDto, MapReverseGeocodeDto } from 'src/dtos/map.dto';
import { AlbumRepository } from 'src/repositories/album.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MapRepository, ReverseGeocodeResult } from 'src/repositories/map.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { NominatimService } from 'src/services/nominatim.service';
import { getMyPartnerIds } from 'src/utils/asset.util';

@Injectable()
export class MapService {
  constructor(
    private configRepository: ConfigRepository,
    private partnerRepository: PartnerRepository,
    private albumRepository: AlbumRepository,
    private mapRepository: MapRepository,
    private nominatimService: NominatimService,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(MapService.name);
  }

  async getMapMarkers(auth: AuthDto, options: MapMarkerDto): Promise<MapMarkerResponseDto[]> {
    const userIds = [auth.user.id];
    if (options.withPartners) {
      const partnerIds = await getMyPartnerIds({ userId: auth.user.id, repository: this.partnerRepository });
      userIds.push(...partnerIds);
    }

    // TODO convert to SQL join
    const albumIds: string[] = [];
    if (options.withSharedAlbums) {
      const [ownedAlbums, sharedAlbums] = await Promise.all([
        this.albumRepository.getOwned(auth.user.id),
        this.albumRepository.getShared(auth.user.id),
      ]);
      albumIds.push(...ownedAlbums.map((album) => album.id), ...sharedAlbums.map((album) => album.id));
    }

    return this.mapRepository.getMapMarkers(userIds, albumIds, options);
  }

  async reverseGeocode(dto: MapReverseGeocodeDto): Promise<ReverseGeocodeResult[]> {
    const { lat: latitude, lon: longitude } = dto;
    const { nominatimUrl } = this.configRepository.getEnv();

    if (nominatimUrl) {
      const nominatimResult = await this.nominatimService.reverseGeocode({ latitude, longitude });
      if (nominatimResult) {
        return [nominatimResult];
      }
    }

    const result = await this.mapRepository.reverseGeocode({ latitude, longitude });
    return result ? [result] : [];
  }
}
