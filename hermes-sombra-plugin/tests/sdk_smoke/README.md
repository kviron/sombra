# Reproducible exact-SDK smoke harness

These harness files are **our test source**. The original variants were copied byte-for-byte from the independently executed local QA fixture; the shared variants add startup/access-policy and provider-scope regressions, and the full variants exercise real native durable ingress. No Hermes framework source, archive, cache, provenance/evidence output or private runtime data is versioned here. Fake token/key strings are deliberate test constants, never real credentials.

From the repository workspace root (Docker and Python required):

```sh
python app/check-hermes-platform-integration.py --acquire
python app/check-hermes-platform-integration.py --full-ingress --build --run
python app/check-hermes-platform-integration.py --shared-host --build --run
```

The launcher copies the unchanged acquisition helper into ignored `app/deploy-qa/hermes-runtime-integration/` before executing it, preserving its `__file__`-relative output semantics. Archives, source extraction, provenance, Docker context and any logs remain there. Docker build reads this versioned source folder, not ignored copies of the harness. Omitting `--shared-host` preserves the earlier isolated-adapter fixture; it is not a production runtime selection.

## Pinned framework identity

- Public exact commit: `bf0203a794a07aac3ff764972ab9087baa4e4f4e`.
- Public archive: <https://codeload.github.com/NousResearch/hermes-agent/tar.gz/bf0203a794a07aac3ff764972ab9087baa4e4f4e>.
- Public annotated `v0.22.5` tag is peeled and checked against that commit.
- Independently acquired normalized archive SHA256: `5c0212d38b36dccc5e6fcf522e753cd7eeefd1640cc37d0ea66d015ce52701ae`; each acquisition records its checksum, then the launcher and image verify that recorded checksum before use.
- Python base digest: `sha256:9aaa474097d094040649f2162a627c0049b408f52138d980916788d80f04802f`.
- The acquisition helper retains its preexisting read-only SSH archive fallback when public acquisition fails; this requires operator-provided workspace SSH settings and existing strict known hosts. A fresh clone normally uses public GitHub and needs no SSH settings. No remote changes, runtime imports or model calls are performed.

Framework dependencies are built **inside Docker** with the framework's supported package manager and declared overrides. The tracked framework archive has no full application lock, so dependency resolution is not frozen; the PM-only lock is not represented as an application lock. No host Python packages are installed.

## Scope and safety

**Full ingress mode** follows the actual CLI bootstrap order: profile ownership and PID claim, default/named authorities, real control socket/runtime API, then GatewayRunner.start/readiness before any fake events. The original SDK handler remains installed; the fixture neither constructs AIAgent directly nor installs an outer invocation/profile context. Actual backend polling drives six trusted cases: two sequential owner DM turns, two sequential owner group turns, PNG attachment on the same DM, and a second selected group actor. Each requires actual terminal execution, final text and ACK. SQLite must contain six terminal native admissions with standard platform_update_id, empty metadata and provenance; DM/group session reuse and actor separation are asserted. This prevents a false-positive legacy in-process fallback.

**Shared-host contract mode** runs actual pinned SDK discovery, named-profile routing, GatewayRunner construction, real config/access-policy checks and adapter prefilter/connect/aggregate startup phases against fake backend HTTP (not full startup/listeners), BasePlatformAdapter lifecycle, real AIAgent terminal execution, and actual PublicRunner restricted execution. Model/provider and backend HTTP are fake loopback services; web search is an injected constant-result wrapper. Public malicious terminal/file calls must be denied, while trusted SDK terminal calls execute harmless writes only in disposable container workspaces. The public long-answer assertion preserves 4334 characters through the real callback and three transport chunks.

Authorization assertions exercise the actual SDK-installed adapter callback and source-bound authorization wrapper for selected, mismatched and public identities under both default and named secret scopes, without creating a named-profile `.env`. The raw SDK ladder must be called in the **receiving transport's** authorization scope; directly calling it under a different runtime profile is outside its contract and is not treated as the ingress authorization entry point. No final-verdict predicates are mocked. Normal allowlist startup succeeds; crafted open policy without allow-all is refused.

Provider-scope regression first requires the product public-ingest wrapper to install the official named-profile home and secret scope; the fixture does not prebind that scope. It then executes real `public_runner.existing_provider`, the SDK runtime resolver and pooled `runtime_base_url` property with synthetic credentials. Only the credential-storage factory supplies a real in-memory pool, with a trap against refresh. Clearing the secret scope reproduces `UnscopedSecretError`; official `set_secret_scope`, `copy_context` and `asyncio.to_thread` resolve the synthetic endpoint while preserving `codex_responses`, restoring an unrelated synthetic Telegram scope and leaving `os.environ` unchanged. This resolver regression performs no HTTP and does not prove real account authorization.

Runtime: network-none, no host mounts/socket/credentials, 512 MiB, one CPU, 128 PIDs; the root fixture setup permanently drops to UID10001 with effective capabilities zero. The container is only a **test boundary**, not a shared-host production sandbox or deployment recommendation. Actual Telegram, delegate execution, production CLI host attach/replacement and native slash handlers, and real-provider account authorization remain outside these fixtures' proof.

Only goal-labeled `sombra-hermes-qa:*` objects belong to this test. The run container uses `--rm`; after testing, inspect the exact test image identity/labels before removing it. Do not prune unrelated Docker objects or shared base/build cache.
