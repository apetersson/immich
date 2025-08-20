# Nominatim Reverse Geocoding Integration Plan for Immich

## 1. Introduction

This plan outlines the steps to integrate an external Nominatim instance as the primary reverse geocoding service for Immich. The goal is to leverage Nominatim's higher fidelity and more detailed geographical data, while retaining Immich's existing local geocoder as a fallback for cases where Nominatim does not provide a result or is unavailable. The Nominatim instance URL will be configurable via an environment variable.

## 2. Proposed Changes

The core idea is to introduce a new layer of reverse geocoding that prioritizes the external Nominatim service. This will involve:

*   Adding a new environment variable for the Nominatim API URL.
*   Modifying the `MapRepository` to conditionally use the Nominatim service.
*   Implementing a Nominatim client to handle API requests and response parsing.
*   Mapping Nominatim's detailed address components to Immich's `ReverseGeocodeResult` structure (`country`, `state`, `city`).
*   Implementing robust error handling and fallback logic to Immich's existing geocoder.

## 3. Detailed Implementation Steps

### 3.1. Configuration

1.  **Define New Environment Variable:**
    *   Add a new environment variable, e.g., `IMMICH_NOMINATIM_URL`, to `server/src/dtos/env.dto.ts`. This variable will hold the base URL of the Nominatim `reverse` endpoint (e.g., `http://localhost:8080/reverse`).
    *   Update `server/src/repositories/config.repository.ts` to read this new environment variable and expose it via `getEnv()`.

### 3.2. Nominatim Integration Service

Create a new service, e.g., `server/src/services/nominatim.service.ts`, responsible for interacting with the Nominatim API.

1.  **HTTP Client Setup:**
    *   Use `@nestjs/common/http` or a similar HTTP client to make requests to the Nominatim API.
    *   Inject `ConfigRepository` to get the `IMMICH_NOMINATIM_URL`.

2.  **Request Formulation:**
    *   The Nominatim `reverse` endpoint expects `lat` and `lon` parameters.
    *   The `format=xml` parameter is useful for consistent parsing, as shown in the user's example.
    *   Example request: `http://localhost:8080/reverse?lat=43.726983&lon=7.418873&format=xml`

3.  **Response Parsing (XML):
    *   Nominatim returns XML. Use a suitable XML parsing library (e.g., `xml2js` or a native Node.js XML parser if available and suitable) to parse the response.
    *   Focus on extracting data from the `<addressparts>` and `<result>` tags.

4.  **Field Mapping to `ReverseGeocodeResult`:**
    This is critical for ensuring data consistency with Immich's existing structure.

    *   **`country`**: Map directly from `<country>` in `<addressparts>`.
    *   **`countryCode`**: Map directly from `<country_code>` in `<addressparts>`.
    *   **`city`**: This requires a hierarchical approach due to Nominatim's varied place types. Prioritize in this order:
        *   `<city>`
        *   `<town>`
        *   `<village>`
        *   `<hamlet>`
        *   `<suburb>` (as seen in the Monaco example)
        *   If none of the above are present, consider other relevant fields like `<county>` or `<state_district>` if they represent a more specific urban area.
    *   **`state`**: This should represent the primary administrative division. Prioritize:
        *   `<state>`
        *   `<region>`
        *   `<county>` (if `city` is already mapped from a more specific type)
        *   `<ISO3166-2-lvlX>` (as seen in the Monaco example, `MC-FO` for Fontvieille) - *Consider if this needs to be human-readable or if the code is sufficient for Immich's current use.*

    *   **Example Mapping (Monaco):**
        *   `country`: "Monaco"
        *   `city`: "Fontvieille" (from `<suburb>`)
        *   `state`: "MC-FO" (from `<ISO3166-2-lvl10>`) - *Consider if this needs to be human-readable or if the code is sufficient for Immich's current use.*

5.  **Error Handling:**
    *   Handle network errors (e.g., Nominatim instance is down, timeout).
    *   Handle Nominatim's "Unable to geocode" error response (when it doesn't know the place).
    *   Return `null` or an empty `ReverseGeocodeResult` in case of errors or no results from Nominatim.

### 3.3. Fallback Logic in `MapRepository`

Modify `server/src/repositories/map.repository.ts` to integrate the Nominatim service.

1.  **Inject `NominatimService`:** Inject the newly created `NominatimService` into `MapRepository`.
2.  **Conditional Reverse Geocoding:**
    *   In the `reverseGeocode` method, check if `IMMICH_NOMINATIM_URL` is configured.
    *   If configured, attempt to call `NominatimService.reverseGeocode(point)`.
    *   If Nominatim returns a valid result (not null/empty), return that result.
    *   If Nominatim returns null/empty (due to error or "Unable to geocode"), then proceed with Immich's existing local geocoding logic (querying `geodata_places` and `naturalearth_countries`).

### 3.4. Testing Strategy

1.  **Unit Tests for `NominatimService`:**
    *   Test successful API calls and correct parsing/mapping for various Nominatim responses (including different place types like city, town, village, suburb).
    *   Test error cases (network issues, "Unable to geocode" responses).
2.  **Integration Tests for `MapRepository`:**
    *   Test scenarios where Nominatim provides a result.
    *   Test scenarios where Nominatim fails, and the fallback to local geocoder works correctly.
    *   Test with and without the `IMMICH_NOMINATIM_URL` environment variable set.
3.  **End-to-End Tests:**
    *   Deploy Immich with a Nominatim instance (e.g., using `nominatim-docker`).
    *   Upload assets with known coordinates (both within Monaco and outside) and verify the displayed location information.

### 3.5. Deployment Considerations

*   **Nominatim Instance:** Users will need to deploy and maintain their own Nominatim instance.
*   **Environment Variable:** Ensure the `IMMICH_NOMINATIM_URL` is correctly set in the Immich `.env` file.
*   **Performance:** Monitor the performance impact of external API calls to Nominatim.
*   **Error Logging:** Ensure proper logging for Nominatim API errors and fallback events.

## 4. Affected Files

*   `server/src/dtos/env.dto.ts` (Add `IMMICH_NOMINATIM_URL`)
*   `server/src/repositories/config.repository.ts` (Read `IMMICH_NOMINATIM_URL`)
*   `server/src/services/nominatim.service.ts` (New file for Nominatim client)
*   `server/src/repositories/map.repository.ts` (Integrate `NominatimService` and fallback logic)
*   Potentially `server/src/app.module.ts` (Register `NominatimService`)
*   `server/src/types.ts` (If `ReverseGeocodeResult` needs extension for more Nominatim fields)

## 5. Open Questions / Future Work

*   **Granularity of `state` and `city`:** How granular should the `state` and `city` fields be? Should "bezirk" be mapped to `state` or a new field? This depends on how Immich uses these fields in the UI and search.
*   **Language Support:** Nominatim supports multiple languages. Should Immich's Nominatim integration support configurable languages?
*   **Rate Limiting/Caching:** Consider implementing rate limiting or caching for Nominatim requests to avoid overwhelming the instance or for performance.
*   **Nominatim API Key:** If a Nominatim instance requires an API key, this would need another environment variable and integration.
*   **Alternative Nominatim Formats:** Consider supporting JSON format from Nominatim if it simplifies parsing.
