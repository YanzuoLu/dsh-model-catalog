# dsh-model-catalog

Synchronize dsh's pi-ai model catalog with the online catalog used by Pi.
No model requests, API credentials, default model changes, or provider-config rewrites are involved.

## Behavior

For configured built-in pi-ai routes, fetch public metadata from
`https://pi.dev/api/models/providers/<provider>` and overlay it on the bundled catalog.
The adapter's existing normalization still applies local settings afterward.

- Local `modelOverrides`, route API, gateway URL, headers, reasoning settings, and credentials remain authoritative.
- A nonempty explicit `models` list remains a replacement list. Synchronization does not append models to that list.
- Renamed custom routes are unchanged. Radius retains its own discovery behavior.
- In-flight requests retain captured model/configuration snapshots. Subsequent requests and model-list reads see refreshed metadata.
- No tool definitions, search dispatch, global fetch wrapper, or installed package files are changed.
- Model visibility does not guarantee account access. Metadata cannot add support for a wire protocol that the installed SDK does not implement.

## Refresh and cache

The catalog policy follows Pi 0.87.1's `remote-catalog-provider` and `management-http` implementations.

- Restore cached metadata before requesting updates. Use a four-hour freshness window and ETag revalidation.
- Only a catalog with `Last-Modified` newer than the bundled generation timestamp may override the bundle.
- A 304 retains the cached body. A 404/501 retains its body but clears the validator and records catalog unavailability.
- Retry transient management HTTP failures twice, with a four-second timeout per attempt.
- Keep the available catalog on network errors. Report cache read/write failures without discarding a usable in-memory result.

This plugin checks enabled routes on activation, newly configured routes on registration, and all enabled routes every four hours.
Use the human command `/models-refresh` to bypass the freshness window. It does not send a prompt to a model.

The default cache is `$DSH_HOME/cache/model-catalog`, or `~/.dsh/cache/model-catalog` when `DSH_HOME` is unset.
Each provider has its own atomically replaced JSON file containing public metadata only.
The plugin does not read or write Pi's `models.json`, `models-store.json`, or credentials.

## Install

Install the bundle from GitHub into the intended dsh profile:

```sh
dsh plugin --profile web add github:YanzuoLu/dsh-model-catalog
```

Restart that profile's host process using its existing service manager.
The profile lockfile records the installed Git commit.

## Configuration

The dsh bundle registers the plugin as `model-catalog`. Its optional configuration is:

```yaml
- id: model-catalog
  name: dsh-model-catalog
  config:
    cacheDir: ~/.dsh/cache/model-catalog
    offline: false
```

Omit `cacheDir` to respect `DSH_HOME` automatically.
`offline: true` loads the local cache without network requests or a periodic timer.

## Compatibility

The version-bound integration lives in `lib/dsh-bridge.js`.
It overlays pi-ai's generated runtime records and invalidates dsh's memoized profiles by committing
an equivalent immutable configuration snapshot, then publishing the host's normal notifications.
It does not copy the adapter's configuration or authentication implementation.

Tested with dsh `0.2.0-rc.2`, pi-ai `0.87.1`, Cordis `4.0.5`, Cosmokit `1.8.6`, and Schemastery `3.18.5`.
Revalidate the bridge before changing the pinned dsh or pi-ai versions.

The runtime catalog is process-wide. Register the plugin once per Cordis root. Separate roots in one
process share one catalog owner and must use identical cache/offline settings. The last instance's disposal cancels refreshes, restores the bundled records,
and invalidates previously participating roots. Records subsequently replaced by another owner are not overwritten during cleanup.
Removing the plugin can make remote-only models unavailable to new requests until the plugin is re-enabled.

## Attribution

Catalog freshness, conditional requests, generation ordering, and management retries are adapted from
[Pi](https://github.com/earendil-works/pi), version 0.87.1:
`packages/coding-agent/src/core/remote-catalog-provider.ts` and
`packages/coding-agent/src/utils/management-http.ts`.
Pi's MIT copyright notice is included in `LICENSE`.
