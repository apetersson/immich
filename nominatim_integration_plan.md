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
    This is critical for ensuring data consistency with Immich's existing structure. The goal is to map Nominatim's detailed response to Immich's `country`, `state`, and `city` fields, with `state` representing the highest-level subdivision smaller than country, and `city` containing all other granular details.

    *   **`country`**: Map directly from `<country>` in `<addressparts>`.
    *   **`countryCode`**: Map directly from `<country_code>` in `<addressparts>`.
    *   **`state`**: This should represent the highest-level administrative subdivision smaller than the country. Prioritize in this order, taking the first available:
        *   `<region>`
        *   `<state>`
        *   `<ISO3166-2-lvlX>` (e.g., `ISO3166-2-lvl4`, `ISO3166-2-lvl6`, etc. - pick the highest level available)
        *   `<county>`
        *   `<state_district>`
        *   `<city_district>` (if it represents a significant administrative division, like a "bezirk")
        *   If none of the above are present, `state` will be `null`.
    *   **`city`**: This field will be a comma-separated string containing all other granular location details, ordered from most specific to least specific. Prioritize and concatenate, taking the first available from each group and then adding others:
        *   **Specific Address/Place:**
            *   `<house_number>`
            *   `<house_name>`
            *   `<road>`
            *   `<leisure>`, `<shop>`, `<tourism>`, etc. (specific point of interest names)
        *   **Localities/Subdivisions:**
            *   `<hamlet>`
            *   `<croft>`
            *   `<isolated_dwelling>`
            *   `<suburb>`
            *   `<village>`
            *   `<town>`
            *   `<city>`
        *   **Other relevant details (if not used for `state`):**
            *   `<postcode>`
            *   `<district>` (if not `city_district` and not used for `state`)
            *   `<borough>`
            *   `<subdivision>`
            *   `<neighbourhood>`
            *   `<allotments>`
            *   `<quarter>`

    *   **Example Mapping (Monaco: Princess Grace Rose Garden, Avenue des Guelfes, Fontvieille, Monaco, 98020, Monaco):**
        *   `country`: "Monaco" (from `<country>`)
        *   `state`: "MC-FO" (from `<ISO3166-2-lvl10>`) - *Assuming this is the highest-level subdivision smaller than country.*
        *   `city`: "Princess Grace Rose Garden, Avenue des Guelfes, Fontvieille, 98020" (concatenation of `<leisure>`, `<road>`, `<suburb>`, `<postcode>`)

    *   **Example Mapping (Niger: for lat=22&lon=11, only country returned):**
        *   `country`: "Niger"
        *   `state`: `null` (as no smaller subdivision is returned)
        *   `city`: `null` (as no granular details are returned)

5.  **Rank Cutoff and Error Handling:**
    *   **Implement a `minRank` threshold:** If the `place_rank` (or `address_rank`) of the Nominatim result is below a configurable threshold (e.g., `10` for country-level results), consider it an "unsuccessful" lookup. This prevents "half-baked" results from being used.
    *   Handle network errors (e.g., Nominatim instance is down, timeout).
    *   Handle Nominatim's "Unable to geocode" error response (when it doesn't know the place).
    *   Return `null` or an empty `ReverseGeocodeResult` in case of errors, no results, or results below the `minRank` threshold.

### 3.3. Fallback Logic in `MapRepository`

Modify `server/src/repositories/map.repository.ts` to integrate the Nominatim service.

1.  **Inject `NominatimService`:** Inject the newly created `NominatimService` into `MapRepository`.
2.  **Conditional Reverse Geocoding:**
    *   In the `reverseGeocode` method, check if `IMMICH_NOMINATIM_URL` is configured.
    *   If configured, attempt to call `NominatimService.reverseGeocode(point)`.
    *   If Nominatim returns a valid result (not null/empty, and meets the rank cutoff), return that result.
    *   If Nominatim returns null/empty (due to error, "Unable to geocode", or failing the rank cutoff), then proceed with Immich's existing local geocoding logic (querying `geodata_places` and `naturalearth_countries`).

### 3.4. Testing Strategy

1.  **Unit Tests for `NominatimService`:**
    *   Test successful API calls and correct parsing/mapping for various Nominatim responses (including different place types like city, town, village, suburb).
    *   Test error cases (network issues, "Unable to geocode" responses).
    *   Test rank cutoff logic with various `place_rank` values.
2.  **Integration Tests for `MapRepository`:**
    *   Test scenarios where Nominatim provides a result (and meets rank cutoff).
    *   Test scenarios where Nominatim fails or provides a result below rank cutoff, and the fallback to local geocoder works correctly.
    *   Test with and without the `IMMICH_NOMINATIM_URL` environment variable set.
3.  **End-to-End Tests:**
    *   Deploy Immich with a Nominatim instance (e.g., using `nominatim-docker`).
    *   Upload assets with known coordinates (both within Monaco and outside, including areas that produce "half-baked" Nominatim results) and verify the displayed location information.

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
