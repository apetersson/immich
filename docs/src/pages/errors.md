# Errors

## TypeORM Upgrade

In order to update to Immich to `v1.137.0` (or above), the application must be started at least once on version `1.136.0`. Doing so will complete database schema upgrades that are required for `v1.137.0` (and above). After Immich has successfully started on this version, shut the system down and try the update again.
