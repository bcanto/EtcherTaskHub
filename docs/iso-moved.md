# The ISO audit module has moved

On 20 October 2026 the ISO audit module was taken out of Task Hub to become its own website with its own client portal.

- The code, its handover and the decisions now live in the **Etcher ISO** folder (copied on 17 October 2026, byte for
  byte), and the new product is being planned in the **ISO System** folder.
- Nothing was lost: the full ISO history stays in this repository's git history, on the branches `iso-release-1` and
  `retained-services` (last commit with ISO: `ddfd771`).
- ISO never went live in Task Hub, so no production data was moved. Its database migrations (009 to 015) were never
  applied to production and are removed here; they are in the ISO folder.
- Hours for ISO work are logged in Task Hub against the client (the separate "ISO audit" logging mode was removed with
  the module).
