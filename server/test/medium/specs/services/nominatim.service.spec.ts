import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NominatimService } from 'src/services/nominatim.service';
import { mockEnvData } from 'test/repositories/config.repository.mock';
import { newTestService, ServiceMocks } from 'test/utils';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

// Read the example XML file once for all tests
const monacoXml = readFileSync(join(process.cwd(), 'test', 'fixtures', 'xml', 'example_monaco.xml'), 'utf8');

describe(NominatimService.name, () => {
  let sut: NominatimService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    // Use the existing test utility to set up the service and its mocks
    ({ sut, mocks } = newTestService(NominatimService));

    // Mock the global fetch function for all tests in this suite
    vi.spyOn(globalThis, 'fetch');
  });

  describe('reverseGeocode', () => {
    const geoPoint = { latitude: 43.727_089_2, longitude: 7.418_884_5 };

    it('should return null if nominatimUrl is not configured', async () => {
      // Arrange: Configure the environment without a Nominatim URL
      mocks.config.getEnv.mockReturnValue(mockEnvData({ nominatimUrl: undefined }));

      // Act
      const result = await sut.reverseGeocode(geoPoint);

      // Assert
      expect(result).toBeNull();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should correctly parse a valid XML response from Nominatim', async () => {
      // Arrange: Configure a valid Nominatim URL and mock a successful fetch
      mocks.config.getEnv.mockReturnValue(mockEnvData({ nominatimUrl: 'https://nominatim.openstreetmap.org/reverse' }));
      const mockResponse = {
        ok: true,
        text: () => Promise.resolve(monacoXml),
      } as Response;
      (globalThis.fetch as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await sut.reverseGeocode(geoPoint);

      // Assert
      expect(result).toEqual({
        country: 'Monaco',
        state: 'Fontvieille',
        city: 'Princesse Grace, Tunnel Pont Cadre, Fontvieille, Monaco, 98020',
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://nominatim.openstreetmap.org/reverse?lat=43.7270892&lon=7.4188845&format=xml',
      );
    });

    it('should return null and log a warning if fetch returns a non-OK response', async () => {
      // Arrange: Mock a failed fetch (e.g., server error)
      mocks.config.getEnv.mockReturnValue(mockEnvData({ nominatimUrl: 'https://nominatim.openstreetmap.org/reverse' }));
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response;
      (globalThis.fetch as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await sut.reverseGeocode(geoPoint);

      // Assert
      expect(result).toBeNull();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Nominatim returned an error or no result for 43.7270892,7.4188845: No result',
      );
    });

    it('should return null and log an error if fetch throws an error', async () => {
      // Arrange: Mock fetch to simulate a network failure
      mocks.config.getEnv.mockReturnValue(mockEnvData({ nominatimUrl: 'https://nominatim.openstreetmap.org/reverse' }));
      (globalThis.fetch as Mock).mockRejectedValue(new Error('Network request failed'));

      // Act
      const result = await sut.reverseGeocode(geoPoint);

      // Assert
      expect(result).toBeNull();
      expect(mocks.logger.error).toHaveBeenCalledWith(
        'Error querying Nominatim for 43.7270892,7.4188845: Network request failed',
      );
    });

    it('should return null if the place_rank is below the threshold', async () => {
      // Arrange: Modify the XML to have a low place_rank
      const lowRankXml = monacoXml.replace('place_rank="30"', 'place_rank="9"');
      mocks.config.getEnv.mockReturnValue(mockEnvData({ nominatimUrl: 'https://nominatim.openstreetmap.org/reverse' }));
      const mockResponse = {
        ok: true,
        text: () => Promise.resolve(lowRankXml),
      } as Response;
      (globalThis.fetch as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await sut.reverseGeocode(geoPoint);

      // Assert
      expect(result).toBeNull();
      expect(mocks.logger.debug).toHaveBeenCalledWith(
        'Nominatim result for 43.7270892,7.4188845 has place_rank 9, which is below the minRankThreshold of 10. Skipping.',
      );
    });

    it('should return null if Nominatim returns an error in the XML', async () => {
      // Arrange: Mock an XML response containing an error message
      const errorXml = `<?xml version="1.0" encoding="UTF-8" ?><reversegeocode><error>Unable to geocode</error></reversegeocode>`;
      mocks.config.getEnv.mockReturnValue(mockEnvData({ nominatimUrl: 'https://nominatim.openstreetmap.org/reverse' }));
      const mockResponse = {
        ok: true,
        text: () => Promise.resolve(errorXml),
      } as Response;
      (globalThis.fetch as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await sut.reverseGeocode(geoPoint);

      // Assert
      expect(result).toBeNull();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Nominatim returned an error or no result for 43.7270892,7.4188845: Unable to geocode',
      );
    });
  });
});
