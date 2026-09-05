---
name: OpenAPI Zod version compatibility
description: Orval output must target the workspace's installed Zod major version.
---

The workspace currently uses Zod 3, while newer Orval releases can emit Zod 4-only helpers such as `z.int()` and `z.url()`.

**Why:** Code generation succeeds before the downstream library typecheck, so the incompatibility only appears after generated files are written.

**How to apply:** Keep the Orval Zod override pinned to version 3 unless the entire workspace intentionally migrates to Zod 4.