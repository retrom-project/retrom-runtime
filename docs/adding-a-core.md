# Adding and Integrating a Core

1. Put third-party source changes and the Web build in a dedicated maintained fork; produce one fixed candidate asset set.
2. Add one Target to the Provider declaration and its private implementation without aliases or fallback implementations.
3. Add adapter unit tests and a small owned or redistributable compatibility fixture. Private operator games may
   be used for an ignored local smoke but never enter Git or ordinary automated tests.
4. Open a PR to `master`; the quality workflow runs lint, types, unit tests and the package build without compiling cores.
5. Use a PFB candidate descriptor for the host's real import/launch/checkpoint/restore product test.
6. Publish the stable fork tag, pin it here, then publish the aggregate runtime tag.

This keeps core development independent: a new core can be tested without replacing the stable runtime used by
other games or requiring unrelated host changes.
